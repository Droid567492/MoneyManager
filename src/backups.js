'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { getSetting, setSetting } = require('./db');
const { exportFullBackup, restoreFullBackup } = require('./importer');

const BACKUP_FILE_REGEX = /^moneymanager-backup-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.json(?:\.gz)?$/;
const VALID_PROTOCOLS = new Set(['sftp', 'ftp', 'ftps', 'smb']);
const VALID_SCHEDULES = new Set(['daily', 'weekly', 'interval']);
const MAX_HISTORY_ENTRIES = 40;

let activeBackupPromise = null;

function buildBackupFilename(date = new Date(), compress = true) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = [
    d.getUTCFullYear(),
    pad(d.getUTCMonth() + 1),
    pad(d.getUTCDate()),
  ].join('-') + '_' + [
    pad(d.getUTCHours()),
    pad(d.getUTCMinutes()),
    pad(d.getUTCSeconds()),
  ].join('-');
  return `moneymanager-backup-${stamp}.json${compress ? '.gz' : ''}`;
}

function parseBackupFilenameTimestamp(filename) {
  const m = BACKUP_FILE_REGEX.exec(String(filename || '').trim());
  if (!m) return null;
  const ms = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6])
  );
  return Number.isFinite(ms) ? ms : null;
}

function assertValidBackupFilename(filename) {
  const clean = String(filename || '').trim();
  if (!BACKUP_FILE_REGEX.test(clean)) {
    const err = new Error('Invalid backup filename.');
    err.statusCode = 400;
    throw err;
  }
  return clean;
}

function getOrCreateBackupKey(dataDir) {
  if (process.env.BACKUP_SECRET_KEY) {
    return crypto.createHash('sha256').update(String(process.env.BACKUP_SECRET_KEY), 'utf8').digest();
  }
  const dir = dataDir || path.resolve(__dirname, '..', 'data');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const keyPath = path.join(dir, '.backup.key');
  if (fs.existsSync(keyPath)) {
    const hex = fs.readFileSync(keyPath, 'utf8').trim();
    if (/^[0-9a-fA-F]{64}$/.test(hex)) {
      return Buffer.from(hex, 'hex');
    }
  }
  const raw = crypto.randomBytes(32);
  fs.writeFileSync(keyPath, raw.toString('hex'), { mode: 0o600 });
  return raw;
}

function encryptSecret(plaintext, key) {
  const str = String(plaintext || '');
  if (!str) return '';
  if (str.startsWith('enc:v1:')) return str;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(str, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decryptSecret(encoded, key) {
  const str = String(encoded || '');
  if (!str) return '';
  if (!str.startsWith('enc:v1:')) return str;
  const parts = str.split(':');
  if (parts.length !== 5) return '';
  try {
    const iv = Buffer.from(parts[2], 'hex');
    const tag = Buffer.from(parts[3], 'hex');
    const ciphertext = Buffer.from(parts[4], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

function defaultPortForProtocol(protocol, ftpsMode = 'explicit') {
  if (protocol === 'ftp') return 21;
  if (protocol === 'ftps') return ftpsMode === 'implicit' ? 990 : 21;
  if (protocol === 'smb') return 445;
  return 22;
}

function clampInt(val, fallback, min = 0, max = 1000000) {
  if (val === '' || val === null || val === undefined) return fallback;
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function sanitizeControlText(val, label = 'Value') {
  const s = String(val ?? '').trim();
  if (/[\r\n\0]/.test(s)) {
    const err = new Error(`${label} contains invalid line break or control characters.`);
    err.statusCode = 400;
    throw err;
  }
  return s;
}

function getDefaultBackupConfig() {
  return {
    enabled: false,
    scheduleType: 'daily',
    intervalHours: 24,
    timeOfDay: '03:00',
    dayOfWeek: 0,
    compress: true,
    includeReceipts: true,
    lastRunAt: null,
    nextRunAt: null,
    local: {
      enabled: true,
      directory: '',
      maxCount: 14,
      maxAgeDays: 30,
      maxTotalSizeMb: 250,
    },
    remote: {
      enabled: false,
      protocol: 'sftp',
      ftpsMode: 'explicit',
      host: '',
      port: 22,
      share: '',
      domain: '',
      remotePath: '/moneymanager-backups',
      username: '',
      password: '',
      authMethod: 'password',
      sshPrivateKey: '',
      verifyTls: false,
      maxCount: 30,
      maxAgeDays: 90,
      maxTotalSizeMb: 1024,
    },
  };
}

function mergeStoredConfig(raw) {
  const def = getDefaultBackupConfig();
  const src = raw && typeof raw === 'object' ? raw : {};
  const srcLocal = src.local && typeof src.local === 'object' ? src.local : {};
  const srcRemote = src.remote && typeof src.remote === 'object' ? src.remote : {};

  const protocol = VALID_PROTOCOLS.has(srcRemote.protocol) ? srcRemote.protocol : def.remote.protocol;
  const ftpsMode = srcRemote.ftpsMode === 'implicit' ? 'implicit' : 'explicit';

  return {
    enabled: Boolean(src.enabled),
    scheduleType: VALID_SCHEDULES.has(src.scheduleType) ? src.scheduleType : def.scheduleType,
    intervalHours: clampInt(src.intervalHours, def.intervalHours, 1, 720),
    timeOfDay: /^\d{2}:\d{2}$/.test(String(src.timeOfDay || '')) ? String(src.timeOfDay) : def.timeOfDay,
    dayOfWeek: clampInt(src.dayOfWeek, def.dayOfWeek, 0, 6),
    compress: src.compress !== undefined ? Boolean(src.compress) : def.compress,
    includeReceipts: src.includeReceipts !== undefined ? Boolean(src.includeReceipts) : def.includeReceipts,
    lastRunAt: typeof src.lastRunAt === 'string' && src.lastRunAt ? src.lastRunAt : null,
    nextRunAt: typeof src.nextRunAt === 'string' && src.nextRunAt ? src.nextRunAt : null,
    local: {
      enabled: srcLocal.enabled !== undefined ? Boolean(srcLocal.enabled) : def.local.enabled,
      directory: typeof srcLocal.directory === 'string' ? srcLocal.directory.trim() : def.local.directory,
      maxCount: clampInt(srcLocal.maxCount, def.local.maxCount, 0, 10000),
      maxAgeDays: clampInt(srcLocal.maxAgeDays, def.local.maxAgeDays, 0, 36500),
      maxTotalSizeMb: clampInt(srcLocal.maxTotalSizeMb, def.local.maxTotalSizeMb, 0, 1048576),
    },
    remote: {
      enabled: Boolean(srcRemote.enabled),
      protocol,
      ftpsMode,
      host: typeof srcRemote.host === 'string' ? srcRemote.host.trim() : def.remote.host,
      port: clampInt(srcRemote.port, defaultPortForProtocol(protocol, ftpsMode), 1, 65535),
      share: typeof srcRemote.share === 'string' ? srcRemote.share.trim() : def.remote.share,
      domain: typeof srcRemote.domain === 'string' ? srcRemote.domain.trim() : def.remote.domain,
      remotePath: typeof srcRemote.remotePath === 'string' ? srcRemote.remotePath.trim() : def.remote.remotePath,
      username: typeof srcRemote.username === 'string' ? srcRemote.username.trim() : def.remote.username,
      password: typeof srcRemote.password === 'string' ? srcRemote.password : '',
      authMethod: srcRemote.authMethod === 'key' ? 'key' : 'password',
      sshPrivateKey: typeof srcRemote.sshPrivateKey === 'string' ? srcRemote.sshPrivateKey : '',
      verifyTls: Boolean(srcRemote.verifyTls),
      maxCount: clampInt(srcRemote.maxCount, def.remote.maxCount, 0, 10000),
      maxAgeDays: clampInt(srcRemote.maxAgeDays, def.remote.maxAgeDays, 0, 36500),
      maxTotalSizeMb: clampInt(srcRemote.maxTotalSizeMb, def.remote.maxTotalSizeMb, 0, 1048576),
    },
  };
}

function getBackupConfig(db) {
  try {
    const raw = getSetting(db, 'backup_config', '');
    if (!raw) return getDefaultBackupConfig();
    return mergeStoredConfig(JSON.parse(raw));
  } catch {
    return getDefaultBackupConfig();
  }
}

function resolveDecryptedConfig(db, dataDir) {
  const cfg = getBackupConfig(db);
  const key = getOrCreateBackupKey(dataDir);
  return {
    ...cfg,
    remote: {
      ...cfg.remote,
      password: decryptSecret(cfg.remote.password, key),
      sshPrivateKey: decryptSecret(cfg.remote.sshPrivateKey, key),
    },
  };
}

function resolveLocalBackupDir(cfg, defaultBackupsDir) {
  const custom = String(cfg?.local?.directory || '').trim();
  if (!custom) return defaultBackupsDir;
  return path.resolve(custom);
}

function sanitizeConfigForClient(cfg, defaultBackupsDir) {
  const clean = mergeStoredConfig(cfg);
  return {
    ...clean,
    local: {
      ...clean.local,
      resolvedDirectory: resolveLocalBackupDir(clean, defaultBackupsDir),
    },
    remote: {
      enabled: clean.remote.enabled,
      protocol: clean.remote.protocol,
      ftpsMode: clean.remote.ftpsMode,
      host: clean.remote.host,
      port: clean.remote.port,
      share: clean.remote.share,
      domain: clean.remote.domain,
      remotePath: clean.remote.remotePath,
      username: clean.remote.username,
      authMethod: clean.remote.authMethod,
      verifyTls: clean.remote.verifyTls,
      maxCount: clean.remote.maxCount,
      maxAgeDays: clean.remote.maxAgeDays,
      maxTotalSizeMb: clean.remote.maxTotalSizeMb,
      hasPassword: Boolean(clean.remote.password),
      hasSshKey: Boolean(clean.remote.sshPrivateKey),
    },
  };
}

function normalizeTimeOfDay(raw) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(raw || '').trim());
  if (!m) return '03:00';
  return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`;
}

function computeNextRunAt(config, fromDate = new Date()) {
  if (!config || !config.enabled) return null;
  const base = fromDate instanceof Date ? new Date(fromDate.getTime()) : new Date(fromDate);
  if (Number.isNaN(base.getTime())) return null;

  if (config.scheduleType === 'interval') {
    const hours = clampInt(config.intervalHours, 24, 1, 720);
    return new Date(base.getTime() + hours * 3600 * 1000).toISOString();
  }

  const [hh, mm] = normalizeTimeOfDay(config.timeOfDay).split(':').map(Number);

  if (config.scheduleType === 'weekly') {
    const targetDow = clampInt(config.dayOfWeek, 0, 0, 6);
    const candidate = new Date(base.getTime());
    candidate.setSeconds(0, 0);
    candidate.setHours(hh, mm, 0, 0);
    let deltaDays = (targetDow - candidate.getDay() + 7) % 7;
    candidate.setDate(candidate.getDate() + deltaDays);
    if (candidate.getTime() <= base.getTime()) {
      candidate.setDate(candidate.getDate() + 7);
    }
    return candidate.toISOString();
  }

  // Default: daily
  const candidate = new Date(base.getTime());
  candidate.setSeconds(0, 0);
  candidate.setHours(hh, mm, 0, 0);
  if (candidate.getTime() <= base.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate.toISOString();
}

function validateRemoteHostPath(rawPath) {
  const clean = sanitizeControlText(rawPath, 'Remote path');
  if (!clean) return '/';
  if (clean.includes('..')) {
    const err = new Error('Remote path cannot contain "..".');
    err.statusCode = 400;
    throw err;
  }
  if (/['"`;&$<>|]/.test(clean)) {
    const err = new Error('Remote path contains unsupported special characters.');
    err.statusCode = 400;
    throw err;
  }
  return clean;
}

function saveBackupConfig(db, dataDir, input = {}) {
  const existing = getBackupConfig(db);
  const key = getOrCreateBackupKey(dataDir);
  const inLocal = input.local && typeof input.local === 'object' ? input.local : {};
  const inRemote = input.remote && typeof input.remote === 'object' ? input.remote : {};

  const scheduleType =
    input.scheduleType !== undefined
      ? VALID_SCHEDULES.has(input.scheduleType)
        ? input.scheduleType
        : existing.scheduleType
      : existing.scheduleType;

  const protocol =
    inRemote.protocol !== undefined
      ? VALID_PROTOCOLS.has(inRemote.protocol)
        ? inRemote.protocol
        : existing.remote.protocol
      : existing.remote.protocol;

  const ftpsMode =
    inRemote.ftpsMode !== undefined
      ? inRemote.ftpsMode === 'implicit'
        ? 'implicit'
        : 'explicit'
      : existing.remote.ftpsMode;

  const localDir =
    inLocal.directory !== undefined
      ? sanitizeControlText(inLocal.directory, 'Local backup directory')
      : existing.local.directory;
  if (localDir) {
    const resolved = path.resolve(localDir);
    if (resolved === '/' || resolved.length < 2) {
      const err = new Error('Invalid local backup directory path.');
      err.statusCode = 400;
      throw err;
    }
  }

  const host =
    inRemote.host !== undefined ? sanitizeControlText(inRemote.host, 'Remote host') : existing.remote.host;
  if (host && /[\s/@\\]/.test(host)) {
    const err = new Error('Remote host must be a valid hostname or IP address.');
    err.statusCode = 400;
    throw err;
  }

  const share =
    inRemote.share !== undefined ? sanitizeControlText(inRemote.share, 'SMB share') : existing.remote.share;
  if (share && !/^[A-Za-z0-9._\-$ ]+$/.test(share)) {
    const err = new Error('SMB share name contains invalid characters.');
    err.statusCode = 400;
    throw err;
  }

  const domain =
    inRemote.domain !== undefined ? sanitizeControlText(inRemote.domain, 'SMB domain') : existing.remote.domain;

  const remotePath =
    inRemote.remotePath !== undefined
      ? validateRemoteHostPath(inRemote.remotePath)
      : existing.remote.remotePath;

  const username =
    inRemote.username !== undefined
      ? sanitizeControlText(inRemote.username, 'Remote username')
      : existing.remote.username;

  let nextPassword = existing.remote.password;
  if (inRemote.clearPassword) {
    nextPassword = '';
  } else if (typeof inRemote.password === 'string' && inRemote.password.length > 0) {
    if (/[\r\n\0]/.test(inRemote.password)) {
      const err = new Error('Remote password cannot contain line breaks.');
      err.statusCode = 400;
      throw err;
    }
    nextPassword = encryptSecret(inRemote.password, key);
  }

  let nextSshKey = existing.remote.sshPrivateKey;
  if (inRemote.clearSshKey) {
    nextSshKey = '';
  } else if (typeof inRemote.sshPrivateKey === 'string' && inRemote.sshPrivateKey.trim().length > 0) {
    const keyNormalized = inRemote.sshPrivateKey.replace(/\r\n/g, '\n').trim() + '\n';
    nextSshKey = encryptSecret(keyNormalized, key);
  }

  const nextEnabled = input.enabled !== undefined ? Boolean(input.enabled) : existing.enabled;
  const nextCfg = {
    enabled: nextEnabled,
    scheduleType,
    intervalHours: clampInt(input.intervalHours, existing.intervalHours, 1, 720),
    timeOfDay: input.timeOfDay !== undefined ? normalizeTimeOfDay(input.timeOfDay) : existing.timeOfDay,
    dayOfWeek: clampInt(input.dayOfWeek, existing.dayOfWeek, 0, 6),
    compress: input.compress !== undefined ? Boolean(input.compress) : existing.compress,
    includeReceipts: input.includeReceipts !== undefined ? Boolean(input.includeReceipts) : existing.includeReceipts,
    lastRunAt: existing.lastRunAt,
    nextRunAt: null,
    local: {
      enabled: inLocal.enabled !== undefined ? Boolean(inLocal.enabled) : existing.local.enabled,
      directory: localDir,
      maxCount: clampInt(inLocal.maxCount, existing.local.maxCount, 0, 10000),
      maxAgeDays: clampInt(inLocal.maxAgeDays, existing.local.maxAgeDays, 0, 36500),
      maxTotalSizeMb: clampInt(inLocal.maxTotalSizeMb, existing.local.maxTotalSizeMb, 0, 1048576),
    },
    remote: {
      enabled: inRemote.enabled !== undefined ? Boolean(inRemote.enabled) : existing.remote.enabled,
      protocol,
      ftpsMode,
      host,
      port: clampInt(
        inRemote.port,
        protocol !== existing.remote.protocol ? defaultPortForProtocol(protocol, ftpsMode) : existing.remote.port,
        1,
        65535
      ),
      share,
      domain,
      remotePath,
      username,
      password: nextPassword,
      authMethod: inRemote.authMethod !== undefined ? (inRemote.authMethod === 'key' ? 'key' : 'password') : existing.remote.authMethod,
      sshPrivateKey: nextSshKey,
      verifyTls: inRemote.verifyTls !== undefined ? Boolean(inRemote.verifyTls) : existing.remote.verifyTls,
      maxCount: clampInt(inRemote.maxCount, existing.remote.maxCount, 0, 10000),
      maxAgeDays: clampInt(inRemote.maxAgeDays, existing.remote.maxAgeDays, 0, 36500),
      maxTotalSizeMb: clampInt(inRemote.maxTotalSizeMb, existing.remote.maxTotalSizeMb, 0, 1048576),
    },
  };

  if (nextCfg.remote.enabled) {
    if (!nextCfg.remote.host) {
      const err = new Error('Remote host is required when remote backups are enabled.');
      err.statusCode = 400;
      throw err;
    }
    if (nextCfg.remote.protocol === 'smb' && !nextCfg.remote.share) {
      const err = new Error('SMB share name is required when SMB protocol is selected.');
      err.statusCode = 400;
      throw err;
    }
  }

  nextCfg.nextRunAt = computeNextRunAt(nextCfg, new Date());
  setSetting(db, 'backup_config', JSON.stringify(nextCfg));
  return nextCfg;
}

function getBackupHistory(db) {
  try {
    const raw = getSetting(db, 'backup_history', '');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function appendBackupHistory(db, entry) {
  const prev = getBackupHistory(db);
  const next = [entry, ...prev].slice(0, MAX_HISTORY_ENTRIES);
  setSetting(db, 'backup_history', JSON.stringify(next));
  return next;
}

function computeRetentionDeletes(files, policy = {}, nowMs = Date.now(), protectedFilename = null) {
  const maxCount = Math.max(0, Number(policy.maxCount) || 0);
  const maxAgeDays = Math.max(0, Number(policy.maxAgeDays) || 0);
  const maxTotalSizeMb = Math.max(0, Number(policy.maxTotalSizeMb) || 0);

  const seen = new Set();
  const valid = [];
  for (const item of files || []) {
    if (!item || !item.filename) continue;
    const fname = String(item.filename).trim();
    if (!BACKUP_FILE_REGEX.test(fname) || seen.has(fname)) continue;
    seen.add(fname);
    const fnameTs = parseBackupFilenameTimestamp(fname);
    const ts = fnameTs ?? (Number.isFinite(Number(item.timestampMs)) ? Number(item.timestampMs) : 0);
    const size = Math.max(0, Number(item.sizeBytes ?? item.size) || 0);
    valid.push({
      ...item,
      filename: fname,
      timestampMs: ts,
      sizeBytes: size,
    });
  }

  valid.sort((a, b) => {
    if (b.timestampMs !== a.timestampMs) return b.timestampMs - a.timestampMs;
    return b.filename.localeCompare(a.filename);
  });

  const deleteReasons = new Map();

  // 1. Age limit
  if (maxAgeDays > 0) {
    const maxAgeMs = maxAgeDays * 86400 * 1000;
    for (const f of valid) {
      if (f.filename === protectedFilename) continue;
      if (f.timestampMs > 0 && nowMs - f.timestampMs > maxAgeMs) {
        deleteReasons.set(f.filename, 'age');
      }
    }
  }

  // 2. Count limit on survivors
  if (maxCount > 0) {
    let keptNonDeleted = 0;
    for (const f of valid) {
      if (deleteReasons.has(f.filename)) continue;
      if (f.filename === protectedFilename) {
        keptNonDeleted += 1;
        continue;
      }
      if (keptNonDeleted >= maxCount) {
        deleteReasons.set(f.filename, 'count');
      } else {
        keptNonDeleted += 1;
      }
    }
  }

  // 3. Total size limit on survivors (never drop the single newest kept file)
  if (maxTotalSizeMb > 0) {
    const maxBytes = maxTotalSizeMb * 1024 * 1024;
    let accumBytes = 0;
    let keptSoFar = 0;
    for (const f of valid) {
      if (deleteReasons.has(f.filename)) continue;
      if (keptSoFar === 0 || f.filename === protectedFilename) {
        accumBytes += f.sizeBytes;
        keptSoFar += 1;
        continue;
      }
      if (accumBytes + f.sizeBytes > maxBytes) {
        deleteReasons.set(f.filename, 'size');
      } else {
        accumBytes += f.sizeBytes;
        keptSoFar += 1;
      }
    }
  }

  const toDelete = [];
  const kept = [];
  let totalKeptBytes = 0;
  for (const f of valid) {
    if (deleteReasons.has(f.filename)) {
      toDelete.push({ ...f, reason: deleteReasons.get(f.filename) });
    } else {
      kept.push(f);
      totalKeptBytes += f.sizeBytes;
    }
  }

  return { toDelete, kept, totalKeptBytes };
}

function detectTransportCapabilities() {
  const checkBin = (name) => {
    try {
      execFileSync('which', [name], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };
  return {
    curl: checkBin('curl'),
    sftp: checkBin('sftp'),
    smbclient: checkBin('smbclient'),
  };
}

function runCommand(bin, args = [], { stdin = null, timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const outChunks = [];
    const errChunks = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    child.stdout.on('data', (d) => outChunks.push(d));
    child.stderr.on('data', (d) => errChunks.push(d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(outChunks).toString('utf8');
      const stderr = Buffer.concat(errChunks).toString('utf8');
      if (timedOut) {
        return reject(new Error(`${bin} timed out after ${Math.round(timeoutMs / 1000)}s.`));
      }
      resolve({ code: Number(code ?? 1), stdout, stderr });
    });

    if (stdin !== null && stdin !== undefined) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

function escapeCurlConfigValue(val) {
  return String(val ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n]/g, '');
}

function buildRemoteBaseUrl(remote, trailingSlash = true) {
  const host = String(remote.host || '').trim();
  const protocol = remote.protocol;
  const port = clampInt(remote.port, defaultPortForProtocol(protocol, remote.ftpsMode), 1, 65535);
  let scheme = protocol;
  if (protocol === 'ftps') {
    scheme = remote.ftpsMode === 'implicit' ? 'ftps' : 'ftp';
  }

  let relPath = String(remote.remotePath || '').trim();
  let urlPath = '/';
  if (protocol === 'sftp') {
    if (!relPath || relPath === '/') {
      urlPath = '/';
    } else if (relPath.startsWith('/')) {
      urlPath = '/' + relPath.replace(/^\/+/, '').replace(/\/+$/, '');
    } else {
      // Relative path in curl SFTP maps to ~/subpath
      urlPath = '/~/' + relPath.replace(/\/+$/, '');
    }
  } else {
    const stripped = relPath.replace(/^\/+/, '').replace(/\/+$/, '');
    urlPath = stripped ? `/${stripped}` : '/';
  }

  const encodedSegs = urlPath
    .split('/')
    .map((seg) => (seg === '~' ? '~' : encodeURIComponent(seg)))
    .join('/');
  let full = `${scheme}://${host}:${port}${encodedSegs || '/'}`;
  if (trailingSlash && !full.endsWith('/')) full += '/';
  if (!trailingSlash && full.length > 1 && full.endsWith('/')) full = full.slice(0, -1);
  return full;
}

function buildCurlConfigText(remote, url, extraLines = []) {
  const lines = [
    `url = "${escapeCurlConfigValue(url)}"`,
    'connect-timeout = 15',
    'max-time = 120',
    'silent',
    'show-error',
  ];
  if (remote.username || remote.password) {
    lines.push(`user = "${escapeCurlConfigValue(remote.username)}:${escapeCurlConfigValue(remote.password)}"`);
  }
  if (remote.protocol === 'ftp' || remote.protocol === 'ftps') {
    lines.push('disable-epsv');
  }
  if (remote.protocol === 'ftps' && remote.ftpsMode !== 'implicit') {
    lines.push('ftp-ssl-reqd');
  }
  if (!remote.verifyTls && (remote.protocol === 'ftps' || remote.protocol === 'sftp')) {
    lines.push('insecure');
  }
  for (const l of extraLines) {
    if (l) lines.push(l);
  }
  return lines.join('\n') + '\n';
}

function parseRemoteListLines(text) {
  const results = [];
  const seen = new Set();
  const lines = String(text || '').split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // 1. MLSD format: type=file;size=1234;modify=20261119120000; filename
    if (line.includes(';')) {
      const semiIdx = line.lastIndexOf(';');
      const maybeName = line.slice(semiIdx + 1).trim();
      if (BACKUP_FILE_REGEX.test(maybeName) && !seen.has(maybeName)) {
        const sizeM = /(?:^|;)size=(\d+)(?:;|$)/i.exec(line);
        const sizeBytes = sizeM ? Number(sizeM[1]) : 0;
        seen.add(maybeName);
        results.push({
          filename: maybeName,
          sizeBytes,
          timestampMs: parseBackupFilenameTimestamp(maybeName),
        });
        continue;
      }
    }

    // 2. Unix ls -l format: -rw-r--r-- 1 user group 12345 Nov 19 12:00 moneymanager-backup-...
    const unixM = /^[-a-zA-Z]{10}\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\d+\s+[\d:]+\s+(moneymanager-backup-[^\s]+)$/.exec(line);
    if (unixM && BACKUP_FILE_REGEX.test(unixM[2]) && !seen.has(unixM[2])) {
      seen.add(unixM[2]);
      results.push({
        filename: unixM[2],
        sizeBytes: Number(unixM[1]) || 0,
        timestampMs: parseBackupFilenameTimestamp(unixM[2]),
      });
      continue;
    }

    // 3. DOS/IIS FTP list format: 11-19-26  12:00PM  12345 moneymanager-backup-...
    const dosM = /^\d{2}-\d{2}-\d{2,4}\s+[\d:APMapm]+\s+(\d+)\s+(moneymanager-backup-[^\s]+)$/.exec(line);
    if (dosM && BACKUP_FILE_REGEX.test(dosM[2]) && !seen.has(dosM[2])) {
      seen.add(dosM[2]);
      results.push({
        filename: dosM[2],
        sizeBytes: Number(dosM[1]) || 0,
        timestampMs: parseBackupFilenameTimestamp(dosM[2]),
      });
      continue;
    }

    // 4. Generic fallback matching backup filename + optional preceding token size
    const fallbackM = /(?:^|\s)(\d+)\s+(?:[^\s]+\s+){0,4}(moneymanager-backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json(?:\.gz)?)$/.exec(line);
    if (fallbackM && BACKUP_FILE_REGEX.test(fallbackM[2]) && !seen.has(fallbackM[2])) {
      seen.add(fallbackM[2]);
      results.push({
        filename: fallbackM[2],
        sizeBytes: Number(fallbackM[1]) || 0,
        timestampMs: parseBackupFilenameTimestamp(fallbackM[2]),
      });
      continue;
    }

    // 5. Bare filename only (e.g. NLST)
    if (BACKUP_FILE_REGEX.test(line) && !seen.has(line)) {
      seen.add(line);
      results.push({
        filename: line,
        sizeBytes: 0,
        timestampMs: parseBackupFilenameTimestamp(line),
      });
    }
  }

  results.sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0));
  return results;
}

function parseSmbListOutput(text) {
  const results = [];
  const seen = new Set();
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const m = /^(moneymanager-backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json(?:\.gz)?)\s+[A-Z]+\s+(\d+)\s+/.exec(trimmed);
    if (m && BACKUP_FILE_REGEX.test(m[1]) && !seen.has(m[1])) {
      seen.add(m[1]);
      results.push({
        filename: m[1],
        sizeBytes: Number(m[2]) || 0,
        timestampMs: parseBackupFilenameTimestamp(m[1]),
      });
    }
  }
  results.sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0));
  return results;
}

function getSftpRemoteDir(remote) {
  const raw = String(remote.remotePath || '').trim().replace(/\/+$/, '');
  return raw || '.';
}

function buildSftpTargetSpec(remote) {
  const user = String(remote.username || '').trim();
  const host = String(remote.host || '').trim();
  return user ? `${user}@${host}` : host;
}

function buildSftpBaseArgs(remote, keyFilePath) {
  const port = clampInt(remote.port, 22, 1, 65535);
  return [
    '-i',
    keyFilePath,
    '-P',
    String(port),
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=15',
    '-o',
    `StrictHostKeyChecking=${remote.verifyTls ? 'yes' : 'no'}`,
    '-b',
    '-',
    buildSftpTargetSpec(remote),
  ];
}

async function withTempKeyFile(privateKeyText, fn) {
  if (!privateKeyText || !String(privateKeyText).trim()) {
    throw new Error('SSH private key is required when SFTP key authentication is selected.');
  }
  const tmpFile = path.join(os.tmpdir(), `mm-sftp-key-${crypto.randomBytes(8).toString('hex')}`);
  const normalized = String(privateKeyText).replace(/\r\n/g, '\n').trim() + '\n';
  fs.writeFileSync(tmpFile, normalized, { mode: 0o600 });
  try {
    return await fn(tmpFile);
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // ignore
    }
  }
}

function buildSmbScriptSegments(remotePath) {
  return String(remotePath || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s && s !== '.');
}

function buildSmbAuthFileContent(remote) {
  const lines = [];
  lines.push(`username = ${sanitizeControlText(remote.username || 'guest', 'SMB username')}`);
  lines.push(`password = ${sanitizeControlText(remote.password || '', 'SMB password')}`);
  if (remote.domain) {
    lines.push(`domain = ${sanitizeControlText(remote.domain, 'SMB domain')}`);
  }
  return lines.join('\n') + '\n';
}

async function withSmbClient(remote, commandStr) {
  if (!detectTransportCapabilities().smbclient) {
    throw new Error('smbclient is not installed on this system. Install the smbclient package to use SMB shares.');
  }
  if (!remote.host || !remote.share) {
    throw new Error('SMB host and share name are required.');
  }
  const unc = `//${remote.host}/${remote.share}`;
  const port = clampInt(remote.port, 445, 1, 65535);
  const authFile = path.join(os.tmpdir(), `mm-smb-auth-${crypto.randomBytes(8).toString('hex')}`);
  fs.writeFileSync(authFile, buildSmbAuthFileContent(remote), { mode: 0o600 });
  try {
    const args = [unc, '-p', String(port), '-A', authFile, '-c', commandStr];
    return await runCommand('smbclient', args, { timeoutMs: 90000 });
  } finally {
    try {
      fs.unlinkSync(authFile);
    } catch {
      // ignore
    }
  }
}

function sftpEnsureDirLines(remoteDir) {
  if (!remoteDir || remoteDir === '.' || remoteDir === '/') return [];
  const isAbs = remoteDir.startsWith('/');
  const segs = remoteDir.split('/').filter(Boolean);
  const lines = [];
  let acc = isAbs ? '' : '.';
  for (const s of segs) {
    acc = isAbs ? `${acc}/${s}` : acc === '.' ? s : `${acc}/${s}`;
    lines.push(`-mkdir "${acc}"`);
  }
  return lines;
}

function resolveCurlRemoteFilePathForCommand(remote, filename) {
  const cleanName = assertValidBackupFilename(filename);
  const rawDir = String(remote.remotePath || '').trim().replace(/\/+$/, '');
  if (!rawDir || rawDir === '/') {
    return remote.protocol === 'sftp' ? (rawDir === '/' ? `/${cleanName}` : cleanName) : `/${cleanName}`;
  }
  return `${rawDir}/${cleanName}`;
}

async function listRemoteBackups(remote) {
  if (!remote || !remote.host) {
    throw new Error('Remote host is not configured.');
  }

  if (remote.protocol === 'smb') {
    const segs = buildSmbScriptSegments(remote.remotePath);
    const cdCmd = segs.length > 0 ? `cd "${segs.join('/')}" ; ` : '';
    const res = await withSmbClient(remote, `${cdCmd}ls`);
    if (res.code !== 0) {
      const msg = `${res.stderr} ${res.stdout}`.trim();
      if (/NT_STATUS_OBJECT_NAME_NOT_FOUND|NT_STATUS_OBJECT_PATH_NOT_FOUND|NT_STATUS_NO_SUCH_FILE/i.test(msg)) {
        return [];
      }
      throw new Error(msg || `SMB list failed with exit code ${res.code}.`);
    }
    return parseSmbListOutput(res.stdout);
  }

  if (remote.protocol === 'sftp' && remote.authMethod === 'key') {
    return withTempKeyFile(remote.sshPrivateKey, async (keyFile) => {
      const dir = getSftpRemoteDir(remote);
      const batch = dir !== '.' ? `cd "${dir}"\nls -la\n` : 'ls -la\n';
      const res = await runCommand('sftp', buildSftpBaseArgs(remote, keyFile), { stdin: batch, timeoutMs: 60000 });
      if (res.code !== 0) {
        const msg = `${res.stderr} ${res.stdout}`.trim();
        if (/No such file|Can't ls|Couldn't canonicalize/i.test(msg)) {
          return [];
        }
        throw new Error(msg || `SFTP list failed with exit code ${res.code}.`);
      }
      return parseRemoteListLines(res.stdout);
    });
  }

  // curl for FTP, FTPS, or password-based SFTP
  const dirUrl = buildRemoteBaseUrl(remote, true);
  const cfgText = buildCurlConfigText(remote, dirUrl);
  const res = await runCommand('curl', ['-K', '-'], { stdin: cfgText, timeoutMs: 60000 });
  if (res.code !== 0) {
    const errText = `${res.stderr} ${res.stdout}`.trim();
    if (
      res.code === 9 ||
      res.code === 78 ||
      /550|No such file|Failed to open|Server denied you to change|does not exist/i.test(errText)
    ) {
      return [];
    }
    throw new Error(errText || `Remote listing failed (curl exit ${res.code}).`);
  }
  return parseRemoteListLines(res.stdout);
}

async function uploadRemoteBackup(remote, localFilePath, filename) {
  const cleanName = assertValidBackupFilename(filename);
  if (!remote || !remote.host) {
    throw new Error('Remote host is not configured.');
  }

  if (remote.protocol === 'smb') {
    const segs = buildSmbScriptSegments(remote.remotePath);
    const cmds = [];
    for (const seg of segs) {
      cmds.push(`mkdir "${seg}"`);
      cmds.push(`cd "${seg}"`);
    }
    cmds.push(`put "${localFilePath}" "${cleanName}"`);
    const res = await withSmbClient(remote, cmds.join('; '));
    if (res.code !== 0) {
      throw new Error(`${res.stderr} ${res.stdout}`.trim() || `SMB upload failed (exit ${res.code}).`);
    }
    return;
  }

  if (remote.protocol === 'sftp' && remote.authMethod === 'key') {
    return withTempKeyFile(remote.sshPrivateKey, async (keyFile) => {
      const dir = getSftpRemoteDir(remote);
      const lines = [...sftpEnsureDirLines(dir)];
      if (dir !== '.') lines.push(`cd "${dir}"`);
      lines.push(`put "${localFilePath}" "${cleanName}"`);
      const res = await runCommand('sftp', buildSftpBaseArgs(remote, keyFile), {
        stdin: lines.join('\n') + '\n',
        timeoutMs: 120000,
      });
      if (res.code !== 0) {
        throw new Error(`${res.stderr} ${res.stdout}`.trim() || `SFTP upload failed (exit ${res.code}).`);
      }
    });
  }

  const fileUrl = `${buildRemoteBaseUrl(remote, true)}${encodeURIComponent(cleanName)}`;
  const cfgText = buildCurlConfigText(remote, fileUrl, [
    'ftp-create-dirs',
    `upload-file = "${escapeCurlConfigValue(localFilePath)}"`,
  ]);
  const res = await runCommand('curl', ['-K', '-'], { stdin: cfgText, timeoutMs: 120000 });
  if (res.code !== 0) {
    throw new Error(`${res.stderr} ${res.stdout}`.trim() || `Remote upload failed (curl exit ${res.code}).`);
  }
}

async function downloadRemoteBackup(remote, filename, destPath) {
  const cleanName = assertValidBackupFilename(filename);
  if (!remote || !remote.host) {
    throw new Error('Remote host is not configured.');
  }

  if (remote.protocol === 'smb') {
    const segs = buildSmbScriptSegments(remote.remotePath);
    const cdCmd = segs.length > 0 ? `cd "${segs.join('/')}" ; ` : '';
    const res = await withSmbClient(remote, `${cdCmd}get "${cleanName}" "${destPath}"`);
    if (res.code !== 0) {
      throw new Error(`${res.stderr} ${res.stdout}`.trim() || `SMB download failed (exit ${res.code}).`);
    }
    return;
  }

  if (remote.protocol === 'sftp' && remote.authMethod === 'key') {
    return withTempKeyFile(remote.sshPrivateKey, async (keyFile) => {
      const dir = getSftpRemoteDir(remote);
      const batch = (dir !== '.' ? `cd "${dir}"\n` : '') + `get "${cleanName}" "${destPath}"\n`;
      const res = await runCommand('sftp', buildSftpBaseArgs(remote, keyFile), {
        stdin: batch,
        timeoutMs: 120000,
      });
      if (res.code !== 0) {
        throw new Error(`${res.stderr} ${res.stdout}`.trim() || `SFTP download failed (exit ${res.code}).`);
      }
    });
  }

  const fileUrl = `${buildRemoteBaseUrl(remote, true)}${encodeURIComponent(cleanName)}`;
  const cfgText = buildCurlConfigText(remote, fileUrl, [
    `output = "${escapeCurlConfigValue(destPath)}"`,
  ]);
  const res = await runCommand('curl', ['-K', '-'], { stdin: cfgText, timeoutMs: 120000 });
  if (res.code !== 0) {
    throw new Error(`${res.stderr} ${res.stdout}`.trim() || `Remote download failed (curl exit ${res.code}).`);
  }
}

async function deleteRemoteBackup(remote, filename) {
  const cleanName = assertValidBackupFilename(filename);
  if (!remote || !remote.host) {
    throw new Error('Remote host is not configured.');
  }

  if (remote.protocol === 'smb') {
    const segs = buildSmbScriptSegments(remote.remotePath);
    const cdCmd = segs.length > 0 ? `cd "${segs.join('/')}" ; ` : '';
    const res = await withSmbClient(remote, `${cdCmd}del "${cleanName}"`);
    if (res.code !== 0) {
      throw new Error(`${res.stderr} ${res.stdout}`.trim() || `SMB delete failed (exit ${res.code}).`);
    }
    return;
  }

  if (remote.protocol === 'sftp' && remote.authMethod === 'key') {
    return withTempKeyFile(remote.sshPrivateKey, async (keyFile) => {
      const dir = getSftpRemoteDir(remote);
      const batch = (dir !== '.' ? `cd "${dir}"\n` : '') + `rm "${cleanName}"\n`;
      const res = await runCommand('sftp', buildSftpBaseArgs(remote, keyFile), {
        stdin: batch,
        timeoutMs: 60000,
      });
      if (res.code !== 0) {
        throw new Error(`${res.stderr} ${res.stdout}`.trim() || `SFTP delete failed (exit ${res.code}).`);
      }
    });
  }

  const dirUrl = buildRemoteBaseUrl(remote, true);
  let quoteCmd;
  if (remote.protocol === 'sftp') {
    const fullRemoteFile = resolveCurlRemoteFilePathForCommand(remote, cleanName);
    quoteCmd = `-rm ${fullRemoteFile}`;
  } else {
    // Prefix '-' runs DELE after curl CWDs into the target directory and completes LIST
    quoteCmd = `-DELE ${cleanName}`;
  }
  const cfgText = buildCurlConfigText(remote, dirUrl, [
    `quote = "${escapeCurlConfigValue(quoteCmd)}"`,
  ]);
  const res = await runCommand('curl', ['-K', '-'], { stdin: cfgText, timeoutMs: 60000 });
  if (res.code !== 0) {
    throw new Error(`${res.stderr} ${res.stdout}`.trim() || `Remote delete failed (curl exit ${res.code}).`);
  }
}

async function testRemoteConnection(remote) {
  if (!remote || !remote.host) {
    throw new Error('Remote host is required.');
  }

  if (remote.protocol === 'smb') {
    const segs = buildSmbScriptSegments(remote.remotePath);
    const tryDir = segs.length > 0 ? `cd "${segs.join('/')}" ; ls` : 'ls';
    let res = await withSmbClient(remote, tryDir);
    if (res.code !== 0 && segs.length > 0) {
      const msg = `${res.stderr} ${res.stdout}`.trim();
      if (/NT_STATUS_OBJECT_NAME_NOT_FOUND|NT_STATUS_OBJECT_PATH_NOT_FOUND/i.test(msg)) {
        // Test root share connectivity even if subfolder doesn't exist yet
        const rootRes = await withSmbClient(remote, 'ls');
        if (rootRes.code === 0) {
          return {
            ok: true,
            protocol: 'smb',
            directoryMissing: true,
            fileCount: 0,
            message: `Connected to SMB share //${remote.host}/${remote.share}. Folder will be created on first backup.`,
          };
        }
        res = rootRes;
      }
      throw new Error(`${res.stderr} ${res.stdout}`.trim() || `SMB connection failed (exit ${res.code}).`);
    }
    if (res.code !== 0) {
      throw new Error(`${res.stderr} ${res.stdout}`.trim() || `SMB connection failed (exit ${res.code}).`);
    }
    const files = parseSmbListOutput(res.stdout);
    return {
      ok: true,
      protocol: 'smb',
      directoryMissing: false,
      fileCount: files.length,
      message: `Connected to //${remote.host}/${remote.share}. Found ${files.length} backup(s).`,
    };
  }

  if (remote.protocol === 'sftp' && remote.authMethod === 'key') {
    return withTempKeyFile(remote.sshPrivateKey, async (keyFile) => {
      const dir = getSftpRemoteDir(remote);
      const res = await runCommand('sftp', buildSftpBaseArgs(remote, keyFile), {
        stdin: dir !== '.' ? `cd "${dir}"\nls -la\n` : 'ls -la\n',
        timeoutMs: 30000,
      });
      if (res.code !== 0) {
        const msg = `${res.stderr} ${res.stdout}`.trim();
        if (/No such file|Couldn't canonicalize/i.test(msg)) {
          // Verify base login works
          const baseRes = await runCommand('sftp', buildSftpBaseArgs(remote, keyFile), {
            stdin: 'pwd\n',
            timeoutMs: 30000,
          });
          if (baseRes.code === 0) {
            return {
              ok: true,
              protocol: 'sftp',
              directoryMissing: true,
              fileCount: 0,
              message: `Authenticated via SFTP key on ${remote.host}. Folder "${dir}" will be created on first backup.`,
            };
          }
        }
        throw new Error(msg || `SFTP key connection failed (exit ${res.code}).`);
      }
      const files = parseRemoteListLines(res.stdout);
      return {
        ok: true,
        protocol: 'sftp',
        directoryMissing: false,
        fileCount: files.length,
        message: `Connected to SFTP ${remote.host}. Found ${files.length} backup(s).`,
      };
    });
  }

  // FTP, FTPS, or password SFTP via curl
  const dirUrl = buildRemoteBaseUrl(remote, true);
  const res = await runCommand('curl', ['-K', '-'], {
    stdin: buildCurlConfigText(remote, dirUrl),
    timeoutMs: 30000,
  });
  if (res.code !== 0) {
    const msg = `${res.stderr} ${res.stdout}`.trim();
    if (
      res.code === 9 ||
      res.code === 78 ||
      /550|No such file|Failed to open|Server denied you to change/i.test(msg)
    ) {
      // Check root login to confirm auth succeeded vs missing folder
      const rootSchemeUrl = `${dirUrl.split('/').slice(0, 3).join('/')}/`;
      const rootRes = await runCommand('curl', ['-K', '-'], {
        stdin: buildCurlConfigText(remote, rootSchemeUrl),
        timeoutMs: 30000,
      });
      if (rootRes.code === 0) {
        return {
          ok: true,
          protocol: remote.protocol,
          directoryMissing: true,
          fileCount: 0,
          message: `Connected to ${remote.protocol.toUpperCase()} ${remote.host}. Remote folder will be created on first backup.`,
        };
      }
    }
    throw new Error(msg || `Connection failed (curl exit ${res.code}).`);
  }
  const files = parseRemoteListLines(res.stdout);
  return {
    ok: true,
    protocol: remote.protocol,
    directoryMissing: false,
    fileCount: files.length,
    message: `Connected to ${remote.protocol.toUpperCase()} ${remote.host}. Found ${files.length} backup(s).`,
  };
}

function listLocalBackups(localDir) {
  if (!localDir || !fs.existsSync(localDir)) return [];
  const entries = fs.readdirSync(localDir, { withFileTypes: true });
  const files = [];
  for (const ent of entries) {
    if (!ent.isFile() || !BACKUP_FILE_REGEX.test(ent.name)) continue;
    const fullPath = path.join(localDir, ent.name);
    const st = fs.statSync(fullPath);
    const fnameTs = parseBackupFilenameTimestamp(ent.name);
    files.push({
      filename: ent.name,
      sizeBytes: st.size,
      createdAt: new Date(fnameTs ?? st.mtimeMs).toISOString(),
      timestampMs: fnameTs ?? st.mtimeMs,
    });
  }
  files.sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0));
  return files;
}

function deleteLocalBackup(localDir, filename) {
  const cleanName = assertValidBackupFilename(filename);
  const fullPath = path.join(localDir, cleanName);
  const resolved = path.resolve(fullPath);
  const resolvedDir = path.resolve(localDir);
  if (!resolved.startsWith(resolvedDir + path.sep)) {
    const err = new Error('Forbidden backup path.');
    err.statusCode = 403;
    throw err;
  }
  if (!fs.existsSync(resolved)) {
    const err = new Error('Backup file not found.');
    err.statusCode = 404;
    throw err;
  }
  fs.unlinkSync(resolved);
  return true;
}

function buildBackupBuffer(db, receiptsDir, { compress = true, includeReceipts = true } = {}) {
  const payload = exportFullBackup(db, receiptsDir, { includeReceipts });
  const jsonStr = JSON.stringify(payload);
  const rawBuf = Buffer.from(jsonStr, 'utf8');
  const buf = compress ? zlib.gzipSync(rawBuf, { level: 6 }) : rawBuf;
  return { buf, rawBytes: rawBuf.length, counts: {
    accounts: payload.accounts.length,
    pockets: payload.pockets.length,
    transactions: payload.transactions.length,
    receipts: payload.receipts.length,
  } };
}

async function runBackupNow(db, ctx, { trigger = 'manual', target = 'all' } = {}) {
  if (activeBackupPromise) {
    return activeBackupPromise;
  }

  const runTask = async () => {
    const startedAt = new Date();
    const cfg = resolveDecryptedConfig(db, ctx.dataDir);
    const localDir = resolveLocalBackupDir(cfg, ctx.defaultBackupsDir);
    const doLocal = (target === 'local' || (target === 'all' && cfg.local.enabled));
    const doRemote = (target === 'remote' || (target === 'all' && cfg.remote.enabled));

    const filename = buildBackupFilename(startedAt, cfg.compress);
    const { buf, counts } = buildBackupBuffer(db, ctx.receiptsDir, {
      compress: cfg.compress,
      includeReceipts: cfg.includeReceipts,
    });

    const stagePath = path.join(os.tmpdir(), `mm-stage-${crypto.randomBytes(8).toString('hex')}-${filename}`);
    fs.writeFileSync(stagePath, buf);

    const summary = {
      id: crypto.randomBytes(6).toString('hex'),
      startedAt: startedAt.toISOString(),
      finishedAt: null,
      trigger,
      target,
      filename,
      sizeBytes: buf.length,
      compressed: cfg.compress,
      includeReceipts: cfg.includeReceipts,
      counts,
      local: null,
      remote: null,
      status: 'ok',
    };

    try {
      // 1. Local target + independent local retention
      if (doLocal) {
        try {
          if (!fs.existsSync(localDir)) {
            fs.mkdirSync(localDir, { recursive: true });
          }
          const destPath = path.join(localDir, filename);
          fs.copyFileSync(stagePath, destPath);

          const beforeFiles = listLocalBackups(localDir);
          const { toDelete, kept, totalKeptBytes } = computeRetentionDeletes(
            beforeFiles,
            cfg.local,
            Date.now(),
            filename
          );
          let prunedBytes = 0;
          for (const dead of toDelete) {
            try {
              fs.unlinkSync(path.join(localDir, dead.filename));
              prunedBytes += dead.sizeBytes;
            } catch {
              // ignore single unlink failure
            }
          }
          summary.local = {
            ok: true,
            directory: localDir,
            filename,
            sizeBytes: buf.length,
            prunedCount: toDelete.length,
            prunedBytes,
            keptCount: kept.length,
            totalBytes: totalKeptBytes,
          };
        } catch (err) {
          summary.local = {
            ok: false,
            directory: localDir,
            error: err.message || 'Local backup failed.',
          };
        }
      } else if (target === 'all') {
        summary.local = { skipped: true };
      }

      // 2. Remote target + independent remote retention
      if (doRemote) {
        try {
          if (!cfg.remote.host) {
            throw new Error('Remote host is not configured.');
          }
          await uploadRemoteBackup(cfg.remote, stagePath, filename);
          const listed = await listRemoteBackups(cfg.remote);
          const { toDelete, kept, totalKeptBytes } = computeRetentionDeletes(
            listed,
            cfg.remote,
            Date.now(),
            filename
          );
          let prunedCount = 0;
          let prunedBytes = 0;
          const pruneErrors = [];
          for (const dead of toDelete) {
            try {
              await deleteRemoteBackup(cfg.remote, dead.filename);
              prunedCount += 1;
              prunedBytes += dead.sizeBytes;
            } catch (err) {
              pruneErrors.push(`${dead.filename}: ${err.message}`);
            }
          }
          summary.remote = {
            ok: true,
            protocol: cfg.remote.protocol,
            host: cfg.remote.host,
            remotePath: cfg.remote.remotePath,
            filename,
            sizeBytes: buf.length,
            prunedCount,
            prunedBytes,
            keptCount: kept.length,
            totalBytes: totalKeptBytes,
            pruneWarnings: pruneErrors.length > 0 ? pruneErrors : undefined,
          };
        } catch (err) {
          summary.remote = {
            ok: false,
            protocol: cfg.remote.protocol,
            host: cfg.remote.host,
            error: err.message || 'Remote backup failed.',
          };
        }
      } else if (target === 'all') {
        summary.remote = { skipped: true };
      }

      const localFailed = summary.local && summary.local.ok === false;
      const remoteFailed = summary.remote && summary.remote.ok === false;
      if (localFailed && remoteFailed) summary.status = 'error';
      else if (localFailed || remoteFailed) summary.status = 'partial';
      else summary.status = 'ok';

      summary.finishedAt = new Date().toISOString();

      // Persist lastRunAt & nextRunAt without altering encrypted secrets
      const storedCfg = getBackupConfig(db);
      storedCfg.lastRunAt = summary.finishedAt;
      storedCfg.nextRunAt = storedCfg.enabled ? computeNextRunAt(storedCfg, new Date()) : null;
      setSetting(db, 'backup_config', JSON.stringify(storedCfg));
      appendBackupHistory(db, summary);

      return summary;
    } finally {
      try {
        fs.unlinkSync(stagePath);
      } catch {
        // ignore
      }
    }
  };

  activeBackupPromise = runTask().finally(() => {
    activeBackupPromise = null;
  });
  return activeBackupPromise;
}

async function restoreFromSavedBackup(db, ctx, { source = 'local', filename, mode = 'replace' } = {}) {
  const cleanName = assertValidBackupFilename(filename);
  const restoreMode = mode === 'merge' ? 'merge' : 'replace';

  if (source === 'remote') {
    const cfg = resolveDecryptedConfig(db, ctx.dataDir);
    if (!cfg.remote.host) {
      const err = new Error('Remote backup host is not configured.');
      err.statusCode = 400;
      throw err;
    }
    const tmpDest = path.join(os.tmpdir(), `mm-restore-${crypto.randomBytes(8).toString('hex')}-${cleanName}`);
    try {
      await downloadRemoteBackup(cfg.remote, cleanName, tmpDest);
      const buf = fs.readFileSync(tmpDest);
      return restoreFullBackup(db, ctx.receiptsDir, buf, { mode: restoreMode });
    } finally {
      try {
        fs.unlinkSync(tmpDest);
      } catch {
        // ignore
      }
    }
  }

  const cfg = getBackupConfig(db);
  const localDir = resolveLocalBackupDir(cfg, ctx.defaultBackupsDir);
  const fullPath = path.resolve(localDir, cleanName);
  const resolvedDir = path.resolve(localDir);
  if (!fullPath.startsWith(resolvedDir + path.sep) || !fs.existsSync(fullPath)) {
    const err = new Error('Local backup file not found.');
    err.statusCode = 404;
    throw err;
  }
  const buf = fs.readFileSync(fullPath);
  return restoreFullBackup(db, ctx.receiptsDir, buf, { mode: restoreMode });
}

function getBackupStatusSnapshot(db, ctx) {
  const storedCfg = getBackupConfig(db);
  const localDir = resolveLocalBackupDir(storedCfg, ctx.defaultBackupsDir);
  const localFiles = listLocalBackups(localDir);
  const localTotalBytes = localFiles.reduce((s, f) => s + (Number(f.sizeBytes) || 0), 0);
  return {
    config: sanitizeConfigForClient(storedCfg, ctx.defaultBackupsDir),
    capabilities: detectTransportCapabilities(),
    running: Boolean(activeBackupPromise),
    localFiles,
    localTotalBytes,
    history: getBackupHistory(db),
  };
}

function startBackupScheduler(db, ctx) {
  try {
    const cfg = getBackupConfig(db);
    if (cfg.enabled && !cfg.nextRunAt) {
      cfg.nextRunAt = computeNextRunAt(cfg, new Date());
      setSetting(db, 'backup_config', JSON.stringify(cfg));
    }
  } catch {
    // ignore startup scheduling issue
  }

  const tick = async () => {
    try {
      if (activeBackupPromise) return;
      const cfg = getBackupConfig(db);
      if (!cfg.enabled || !cfg.nextRunAt) return;
      const dueMs = Date.parse(cfg.nextRunAt);
      if (Number.isFinite(dueMs) && Date.now() >= dueMs) {
        await runBackupNow(db, ctx, { trigger: 'scheduled', target: 'all' });
      }
    } catch {
      // background scheduler errors are recorded in history or ignored
    }
  };

  const timer = setInterval(tick, 60 * 1000);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  return {
    tick,
    stop() {
      clearInterval(timer);
    },
  };
}

module.exports = {
  BACKUP_FILE_REGEX,
  buildBackupFilename,
  parseBackupFilenameTimestamp,
  assertValidBackupFilename,
  defaultPortForProtocol,
  getBackupConfig,
  resolveDecryptedConfig,
  sanitizeConfigForClient,
  resolveLocalBackupDir,
  saveBackupConfig,
  computeNextRunAt,
  computeRetentionDeletes,
  detectTransportCapabilities,
  parseRemoteListLines,
  parseSmbListOutput,
  buildRemoteBaseUrl,
  buildCurlConfigText,
  buildSmbAuthFileContent,
  buildSmbScriptSegments,
  buildSftpBaseArgs,
  listLocalBackups,
  deleteLocalBackup,
  listRemoteBackups,
  uploadRemoteBackup,
  downloadRemoteBackup,
  deleteRemoteBackup,
  testRemoteConnection,
  runBackupNow,
  restoreFromSavedBackup,
  getBackupHistory,
  getBackupStatusSnapshot,
  startBackupScheduler,
};
