'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const { initDatabase, seedCounterpartiesFromTransactions, getSetting, setSetting, getFxRates } = require('./db');
const {
  SESSION_COOKIE_NAME,
  sanitizeSessionTimeoutMinutes,
  getSessionTimeoutMinutes,
  updateActiveSessionsTimeout,
  hasAnyUser,
  createUser,
  updatePassword,
  authenticateUser,
  createSession,
  getSessionUser,
  deleteSession,
  parseCookies,
  isHttpsRequest,
  buildSessionCookie,
  buildClearCookie,
  getClientIp,
} = require('./auth');
const { createRateLimiter, createConcurrencyLimiter } = require('./rateLimit');
const {
  recalculateAllBalances,
  getLocalIsoDate,
  getLocalIsoDateTime,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  approveTransaction,
  approveAllTransactions,
  bulkManageTransactions,
  syncPocketBalance,
  getDashboardData,
  saveDashboardLayout,
  upsertCounterparty,
  updateCounterparty,
  deleteCounterparty,
  listCounterparties,
  findBestMatchingCounterparty,
  cleanRawMerchantString,
  isGenericCounterpartyName,
  updateAccount,
  deleteAccount,
  updatePocket,
  deletePocket,
} = require('./ledger');
const { ingestBankNotification } = require('./notifications');
const {
  getOrCreateVapidKeys,
  savePushSubscription,
  removePushSubscription,
  countPushSubscriptions,
  broadcastPushNotification,
  notifyAutoLoggedTransaction,
} = require('./push');
const {
  DEFAULT_GEMINI_MODEL,
  resolveGeminiModel,
  analyzeReceiptImage,
  testGeminiConnection,
  getGeminiUsageStats,
  recordGeminiUsage,
} = require('./gemini');
const {
  previewImport,
  commitImport,
  exportFullBackup,
  previewBackupPayload,
  restoreFullBackup,
} = require('./importer');
const {
  assertValidBackupFilename,
  getBackupConfig,
  resolveDecryptedConfig,
  resolveLocalBackupDir,
  saveBackupConfig,
  listRemoteBackups,
  deleteRemoteBackup,
  testRemoteConnection,
  deleteLocalBackup,
  runBackupNow,
  restoreFromSavedBackup,
  getBackupStatusSnapshot,
  startBackupScheduler,
} = require('./backups');
const { normalizeCurrency, parseFxRates, fetchLiveFxRates, roundCurrency } = require('./fx');

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const BASE_CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "form-action 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
];

function buildCspHeader(isHttps) {
  return (isHttps ? [...BASE_CSP_DIRECTIVES, 'upgrade-insecure-requests'] : BASE_CSP_DIRECTIVES).join('; ');
}

function setSecurityHeaders(res, req = null) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self)');
  if (req || !res.hasHeader('Content-Security-Policy')) {
    const https = isHttpsRequest(req);
    res.setHeader('Content-Security-Policy', buildCspHeader(https));
    if (https) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
  }
}

function resolveHintedPocketId(db, bankHint, pocketHint, fallbackPocketId = null, excludePocketId = null) {
  const rows = db
    .prepare(
      `SELECT p.id, p.name AS pocket_name, p.is_default, a.name AS account_name
       FROM pockets p
       JOIN accounts a ON a.id = p.account_id
       WHERE a.is_archived = 0 AND p.is_archived = 0
       ORDER BY
         p.is_default DESC,
         CASE WHEN LOWER(p.name) IN ('main', 'fo számla', 'fő számla', 'főszámla') THEN 0 ELSE 1 END ASC,
         p.id ASC`
    )
    .all()
    .filter((r) => !excludePocketId || r.id !== Number(excludePocketId));

  const cleanBank = typeof bankHint === 'string' ? bankHint.trim().toLowerCase() : '';
  const cleanPocket = typeof pocketHint === 'string' ? pocketHint.trim().toLowerCase() : '';

  let pool = cleanBank ? rows.filter((r) => r.account_name.toLowerCase() === cleanBank) : rows;
  if (cleanBank && pool.length === 0) {
    pool = rows.filter((r) => r.account_name.toLowerCase().includes(cleanBank));
  }
  if (cleanPocket && pool.length > 0) {
    const exactOrSub = pool.find(
      (r) =>
        r.pocket_name.toLowerCase().includes(cleanPocket) ||
        cleanPocket.includes(r.pocket_name.toLowerCase())
    );
    if (exactOrSub) return exactOrSub.id;
  }
  if (cleanBank && pool.length > 0) {
    return pool[0].id;
  }
  if (!cleanBank && cleanPocket) {
    const anyMatch = rows.find(
      (r) =>
        r.pocket_name.toLowerCase().includes(cleanPocket) ||
        cleanPocket.includes(r.pocket_name.toLowerCase())
    );
    if (anyMatch) return anyMatch.id;
  }
  return fallbackPocketId || null;
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  setSecurityHeaders(res);
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function sendError(res, statusCode, message, extraHeaders = {}) {
  sendJson(res, statusCode, { error: message }, extraHeaders);
}

function sendRateLimited(res, rlResult, message = '') {
  const retryAfter = Math.max(1, Number(rlResult?.retryAfterSec) || 1);
  sendJson(
    res,
    429,
    {
      error: message || `Too many requests. Please try again in ${retryAfter}s.`,
      retryAfterSec: retryAfter,
    },
    {
      'Retry-After': String(retryAfter),
      'X-RateLimit-Limit': String(rlResult?.limit ?? 0),
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(Math.ceil((rlResult?.resetAt || Date.now() + retryAfter * 1000) / 1000)),
    }
  );
}

function readRawBody(req, maxBytes = 16 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        const err = new Error('Payload too large.');
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readRequestBody(req, maxBytes = 16 * 1024 * 1024) {
  const buf = await readRawBody(req, maxBytes);
  const ctype = (req.headers['content-type'] || '').toLowerCase();
  if (buf.length === 0) return {};
  try {
    if (ctype.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(buf.toString('utf8'));
      return Object.fromEntries(params.entries());
    }
    return JSON.parse(buf.toString('utf8'));
  } catch {
    const err = new Error('Invalid request body format.');
    err.statusCode = 400;
    throw err;
  }
}

function tryParseRelaxedJson(rawStr) {
  const attempts = [
    rawStr,
    rawStr.replace(/\r?\n/g, ' ').replace(/\t/g, ' '),
  ];
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // fallback to next recovery strategy
    }
  }
  return null;
}

async function readNotificationWebhookPayload(req, parsedUrl, maxBytes = 512 * 1024) {
  const buf = await readRawBody(req, maxBytes);
  const rawStr = buf.toString('utf8').trim();
  const ctype = (req.headers['content-type'] || '').toLowerCase();
  let parsed = {};

  if (rawStr) {
    if (ctype.includes('application/x-www-form-urlencoded')) {
      parsed = Object.fromEntries(new URLSearchParams(rawStr).entries());
    } else {
      const jsonObj = tryParseRelaxedJson(rawStr);
      if (jsonObj) {
        parsed = jsonObj;
      } else if (!rawStr.startsWith('{') && rawStr.includes('|')) {
        const parts = rawStr.split('|').map((s) => s.trim());
        parsed = parts.length >= 3
          ? { app: parts[0], title: parts[1], text: parts.slice(2).join(' ') }
          : { app: parts[0], text: parts.slice(1).join(' ') };
      } else {
        // Handle unescaped quotes or raw Magic Text strings (e.g. [trigger_fired])
        const recovered = { rawText: rawStr };
        for (const key of ['app', 'package', 'packageName', 'title', 'token']) {
          const m = new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, 'i').exec(rawStr);
          if (m) recovered[key] = m[1];
        }
        parsed = recovered;
      }
    }
  }

  for (const qp of ['app', 'package', 'packageName', 'title', 'text', 'bigText', 'token', 'pocketId']) {
    const val = parsedUrl.searchParams.get(qp);
    if (val && !parsed[qp]) parsed[qp] = val;
  }
  return parsed;
}

function getWebhookLogs(db) {
  try {
    const raw = getSetting(db, 'notification_webhook_logs', '');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function recordWebhookLog(db, req, body, outcome) {
  try {
    const logs = getWebhookLogs(db);
    const previewParts = [body?.app, body?.title, body?.text || body?.bigText || body?.rawText]
      .map((s) => String(s || '').trim())
      .filter(Boolean);
    const entry = {
      at: new Date().toISOString(),
      source: String(req.headers['user-agent'] || '').slice(0, 60),
      preview: previewParts.join(' | ').slice(0, 180) || '(empty body)',
      logged: Boolean(outcome?.logged),
      statusText: outcome?.logged && outcome?.transaction
        ? `${outcome.transaction.account_name} -> ${outcome.transaction.pocket_name} (${outcome.transaction.amount} ${outcome.transaction.currency})`
        : String(outcome?.reason || 'Ignored'),
    };
    setSetting(db, 'notification_webhook_logs', JSON.stringify([entry, ...logs].slice(0, 15)));
  } catch {
    // ignore logging failure
  }
}

function extensionFromMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return '.png';
  if (m.includes('webp')) return '.webp';
  if (m.includes('heic')) return '.heic';
  return '.jpg';
}

function createApp(options = {}) {
  const rootDir = options.rootDir || path.resolve(__dirname, '..');
  const dataDir = options.dataDir || path.join(rootDir, 'data');
  const dbPath = options.dbPath || process.env.DB_PATH || path.join(dataDir, 'moneymanager.db');
  const receiptsDir = options.receiptsDir || process.env.RECEIPTS_DIR || path.join(dataDir, 'receipts');
  const backupsDir = options.backupsDir || path.join(dataDir, 'backups');
  const publicDir = options.publicDir || path.join(rootDir, 'public');

  if (!fs.existsSync(receiptsDir)) {
    fs.mkdirSync(receiptsDir, { recursive: true });
  }
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  const db = initDatabase(dbPath);
  seedCounterpartiesFromTransactions(db);
  recalculateAllBalances(db);

  const backupCtx = { dataDir, receiptsDir, defaultBackupsDir: backupsDir };
  const backupScheduler = options.disableScheduler ? null : startBackupScheduler(db, backupCtx);

  const rlCfg = options.rateLimit || {};
  const globalLimiter = createRateLimiter({
    windowMs: rlCfg.globalWindowMs || 60 * 1000,
    max: rlCfg.globalMax || Number(process.env.RATE_LIMIT_GLOBAL_MAX) || 600,
  });
  const apiLimiter = createRateLimiter({
    windowMs: rlCfg.apiWindowMs || 60 * 1000,
    max: rlCfg.apiMax || Number(process.env.RATE_LIMIT_API_MAX) || 300,
  });
  const authBurstLimiter = createRateLimiter({
    windowMs: rlCfg.authWindowMs || 15 * 60 * 1000,
    max: rlCfg.authBurstMax || 25,
    blockMs: rlCfg.authBlockMs || 15 * 60 * 1000,
  });
  const loginFailIpLimiter = createRateLimiter({
    windowMs: rlCfg.loginWindowMs || 15 * 60 * 1000,
    max: rlCfg.loginFailMax || 8,
    blockMs: rlCfg.loginBlockMs || 15 * 60 * 1000,
  });
  const loginFailUserLimiter = createRateLimiter({
    windowMs: rlCfg.loginWindowMs || 15 * 60 * 1000,
    max: rlCfg.loginUserFailMax || 12,
    blockMs: rlCfg.loginBlockMs || 15 * 60 * 1000,
  });
  const pwChangeFailLimiter = createRateLimiter({
    windowMs: rlCfg.loginWindowMs || 15 * 60 * 1000,
    max: rlCfg.pwChangeFailMax || 8,
    blockMs: rlCfg.loginBlockMs || 15 * 60 * 1000,
  });
  const webhookFailLimiter = createRateLimiter({
    windowMs: rlCfg.webhookFailWindowMs || 15 * 60 * 1000,
    max: rlCfg.webhookFailMax || 10,
    blockMs: rlCfg.webhookFailBlockMs || 15 * 60 * 1000,
  });
  const webhookTrafficLimiter = createRateLimiter({
    windowMs: rlCfg.webhookWindowMs || 60 * 1000,
    max: rlCfg.webhookMax || 60,
  });
  const heavyEndpointLimiter = createRateLimiter({
    windowMs: rlCfg.heavyWindowMs || 60 * 1000,
    max: rlCfg.heavyMax || 30,
  });
  const concurrencyLimiter = createConcurrencyLimiter(rlCfg.maxConcurrentPerIp || 40);

  const server = http.createServer(async (req, res) => {
    setSecurityHeaders(res, req);
    const clientIp = getClientIp(req);
    const releaseConcurrency = concurrencyLimiter.acquire(clientIp);
    if (!releaseConcurrency) {
      return sendRateLimited(res, { retryAfterSec: 2, limit: rlCfg.maxConcurrentPerIp || 40 }, 'Too many concurrent requests from your IP.');
    }
    res.on('close', releaseConcurrency);
    try {
      const globalRl = globalLimiter.consume(clientIp);
      if (!globalRl.allowed) {
        return sendRateLimited(res, globalRl, `Too many requests. Try again in ${globalRl.retryAfterSec}s.`);
      }

      const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const rawPathname = parsedUrl.pathname;
      if (rawPathname === '/moneymanager') {
        res.writeHead(301, { Location: `/moneymanager/${parsedUrl.search || ''}` });
        return res.end();
      }
      const pathname = rawPathname.startsWith('/moneymanager/')
        ? rawPathname.slice('/moneymanager'.length) || '/'
        : rawPathname;
      const method = (req.method || 'GET').toUpperCase();

      if (pathname.startsWith('/api/')) {
        const apiRl = apiLimiter.consume(clientIp);
        if (!apiRl.allowed) {
          return sendRateLimited(res, apiRl, `API rate limit exceeded. Try again in ${apiRl.retryAfterSec}s.`);
        }
      }

      const cookies = parseCookies(req.headers.cookie);
      const rawSessionToken = cookies[SESSION_COOKIE_NAME];
      const isNoTouchStatus = pathname === '/api/auth/status' && parsedUrl.searchParams.get('touch') === '0';
      const sessionUser = getSessionUser(db, rawSessionToken, { touch: !isNoTouchStatus });

      // -------------------- AUTH ENDPOINTS --------------------
      if (pathname === '/api/auth/status' && method === 'GET') {
        return sendJson(res, 200, {
          initialized: hasAnyUser(db),
          authenticated: Boolean(sessionUser),
          user: sessionUser ? { id: sessionUser.id, username: sessionUser.username } : null,
          sessionTimeoutMinutes: getSessionTimeoutMinutes(db),
          expiresAt: sessionUser ? sessionUser.expiresAt : null,
        });
      }

      if (pathname === '/api/auth/setup' && method === 'POST') {
        const authBurst = authBurstLimiter.consume(clientIp);
        if (!authBurst.allowed) {
          return sendRateLimited(res, authBurst, `Too many authentication requests. Try again in ${authBurst.retryAfterSec}s.`);
        }
        if (hasAnyUser(db)) {
          return sendError(res, 403, 'Account is already initialized. Please sign in.');
        }
        const body = await readRequestBody(req, 64 * 1024);
        const user = createUser(db, body.username, body.password);
        const { rawToken, expiresAt, timeoutMinutes } = createSession(db, user.id);
        return sendJson(
          res,
          201,
          {
            ok: true,
            user: { id: user.id, username: user.username },
            sessionTimeoutMinutes: timeoutMinutes,
            expiresAt,
          },
          { 'Set-Cookie': buildSessionCookie(rawToken, req) }
        );
      }

      if (pathname === '/api/auth/login' && method === 'POST') {
        const authBurst = authBurstLimiter.consume(clientIp);
        if (!authBurst.allowed) {
          return sendRateLimited(res, authBurst, `Too many login requests. Try again in ${authBurst.retryAfterSec}s.`);
        }
        const ipFailStatus = loginFailIpLimiter.peek(clientIp);
        if (!ipFailStatus.allowed) {
          return sendRateLimited(res, ipFailStatus, `Too many failed login attempts. Try again in ${ipFailStatus.retryAfterSec}s.`);
        }
        const body = await readRequestBody(req, 64 * 1024);
        const userKey = String(body.username || '').trim().toLowerCase() || '_blank_';
        const userFailStatus = loginFailUserLimiter.peek(userKey);
        if (!userFailStatus.allowed) {
          return sendRateLimited(res, userFailStatus, `Too many failed login attempts for this account. Try again in ${userFailStatus.retryAfterSec}s.`);
        }

        const user = authenticateUser(db, body.username, body.password);
        if (!user) {
          loginFailIpLimiter.recordFailure(clientIp);
          loginFailUserLimiter.recordFailure(userKey);
          return sendError(res, 401, 'Invalid username or password.');
        }
        loginFailIpLimiter.reset(clientIp);
        loginFailUserLimiter.reset(userKey);
        const { rawToken, expiresAt, timeoutMinutes } = createSession(db, user.id);

        // Support native browser form submit fallback redirect if not fetch/JSON
        const accept = req.headers.accept || '';
        if ((req.headers['content-type'] || '').includes('application/x-www-form-urlencoded') && !accept.includes('application/json')) {
          res.writeHead(303, {
            Location: '../../',
            'Set-Cookie': buildSessionCookie(rawToken, req),
          });
          return res.end();
        }

        return sendJson(
          res,
          200,
          { ok: true, user, sessionTimeoutMinutes: timeoutMinutes, expiresAt },
          { 'Set-Cookie': buildSessionCookie(rawToken, req) }
        );
      }

      if (pathname === '/api/auth/logout' && method === 'POST') {
        deleteSession(db, rawSessionToken);
        return sendJson(res, 200, { ok: true }, { 'Set-Cookie': buildClearCookie(req) });
      }

      // -------------------- BANK NOTIFICATION WEBHOOK --------------------
      if (pathname === '/api/notifications/webhook' && method === 'POST') {
        const whFailPeek = webhookFailLimiter.peek(clientIp);
        if (!whFailPeek.allowed) {
          return sendRateLimited(res, whFailPeek, `Too many failed webhook authentication attempts. Try again in ${whFailPeek.retryAfterSec}s.`);
        }
        const whTraffic = webhookTrafficLimiter.consume(clientIp);
        if (!whTraffic.allowed) {
          return sendRateLimited(res, whTraffic, `Webhook rate limit exceeded. Try again in ${whTraffic.retryAfterSec}s.`);
        }
        const body = await readNotificationWebhookPayload(req, parsedUrl, 512 * 1024);
        const expectedToken = getSetting(db, 'notification_webhook_token', '');
        const authHeader = String(req.headers.authorization || '');
        const bearerToken = /^Bearer\s+(.+)$/i.exec(authHeader)?.[1] || '';
        const providedToken = String(
          bearerToken ||
            req.headers['x-webhook-token'] ||
            parsedUrl.searchParams.get('token') ||
            body.token ||
            ''
        ).trim();

        const validWebhookToken =
          expectedToken.length > 0 &&
          providedToken.length === expectedToken.length &&
          crypto.timingSafeEqual(Buffer.from(providedToken, 'utf8'), Buffer.from(expectedToken, 'utf8'));

        if (!sessionUser && !validWebhookToken) {
          webhookFailLimiter.recordFailure(clientIp);
          return sendError(res, 401, 'Invalid webhook token or authentication required.');
        }
        webhookFailLimiter.reset(clientIp);

        if (Array.isArray(body.notifications)) {
          const results = body.notifications.map((item) => {
            const resItem = ingestBankNotification(db, resolveHintedPocketId, item);
            recordWebhookLog(db, req, item, resItem);
            if (resItem.logged && resItem.transaction) {
              notifyAutoLoggedTransaction(db, resItem.transaction, 'Bank Notification').catch(() => {});
            }
            return resItem;
          });
          const loggedCount = results.filter((r) => r.logged).length;
          return sendJson(res, 200, { ok: true, loggedCount, results });
        }

        const result = ingestBankNotification(db, resolveHintedPocketId, body);
        recordWebhookLog(db, req, body, result);
        if (result.logged && result.transaction) {
          notifyAutoLoggedTransaction(db, result.transaction, 'Bank Notification').catch(() => {});
        }
        return sendJson(res, 200, { ok: true, ...result });
      }

      // -------------------- PROTECTED API GUARD --------------------
      if (pathname.startsWith('/api/')) {
        if (!sessionUser) {
          return sendError(res, 401, 'Authentication required.');
        }
      }

      if (pathname === '/api/auth/ping' && method === 'POST') {
        return sendJson(res, 200, {
          ok: true,
          sessionTimeoutMinutes: sessionUser.timeoutMinutes,
          expiresAt: sessionUser.expiresAt,
        });
      }

      if (pathname === '/api/auth/change-password' && method === 'POST') {
        const pwKey = `${clientIp}:${sessionUser.id}`;
        const pwFailPeek = pwChangeFailLimiter.peek(pwKey);
        if (!pwFailPeek.allowed) {
          return sendRateLimited(res, pwFailPeek, `Too many incorrect password attempts. Try again in ${pwFailPeek.retryAfterSec}s.`);
        }
        const body = await readRequestBody(req, 64 * 1024);
        const verified = authenticateUser(db, sessionUser.username, body.currentPassword);
        if (!verified) {
          pwChangeFailLimiter.recordFailure(pwKey);
          return sendError(res, 400, 'Current password is incorrect.');
        }
        pwChangeFailLimiter.reset(pwKey);
        updatePassword(db, sessionUser.id, body.newPassword);
        return sendJson(res, 200, { ok: true });
      }

      if (
        method === 'POST' &&
        (pathname === '/api/receipts/scan' ||
          pathname === '/api/import/preview' ||
          pathname === '/api/import/commit' ||
          pathname === '/api/push/test')
      ) {
        const heavyRl = heavyEndpointLimiter.consume(clientIp);
        if (!heavyRl.allowed) {
          return sendRateLimited(res, heavyRl, `Too many upload or scan requests. Try again in ${heavyRl.retryAfterSec}s.`);
        }
      }

      // -------------------- DASHBOARD & TRANSACTIONS --------------------
      if (pathname === '/api/dashboard' && method === 'GET') {
        const filters = {
          month: parsedUrl.searchParams.get('month') || 'all',
          accountId: parsedUrl.searchParams.get('accountId') || '',
          pocketId: parsedUrl.searchParams.get('pocketId') || '',
          type: parsedUrl.searchParams.get('type') || 'all',
          categoryName: parsedUrl.searchParams.get('categoryName') || 'all',
          historical: parsedUrl.searchParams.get('historical') || 'all',
          approval: parsedUrl.searchParams.get('approval') || 'all',
          visibility: parsedUrl.searchParams.get('visibility') || 'visible',
          recurring: parsedUrl.searchParams.get('recurring') || '',
          excludedStats: parsedUrl.searchParams.get('excludedStats') || '',
          hasReceipt: parsedUrl.searchParams.get('hasReceipt') || '',
          autoSource: parsedUrl.searchParams.get('autoSource') || '',
          sort: parsedUrl.searchParams.get('sort') || 'date_desc',
          search: parsedUrl.searchParams.get('search') || '',
          chartsScope: parsedUrl.searchParams.get('chartsScope') || 'ledger',
          selectedIds: parsedUrl.searchParams.get('selectedIds') || '',
          limit: parsedUrl.searchParams.get('limit') || '300',
          page: parsedUrl.searchParams.get('page') || '1',
        };
        const data = getDashboardData(db, filters);
        return sendJson(res, 200, data);
      }

      if (pathname === '/api/transactions' && method === 'POST') {
        const body = await readRequestBody(req, 256 * 1024);
        const tx = createTransaction(db, body);
        return sendJson(res, 201, { transaction: tx });
      }

      if (pathname === '/api/transactions/approve-all' && method === 'POST') {
        const body = await readRequestBody(req, 64 * 1024);
        const result = approveAllTransactions(db, body.ids);
        return sendJson(res, 200, { ok: true, ...result });
      }

      if (pathname === '/api/transactions/bulk' && method === 'POST') {
        const body = await readRequestBody(req, 256 * 1024);
        const result = bulkManageTransactions(db, {
          ids: body.ids,
          action: body.action,
          categoryId: body.categoryId,
          receiptsDir,
        });
        return sendJson(res, 200, result);
      }

      const approveTxMatch = /^\/api\/transactions\/(\d+)\/approve$/.exec(pathname);
      if (approveTxMatch && method === 'POST') {
        const tx = approveTransaction(db, Number(approveTxMatch[1]));
        return sendJson(res, 200, { ok: true, transaction: tx });
      }

      const txIdMatch = /^\/api\/transactions\/(\d+)$/.exec(pathname);
      if (txIdMatch) {
        const txId = Number(txIdMatch[1]);
        if (method === 'PATCH') {
          const body = await readRequestBody(req, 256 * 1024);
          const tx = updateTransaction(db, txId, body);
          return sendJson(res, 200, { transaction: tx });
        }
        if (method === 'DELETE') {
          const row = db.prepare('SELECT receipt_path FROM transactions WHERE id = ?').get(txId);
          deleteTransaction(db, txId);
          if (row && row.receipt_path) {
            const stillUsed = db
              .prepare('SELECT COUNT(*) AS cnt FROM transactions WHERE receipt_path = ?')
              .get(row.receipt_path).cnt;
            if (stillUsed === 0) {
              const safePath = path.join(receiptsDir, path.basename(row.receipt_path));
              if (fs.existsSync(safePath)) fs.unlinkSync(safePath);
            }
          }
          return sendJson(res, 200, { ok: true });
        }
      }

      // -------------------- ACCOUNTS, POCKETS & CATEGORIES --------------------
      if (pathname === '/api/accounts' && method === 'POST') {
        const body = await readRequestBody(req, 64 * 1024);
        const name = String(body.name || '').trim();
        if (!name) return sendError(res, 400, 'Bank/account name is required.');
        const currency = normalizeCurrency(body.currency || 'HUF');
        const color = /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color : '#3b82f6';
        const slugBase = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bank';
        const slug = `${slugBase}-${Date.now().toString(36).slice(-4)}`;

        const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM accounts').get().m;
        const accRes = db
          .prepare('INSERT INTO accounts (name, slug, currency, color, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
          .run(name, slug, currency, color, 'landmark', maxSort + 1);
        const accountId = Number(accRes.lastInsertRowid);
        const initialBal = roundCurrency(Number(body.initialBalance) || 0, currency);
        db.prepare(
          'INSERT INTO pockets (account_id, name, currency, initial_balance, current_balance, color, icon, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, 1)'
        ).run(accountId, 'Main', currency, initialBal, initialBal, color, 'wallet');

        return sendJson(res, 201, { ok: true, accountId });
      }

      const accountIdMatch = /^\/api\/accounts\/(\d+)$/.exec(pathname);
      if (accountIdMatch) {
        const accountId = Number(accountIdMatch[1]);
        if (method === 'PATCH') {
          const body = await readRequestBody(req, 64 * 1024);
          const account = updateAccount(db, accountId, body);
          return sendJson(res, 200, { account });
        }
        if (method === 'DELETE') {
          const body = await readRequestBody(req, 64 * 1024).catch(() => ({}));
          const moveToPocketId = body.moveToPocketId || parsedUrl.searchParams.get('moveToPocketId') || null;
          const action = body.action || parsedUrl.searchParams.get('action') || (moveToPocketId ? 'move' : 'archive');
          deleteAccount(db, accountId, { action, moveToPocketId });
          return sendJson(res, 200, { ok: true });
        }
      }

      if (pathname === '/api/pockets' && method === 'POST') {
        const body = await readRequestBody(req, 64 * 1024);
        const accountId = Number(body.accountId);
        const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
        if (!acc) return sendError(res, 404, 'Parent bank account not found.');
        const name = String(body.name || '').trim();
        if (!name) return sendError(res, 400, 'Pocket name is required.');
        const currency = normalizeCurrency(body.currency || acc.currency);
        const initialBalance = roundCurrency(Number(body.initialBalance) || 0, currency);
        const color = /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color : acc.color;

        const resPocket = db
          .prepare(
            'INSERT INTO pockets (account_id, name, currency, initial_balance, current_balance, color, icon, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, 0)'
          )
          .run(accountId, name, currency, initialBalance, initialBalance, color, 'wallet');
        recalculateAllBalances(db);
        const pocket = db.prepare('SELECT * FROM pockets WHERE id = ?').get(Number(resPocket.lastInsertRowid));
        return sendJson(res, 201, { pocket });
      }

      const pocketIdMatch = /^\/api\/pockets\/(\d+)$/.exec(pathname);
      if (pocketIdMatch) {
        const pocketId = Number(pocketIdMatch[1]);
        if (method === 'PATCH') {
          const body = await readRequestBody(req, 64 * 1024);
          const pocket = updatePocket(db, pocketId, body);
          return sendJson(res, 200, { pocket });
        }
        if (method === 'DELETE') {
          const body = await readRequestBody(req, 64 * 1024).catch(() => ({}));
          const moveToPocketId = body.moveToPocketId || parsedUrl.searchParams.get('moveToPocketId') || null;
          const action = body.action || parsedUrl.searchParams.get('action') || (moveToPocketId ? 'move' : 'archive');
          deletePocket(db, pocketId, { action, moveToPocketId });
          return sendJson(res, 200, { ok: true });
        }
      }

      // -------------------- COUNTERPARTIES (SAVED ORIGINS & DESTINATIONS) --------------------
      if (pathname === '/api/counterparties' || /^\/api\/counterparties\/(\d+)$/.test(pathname)) {
        const resolveHideHistoricalCp = () => {
          const histParam = parsedUrl.searchParams.get('historical');
          if (histParam !== null) return histParam === 'live';
          const hideParam = parsedUrl.searchParams.get('hideHistorical');
          if (hideParam !== null) return hideParam === '1' || hideParam === 'true';
          try {
            const rawLayout = getSetting(db, 'dashboard_layout', '');
            if (rawLayout) return Boolean(JSON.parse(rawLayout)?.hideHistorical);
          } catch {
            // ignore
          }
          return false;
        };

        if (pathname === '/api/counterparties') {
          if (method === 'GET') {
            return sendJson(res, 200, {
              counterparties: listCounterparties(db, { hideHistorical: resolveHideHistoricalCp() }),
            });
          }
          if (method === 'POST') {
            const body = await readRequestBody(req, 64 * 1024);
            const item = upsertCounterparty(db, body.name, body.direction, body.categoryId || null);
            return sendJson(res, 201, {
              item,
              counterparties: listCounterparties(db, { hideHistorical: resolveHideHistoricalCp() }),
            });
          }
        }

        const cpIdMatch = /^\/api\/counterparties\/(\d+)$/.exec(pathname);
        if (cpIdMatch && (method === 'PATCH' || method === 'PUT')) {
          const body = await readRequestBody(req, 64 * 1024);
          const result = updateCounterparty(db, Number(cpIdMatch[1]), body);
          return sendJson(res, 200, {
            ok: true,
            item: result.item,
            updatedTransactions: result.updatedTransactions,
            counterparties: listCounterparties(db, { hideHistorical: resolveHideHistoricalCp() }),
          });
        }
        if (cpIdMatch && method === 'DELETE') {
          deleteCounterparty(db, Number(cpIdMatch[1]));
          return sendJson(res, 200, {
            ok: true,
            counterparties: listCounterparties(db, { hideHistorical: resolveHideHistoricalCp() }),
          });
        }
      }

      const pocketSyncMatch = /^\/api\/pockets\/(\d+)\/sync$/.exec(pathname);
      if (pocketSyncMatch && method === 'POST') {
        const pocketId = Number(pocketSyncMatch[1]);
        const body = await readRequestBody(req, 64 * 1024);
        const result = syncPocketBalance(db, pocketId, body.targetBalance, {
          mode: body.mode || 'auto',
          date: body.date || null,
          note: body.note || '',
        });
        return sendJson(res, 200, result);
      }

      if (pathname === '/api/categories' && method === 'POST') {
        const body = await readRequestBody(req, 64 * 1024);
        const name = String(body.name || '').trim();
        const type = String(body.type || 'expense').toLowerCase();
        if (!name) return sendError(res, 400, 'Category name is required.');
        if (!['income', 'expense', 'transfer'].includes(type)) return sendError(res, 400, 'Invalid category type.');
        const color = /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color : '#6366f1';
        const template = body.autoNoteTemplate || `${name}{merchant} ({account} · {pocket})`;
        const r = db
          .prepare('INSERT INTO categories (name, type, icon, color, auto_note_template) VALUES (?, ?, ?, ?, ?)')
          .run(name, type, 'tag', color, template);
        const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(r.lastInsertRowid));
        const categories = db.prepare('SELECT * FROM categories ORDER BY id ASC').all();
        return sendJson(res, 201, { ok: true, category, categories });
      }

      const categoryIdMatch = /^\/api\/categories\/(\d+)$/.exec(pathname);
      if (categoryIdMatch) {
        const catId = Number(categoryIdMatch[1]);
        const existingCat = db.prepare('SELECT * FROM categories WHERE id = ?').get(catId);
        if (!existingCat) return sendError(res, 404, 'Category not found.');

        if (method === 'PATCH') {
          const body = await readRequestBody(req, 64 * 1024);
          const nextName = body.name !== undefined ? String(body.name).trim() : existingCat.name;
          if (!nextName) return sendError(res, 400, 'Category name cannot be empty.');
          const nextColor =
            body.color !== undefined && /^#[0-9a-fA-F]{6}$/.test(String(body.color))
              ? String(body.color)
              : existingCat.color;

          db.exec('BEGIN IMMEDIATE');
          try {
            db.prepare('UPDATE categories SET name = ?, color = ? WHERE id = ?').run(nextName, nextColor, catId);
            if (nextName !== existingCat.name) {
              db.prepare('UPDATE transactions SET category_name = ? WHERE category_id = ?').run(nextName, catId);
            }
            db.exec('COMMIT');
          } catch (err) {
            try {
              db.exec('ROLLBACK');
            } catch {
              // ignore
            }
            throw err;
          }
          const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(catId);
          const categories = db.prepare('SELECT * FROM categories ORDER BY id ASC').all();
          return sendJson(res, 200, { ok: true, category, categories });
        }

        if (method === 'DELETE') {
          const sameTypeCount = db
            .prepare('SELECT COUNT(*) AS cnt FROM categories WHERE type = ?')
            .get(existingCat.type).cnt;
          if (sameTypeCount <= 1) {
            return sendError(res, 400, 'Cannot delete the last remaining category of this type.');
          }
          db.exec('BEGIN IMMEDIATE');
          try {
            db.prepare('UPDATE transactions SET category_id = NULL WHERE category_id = ?').run(catId);
            db.prepare('UPDATE counterparties SET default_category_id = NULL WHERE default_category_id = ?').run(catId);
            db.prepare('DELETE FROM categories WHERE id = ?').run(catId);
            db.exec('COMMIT');
          } catch (err) {
            try {
              db.exec('ROLLBACK');
            } catch {
              // ignore
            }
            throw err;
          }
          const categories = db.prepare('SELECT * FROM categories ORDER BY id ASC').all();
          return sendJson(res, 200, { ok: true, categories });
        }
      }

      // -------------------- RECEIPT SCANNING & STORAGE --------------------
      if (pathname === '/api/receipts/scan' && method === 'POST') {
        const body = await readRequestBody(req, 16 * 1024 * 1024);
        const rawB64 = String(body.imageBase64 || '');
        if (!rawB64) return sendError(res, 400, 'Receipt image data is required.');

        const dataUriMatch = /^data:([^;]+);base64,(.+)$/i.exec(rawB64);
        const mimeType = body.mimeType || (dataUriMatch ? dataUriMatch[1] : 'image/jpeg');
        const base64Payload = dataUriMatch ? dataUriMatch[2] : rawB64;
        const imgBuffer = Buffer.from(base64Payload, 'base64');
        if (imgBuffer.length === 0) return sendError(res, 400, 'Invalid image payload.');

        const ext = extensionFromMime(mimeType);
        const receiptFilename = `receipt-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
        fs.writeFileSync(path.join(receiptsDir, receiptFilename), imgBuffer);

        const apiKey = getSetting(db, 'gemini_api_key', '');
        const model = resolveGeminiModel(getSetting(db, 'gemini_model', DEFAULT_GEMINI_MODEL));
        const scanStart = Date.now();
        const skipScan = Boolean(body.skipScan || body.skip_scan);
        const attachToTxId = Number(body.attachToTxId || body.attach_to_tx_id) || null;
        let scanResult;
        if (skipScan) {
          scanResult = {
            mode: 'skip_scan',
            model: null,
            parsed: {
              source_type: 'receipt',
              tx_type: 'expense',
              merchant: '',
              store_address: null,
              date: null,
              time: null,
              amount: 0,
              currency: 'HUF',
              category: 'Shopping',
              items: [],
              auto_note: '',
            },
          };
        } else {
          try {
            scanResult = await analyzeReceiptImage(imgBuffer, mimeType, apiKey, model, body.filename || '');
          } catch (err) {
            if (err.status === 429 || err.rateLimitHit) {
              recordGeminiUsage(db, getSetting, setSetting, {
                counted: true,
                model,
                tokens: 0,
                rateLimitHit: true,
                errorStatus: 429,
              });
            }
            throw err;
          }
        }

        if (!skipScan && scanResult && scanResult.parsed) {
          const parsedObj = scanResult.parsed;
          const scanTxType = ['expense', 'income', 'transfer'].includes(parsedObj.tx_type)
            ? parsedObj.tx_type
            : 'expense';
          if (parsedObj.merchant && isGenericCounterpartyName(parsedObj.merchant)) {
            parsedObj.merchant = '';
          } else if (parsedObj.merchant && (scanTxType === 'expense' || scanTxType === 'income')) {
            const dir = scanTxType === 'income' ? 'in' : 'out';
            const cleanedScanMerchant = cleanRawMerchantString(parsedObj.merchant) || parsedObj.merchant;
            const match = findBestMatchingCounterparty(db, cleanedScanMerchant, dir);
            if (match && match.counterparty) {
              parsedObj.raw_merchant = parsedObj.merchant;
              parsedObj.merchant = match.counterparty.name;
              if (match.counterparty.default_category_id) {
                const expectedCatType = scanTxType === 'income' ? 'income' : 'expense';
                const catRow = db
                  .prepare('SELECT id, name, type FROM categories WHERE id = ?')
                  .get(match.counterparty.default_category_id);
                if (catRow && catRow.type === expectedCatType) {
                  parsedObj.category = catRow.name;
                }
              }
              if (parsedObj.auto_note && parsedObj.raw_merchant !== parsedObj.merchant) {
                const escapedRaw = parsedObj.raw_merchant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                parsedObj.auto_note = parsedObj.auto_note.replace(new RegExp(escapedRaw, 'gi'), parsedObj.merchant);
              }
            } else {
              parsedObj.merchant = cleanedScanMerchant;
            }
          }
        }

        const usage =
          !skipScan && scanResult.mode === 'gemini'
            ? recordGeminiUsage(db, getSetting, setSetting, {
                counted: true,
                model: scanResult.model || model,
                tokens: scanResult.usageMeta?.totalTokens || 0,
                rateLimitHit: Boolean(scanResult.usageMeta?.rateLimitHit),
                errorStatus: null,
              })
            : getGeminiUsageStats(db, getSetting, model);

        let createdTx = null;
        if (skipScan && attachToTxId) {
          createdTx = updateTransaction(db, attachToTxId, {
            receiptPath: receiptFilename,
          });
        } else if (body.autoLog) {
          const parsed = scanResult.parsed || {};
          if (attachToTxId) {
            createdTx = updateTransaction(db, attachToTxId, {
              receiptPath: receiptFilename,
              items: parsed.items,
              storeAddress: parsed.store_address || '',
              receiptAutoNote: parsed.auto_note,
              expandWithReceipt: Boolean(body.expandNote || body.expandWithReceipt),
              note: body.note !== undefined ? body.note : undefined,
            });
          } else {
            let targetPocketId = Number(body.pocketId) || null;

            if ((parsed.bank_hint || parsed.pocket_hint) && !body.forcePocket) {
              const matchedPocket = resolveHintedPocketId(db, parsed.bank_hint, parsed.pocket_hint, targetPocketId);
              if (matchedPocket) targetPocketId = matchedPocket;
            } else if (!targetPocketId && (parsed.bank_hint || parsed.pocket_hint)) {
              targetPocketId = resolveHintedPocketId(db, parsed.bank_hint, parsed.pocket_hint, null);
            }

            if (!targetPocketId) {
              const fallbackPocket = db.prepare('SELECT id FROM pockets WHERE is_archived = 0 ORDER BY is_default DESC, id ASC LIMIT 1').get()
                || db.prepare('SELECT id FROM pockets ORDER BY is_default DESC, id ASC LIMIT 1').get();
              targetPocketId = fallbackPocket?.id;
            }

            if (targetPocketId && parsed.amount > 0) {
              const today = getLocalIsoDate();
              const txDate = parsed.time
                ? `${parsed.date || today}T${parsed.time}`
                : parsed.date === today
                  ? getLocalIsoDateTime()
                  : parsed.date;

              let txType = ['expense', 'income', 'transfer'].includes(parsed.tx_type)
                ? parsed.tx_type
                : 'expense';

              let destPocketId = Number(body.destPocketId) || null;
              if (txType === 'transfer') {
                if (!destPocketId || destPocketId === targetPocketId) {
                  destPocketId = resolveHintedPocketId(
                    db,
                    parsed.dest_bank_hint || parsed.bank_hint,
                    parsed.dest_pocket_hint,
                    null,
                    targetPocketId
                  );
                }
                if (!destPocketId && parsed.dest_pocket_hint) {
                  destPocketId = resolveHintedPocketId(db, null, parsed.dest_pocket_hint, null, targetPocketId);
                }
                if (!destPocketId || destPocketId === targetPocketId) {
                  // Keep auto-log safe if no distinct destination pocket could be identified
                  txType = 'expense';
                  destPocketId = null;
                }
              }

              createdTx = createTransaction(db, {
                date: txDate,
                type: txType,
                amount: parsed.amount,
                currency: parsed.currency,
                pocketId: targetPocketId,
                destPocketId,
                categoryName: parsed.category,
                merchant: parsed.merchant,
                note: body.note || '',
                receiptAutoNote: parsed.auto_note,
                storeAddress: parsed.store_address || '',
                items: parsed.items,
                receiptPath: receiptFilename,
                isHistorical: 0,
                needsApproval: 1,
                autoSource: 'receipt_autolog',
              });
              if (createdTx) {
                notifyAutoLoggedTransaction(db, createdTx, 'Receipt Auto-Log').catch(() => {});
              }
            }
          }
        }

        return sendJson(res, 200, {
          ...scanResult,
          receiptPath: receiptFilename,
          skippedScan: skipScan,
          autoLogged: Boolean(createdTx),
          attachedToExisting: Boolean(attachToTxId && createdTx),
          transaction: createdTx,
          usage,
          stats: {
            imageBytes: imgBuffer.length,
            durationMs: Date.now() - scanStart,
          },
        });
      }

      const receiptFileMatch = /^\/api\/receipts\/file\/([a-zA-Z0-9._-]+)$/.exec(pathname);
      if (receiptFileMatch && method === 'GET') {
        const safeName = path.basename(receiptFileMatch[1]);
        const filePath = path.join(receiptsDir, safeName);
        if (!fs.existsSync(filePath)) return sendError(res, 404, 'Receipt image not found.');
        const ext = path.extname(safeName).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        const data = fs.readFileSync(filePath);
        setSecurityHeaders(res);
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': data.length,
          'Cache-Control': 'private, max-age=86400',
        });
        return res.end(data);
      }

      // -------------------- SPREADSHEET & BACKUP IMPORT --------------------
      if (pathname === '/api/import/preview' && method === 'POST') {
        const body = await readRequestBody(req, 64 * 1024 * 1024);
        const rawB64 = String(body.fileBase64 || '');
        if (!rawB64) return sendError(res, 400, 'File payload is required.');
        const cleanB64 = rawB64.includes(',') ? rawB64.split(',').pop() : rawB64;
        const buf = Buffer.from(cleanB64, 'base64');
        const fname = String(body.filename || 'sheet.csv');
        const fnameLower = fname.toLowerCase();
        const isGzip = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
        if (fnameLower.endsWith('.json') || fnameLower.endsWith('.json.gz') || isGzip || buf.toString('utf8', 0, 256).trimStart().startsWith('{')) {
          return sendJson(res, 200, { isBackupJson: true, ...previewBackupPayload(buf) });
        }
        const preview = previewImport(buf, fname, body.sheetIndex || 0);
        return sendJson(res, 200, preview);
      }

      if (pathname === '/api/import/backup' && method === 'POST') {
        const body = await readRequestBody(req, 64 * 1024 * 1024);
        let backupInput = body.backup;
        if (!backupInput && body.fileBase64) {
          const rawB64 = String(body.fileBase64);
          const cleanB64 = rawB64.includes(',') ? rawB64.split(',').pop() : rawB64;
          backupInput = Buffer.from(cleanB64, 'base64');
        }
        if (!backupInput) return sendError(res, 400, 'Backup payload is required.');
        const result = restoreFullBackup(db, receiptsDir, backupInput, {
          mode: body.mode === 'merge' ? 'merge' : 'replace',
        });
        return sendJson(res, 200, result);
      }

      if (pathname === '/api/import/commit' && method === 'POST') {
        const body = await readRequestBody(req, 64 * 1024 * 1024);
        const rawB64 = String(body.fileBase64 || '');
        if (!rawB64) return sendError(res, 400, 'File payload is required.');
        const cleanB64 = rawB64.includes(',') ? rawB64.split(',').pop() : rawB64;
        const buf = Buffer.from(cleanB64, 'base64');
        const result = commitImport(db, buf, body.filename || 'sheet.csv', {
          sheetIndex: body.sheetIndex || 0,
          mapping: body.mapping,
          defaultPocketId: body.defaultPocketId,
          defaultType: body.defaultType || 'auto',
          markAsHistorical: Boolean(body.markAsHistorical),
        });
        return sendJson(res, 200, result);
      }

      // -------------------- SETTINGS, FX & EXPORT --------------------
      if (pathname === '/api/settings' && method === 'GET') {
        const key = getSetting(db, 'gemini_api_key', '');
        const resolvedModel = resolveGeminiModel(getSetting(db, 'gemini_model', DEFAULT_GEMINI_MODEL));
        let webhookToken = getSetting(db, 'notification_webhook_token', '');
        if (!webhookToken) {
          webhookToken = crypto.randomBytes(16).toString('hex');
          setSetting(db, 'notification_webhook_token', webhookToken);
        }
        const masked = key
          ? key.length > 8
            ? `${key.slice(0, 4)}••••••${key.slice(-4)}`
            : '••••••••'
          : '';
        return sendJson(res, 200, {
          baseCurrency: getSetting(db, 'base_currency', 'HUF'),
          geminiModel: resolvedModel,
          hasGeminiKey: Boolean(key),
          geminiKeyPreview: masked,
          fxRates: getFxRates(db),
          geminiUsage: getGeminiUsageStats(db, getSetting, resolvedModel),
          webhookToken,
          webhookLogs: getWebhookLogs(db),
          sessionTimeoutMinutes: getSessionTimeoutMinutes(db),
          pushSubscriptionCount: countPushSubscriptions(db),
        });
      }

      // -------------------- PWA WEB PUSH NOTIFICATIONS --------------------
      if (pathname === '/api/push/public-key' && method === 'GET') {
        const vapid = getOrCreateVapidKeys(db);
        return sendJson(res, 200, {
          publicKey: vapid.publicKey,
          subscriptionCount: countPushSubscriptions(db),
        });
      }

      if (pathname === '/api/push/subscribe' && method === 'POST') {
        const body = await readRequestBody(req, 64 * 1024);
        const saved = savePushSubscription(db, sessionUser?.id || null, body, req.headers['user-agent'] || '');
        return sendJson(res, 200, {
          ok: true,
          subscription: saved,
          subscriptionCount: countPushSubscriptions(db),
        });
      }

      if (pathname === '/api/push/unsubscribe' && method === 'POST') {
        const body = await readRequestBody(req, 64 * 1024);
        const removed = removePushSubscription(db, body.endpoint || '');
        return sendJson(res, 200, {
          ok: true,
          removed,
          subscriptionCount: countPushSubscriptions(db),
        });
      }

      if (pathname === '/api/push/test' && method === 'POST') {
        const result = await broadcastPushNotification(db, {
          title: 'MoneyManager: PWA Notifications Active',
          body: 'You will receive a push notification whenever a transaction is auto-logged.',
          tag: 'mm-push-test',
          url: './',
        });
        return sendJson(res, 200, { ok: true, ...result });
      }

      if (pathname === '/api/settings/rotate-webhook-token' && method === 'POST') {
        const webhookToken = crypto.randomBytes(16).toString('hex');
        setSetting(db, 'notification_webhook_token', webhookToken);
        return sendJson(res, 200, { ok: true, webhookToken });
      }

      if (pathname === '/api/settings' && method === 'PUT') {
        const body = await readRequestBody(req, 64 * 1024);
        if (typeof body.geminiApiKey === 'string') {
          setSetting(db, 'gemini_api_key', body.geminiApiKey.trim());
        }
        if (typeof body.geminiModel === 'string' && body.geminiModel.trim()) {
          setSetting(db, 'gemini_model', resolveGeminiModel(body.geminiModel));
        }
        if (body.fxRates && typeof body.fxRates === 'object') {
          const merged = parseFxRates(body.fxRates);
          setSetting(db, 'fx_rates', JSON.stringify(merged));
          recalculateAllBalances(db, merged);
        }
        if (body.sessionTimeoutMinutes !== undefined) {
          const mins = sanitizeSessionTimeoutMinutes(body.sessionTimeoutMinutes);
          setSetting(db, 'session_timeout_minutes', String(mins));
          updateActiveSessionsTimeout(db, mins);
        }
        return sendJson(res, 200, { ok: true, sessionTimeoutMinutes: getSessionTimeoutMinutes(db) });
      }

      if (pathname === '/api/dashboard-layout' && method === 'PUT') {
        const body = await readRequestBody(req, 64 * 1024);
        const dashboardLayout = saveDashboardLayout(db, body);
        return sendJson(res, 200, { ok: true, dashboardLayout });
      }

      if (pathname === '/api/settings/test-gemini' && method === 'POST') {
        const body = await readRequestBody(req, 64 * 1024);
        const keyToTest =
          typeof body.geminiApiKey === 'string' && body.geminiApiKey.trim()
            ? body.geminiApiKey.trim()
            : getSetting(db, 'gemini_api_key', '');
        const modelToTest = resolveGeminiModel(body.geminiModel || getSetting(db, 'gemini_model', DEFAULT_GEMINI_MODEL));
        try {
          const result = await testGeminiConnection(keyToTest, modelToTest);
          const usage = recordGeminiUsage(db, getSetting, setSetting, {
            counted: true,
            model: result.model || modelToTest,
            tokens: result.usageMeta?.totalTokens || 0,
            rateLimitHit: Boolean(result.usageMeta?.rateLimitHit),
            errorStatus: null,
          });
          return sendJson(res, 200, { ...result, usage });
        } catch (err) {
          if (err.status === 429 || err.rateLimitHit) {
            recordGeminiUsage(db, getSetting, setSetting, {
              counted: true,
              model: modelToTest,
              tokens: 0,
              rateLimitHit: true,
              errorStatus: 429,
            });
          }
          throw err;
        }
      }

      if (pathname === '/api/settings/refresh-fx' && method === 'POST') {
        const live = await fetchLiveFxRates();
        setSetting(db, 'fx_rates', JSON.stringify(live.rates));
        recalculateAllBalances(db, live.rates);
        return sendJson(res, 200, live);
      }

      if (pathname === '/api/export/json' && method === 'GET') {
        const payload = exportFullBackup(db, receiptsDir);
        const json = JSON.stringify(payload, null, 2);
        setSecurityHeaders(res);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="moneymanager-backup-${new Date().toISOString().slice(0, 10)}.json"`,
          'Content-Length': Buffer.byteLength(json),
        });
        return res.end(json);
      }

      if (pathname === '/api/export/csv' && method === 'GET') {
        const rows = db
          .prepare(
            `SELECT t.id, t.date, t.type, t.amount, t.currency,
                    a.name AS bank, p.name AS pocket,
                    da.name AS dest_bank, dp.name AS dest_pocket, t.dest_amount,
                    t.category_name, t.merchant, t.note, t.note_source,
                    t.store_address, t.items_json,
                    t.is_historical, t.is_recurring, t.exclude_from_analytics, t.is_hidden,
                    t.pocket_balance_after, t.account_balance_after
             FROM transactions t
             JOIN accounts a ON a.id = t.account_id
             JOIN pockets p ON p.id = t.pocket_id
             LEFT JOIN accounts da ON da.id = t.dest_account_id
             LEFT JOIN pockets dp ON dp.id = t.dest_pocket_id
             ORDER BY t.date ASC, t.id ASC`
          )
          .all();
        const csvEscape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const header = [
          'ID',
          'Date',
          'Type',
          'Amount',
          'Currency',
          'Bank',
          'Pocket',
          'DestBank',
          'DestPocket',
          'DestAmount',
          'Category',
          'Merchant',
          'Note',
          'NoteSource',
          'StoreAddress',
          'ItemsJson',
          'IsHistorical',
          'IsRecurring',
          'ExcludeFromAnalytics',
          'IsHidden',
          'PocketBalanceAfter',
          'AccountBalanceAfter',
        ].join(',');
        const lines = rows.map((r) =>
          [
            r.id,
            r.date,
            r.type,
            r.amount,
            r.currency,
            r.bank,
            r.pocket,
            r.dest_bank || '',
            r.dest_pocket || '',
            r.dest_amount ?? '',
            r.category_name,
            r.merchant,
            r.note,
            r.note_source,
            r.store_address || '',
            r.items_json || '[]',
            r.is_historical,
            r.is_recurring,
            r.exclude_from_analytics,
            r.is_hidden,
            r.pocket_balance_after,
            r.account_balance_after,
          ]
            .map(csvEscape)
            .join(',')
        );
        const csv = `\uFEFF${header}\n${lines.join('\n')}`;
        setSecurityHeaders(res);
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="moneymanager-ledger-${new Date().toISOString().slice(0, 10)}.csv"`,
          'Content-Length': Buffer.byteLength(csv),
        });
        return res.end(csv);
      }

      // -------------------- SCHEDULED BACKUPS (LOCAL & REMOTE) --------------------
      if (pathname === '/api/backups/status' && method === 'GET') {
        return sendJson(res, 200, getBackupStatusSnapshot(db, backupCtx));
      }

      if (pathname === '/api/backups/config' && method === 'PUT') {
        const body = await readRequestBody(req, 512 * 1024);
        saveBackupConfig(db, dataDir, body);
        return sendJson(res, 200, { ok: true, ...getBackupStatusSnapshot(db, backupCtx) });
      }

      if (pathname === '/api/backups/run' && method === 'POST') {
        const body = await readRequestBody(req, 64 * 1024);
        const target = ['all', 'local', 'remote'].includes(body.target) ? body.target : 'all';
        const result = await runBackupNow(db, backupCtx, { trigger: 'manual', target });
        return sendJson(res, 200, {
          ok: true,
          result,
          ...getBackupStatusSnapshot(db, backupCtx),
        });
      }

      if (pathname === '/api/backups/remote/test' && method === 'POST') {
        const body = await readRequestBody(req, 512 * 1024);
        const resolved = resolveDecryptedConfig(db, dataDir);
        const inRemote = body.remote && typeof body.remote === 'object' ? body.remote : body;
        const mergedRemote = {
          ...resolved.remote,
          ...inRemote,
          password: inRemote.clearPassword
            ? ''
            : typeof inRemote.password === 'string' && inRemote.password.length > 0
            ? inRemote.password
            : resolved.remote.password,
          sshPrivateKey: inRemote.clearSshKey
            ? ''
            : typeof inRemote.sshPrivateKey === 'string' && inRemote.sshPrivateKey.trim().length > 0
            ? inRemote.sshPrivateKey
            : resolved.remote.sshPrivateKey,
        };
        const testResult = await testRemoteConnection(mergedRemote);
        return sendJson(res, 200, testResult);
      }

      if (pathname === '/api/backups/remote/list' && method === 'GET') {
        const resolved = resolveDecryptedConfig(db, dataDir);
        if (!resolved.remote.host) {
          return sendJson(res, 200, { files: [], totalBytes: 0 });
        }
        const files = await listRemoteBackups(resolved.remote);
        const totalBytes = files.reduce((s, f) => s + (Number(f.sizeBytes) || 0), 0);
        return sendJson(res, 200, { files, totalBytes });
      }

      const localBackupMatch = /^\/api\/backups\/local\/([^/]+)$/.exec(pathname);
      if (localBackupMatch && method === 'GET') {
        const cleanName = assertValidBackupFilename(decodeURIComponent(localBackupMatch[1]));
        const cfg = getBackupConfig(db);
        const localDir = resolveLocalBackupDir(cfg, backupsDir);
        const fullPath = path.resolve(localDir, cleanName);
        const resolvedDir = path.resolve(localDir);
        if (!fullPath.startsWith(resolvedDir + path.sep) || !fs.existsSync(fullPath)) {
          return sendError(res, 404, 'Backup file not found.');
        }
        const data = fs.readFileSync(fullPath);
        setSecurityHeaders(res);
        res.writeHead(200, {
          'Content-Type': cleanName.endsWith('.gz') ? 'application/gzip' : 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${cleanName}"`,
          'Content-Length': data.length,
        });
        return res.end(data);
      }

      if (localBackupMatch && method === 'DELETE') {
        const cleanName = assertValidBackupFilename(decodeURIComponent(localBackupMatch[1]));
        const cfg = getBackupConfig(db);
        const localDir = resolveLocalBackupDir(cfg, backupsDir);
        deleteLocalBackup(localDir, cleanName);
        return sendJson(res, 200, { ok: true, ...getBackupStatusSnapshot(db, backupCtx) });
      }

      const remoteBackupMatch = /^\/api\/backups\/remote\/([^/]+)$/.exec(pathname);
      if (remoteBackupMatch && method === 'DELETE') {
        const cleanName = assertValidBackupFilename(decodeURIComponent(remoteBackupMatch[1]));
        const resolved = resolveDecryptedConfig(db, dataDir);
        await deleteRemoteBackup(resolved.remote, cleanName);
        const files = await listRemoteBackups(resolved.remote);
        const totalBytes = files.reduce((s, f) => s + (Number(f.sizeBytes) || 0), 0);
        return sendJson(res, 200, { ok: true, files, totalBytes });
      }

      if (pathname === '/api/backups/restore' && method === 'POST') {
        const body = await readRequestBody(req, 64 * 1024);
        const source = body.source === 'remote' ? 'remote' : 'local';
        const mode = body.mode === 'merge' ? 'merge' : 'replace';
        const result = await restoreFromSavedBackup(db, backupCtx, {
          source,
          filename: body.filename,
          mode,
        });
        return sendJson(res, 200, { ok: true, ...result });
      }

      // -------------------- STATIC PWA ASSETS --------------------
      if (method === 'GET' || method === 'HEAD') {
        let relPath = pathname === '/' ? '/index.html' : pathname;
        try {
          relPath = decodeURIComponent(relPath);
        } catch {
          return sendError(res, 400, 'Bad path.');
        }
        if (relPath.split('/').some((seg) => seg.startsWith('.') && seg !== '.well-known')) {
          return sendError(res, 404, 'Not found.');
        }
        const resolved = path.resolve(publicDir, `.${relPath}`);
        if (!resolved.startsWith(publicDir)) {
          return sendError(res, 403, 'Forbidden.');
        }
        let targetFile = resolved;
        if (!fs.existsSync(targetFile) || fs.statSync(targetFile).isDirectory()) {
          // SPA fallback to index.html for unknown frontend routes
          if (!path.extname(relPath)) {
            targetFile = path.join(publicDir, 'index.html');
          } else {
            return sendError(res, 404, 'Not found.');
          }
        }
        const ext = path.extname(targetFile).toLowerCase();
        const mime = MIME_TYPES[ext] || 'application/octet-stream';
        const content = fs.readFileSync(targetFile);
        setSecurityHeaders(res);
        const noCacheExts = new Set(['.html', '.js', '.css', '.webmanifest']);
        const cacheControl = relPath === '/sw.js' || noCacheExts.has(ext) ? 'no-cache' : 'public, max-age=3600';
        res.writeHead(200, {
          'Content-Type': mime,
          'Content-Length': content.length,
          'Cache-Control': cacheControl,
        });
        if (method === 'HEAD') return res.end();
        return res.end(content);
      }

      return sendError(res, 404, 'Route not found.');
    } catch (err) {
      const status = err.statusCode || err.status || 500;
      return sendError(res, status, err.message || 'Internal server error.');
    }
  });

  server.requestTimeout = 120000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 64;

  server.on('close', () => {
    try {
      backupScheduler?.stop();
    } catch {
      // ignore
    }
    try {
      db.close();
    } catch {
      // ignore
    }
  });

  return { server, db, receiptsDir, backupsDir };
}

if (require.main === module) {
  const rootDir = path.resolve(__dirname, '..');
  loadEnvFile(path.join(rootDir, '.env'));

  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  const { server } = createApp({ rootDir });

  server.listen(port, host, () => {
    console.log(`MoneyManager server listening on http://${host}:${port}`);
  });
}

module.exports = { createApp };
