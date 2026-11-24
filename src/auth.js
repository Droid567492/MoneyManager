'use strict';

const crypto = require('node:crypto');
const { getClientIp, normalizeIp, isTrustedProxyIp } = require('./rateLimit');

const SESSION_COOKIE_NAME = 'mm_session';
const DEFAULT_SESSION_TIMEOUT_MINUTES = 10;
const COOKIE_MAX_AGE_SEC = 30 * 24 * 60 * 60; // Cookie transport max-age (actual expiry enforced in SQLite)
const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_MAX_ATTEMPTS = 8;
const MAX_TRACKED_IPS = 10000;

const loginAttempts = new Map();

function sanitizeSessionTimeoutMinutes(val) {
  const num = Number(val);
  if (!Number.isFinite(num) || num < 1) return DEFAULT_SESSION_TIMEOUT_MINUTES;
  return Math.min(10080, Math.max(1, Math.round(num)));
}

function getSessionTimeoutMinutes(db) {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'session_timeout_minutes'").get();
    if (!row) return DEFAULT_SESSION_TIMEOUT_MINUTES;
    return sanitizeSessionTimeoutMinutes(row.value);
  } catch {
    return DEFAULT_SESSION_TIMEOUT_MINUTES;
  }
}

function getSessionTtlMs(db) {
  return getSessionTimeoutMinutes(db) * 60 * 1000;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  const storedBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derived, storedBuf);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function hasAnyUser(db) {
  const row = db.prepare('SELECT COUNT(*) AS cnt FROM users').get();
  return row.cnt > 0;
}

function createUser(db, username, password) {
  const cleanUser = String(username || '').trim();
  if (cleanUser.length < 2 || cleanUser.length > 64) {
    throw new Error('Username must be between 2 and 64 characters.');
  }
  if (typeof password !== 'string' || password.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }
  const passwordHash = hashPassword(password);
  const now = new Date().toISOString();
  const res = db
    .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
    .run(cleanUser, passwordHash, now);
  return { id: Number(res.lastInsertRowid), username: cleanUser, created_at: now };
}

function updatePassword(db, userId, newPassword) {
  if (typeof newPassword !== 'string' || newPassword.length < 6) {
    throw new Error('New password must be at least 6 characters.');
  }
  const passwordHash = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
}

function authenticateUser(db, username, password) {
  const cleanUser = String(username || '').trim();
  const row = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(cleanUser);
  if (!row) return null;
  if (!verifyPassword(String(password || ''), row.password_hash)) return null;
  return { id: row.id, username: row.username };
}

function createSession(db, userId) {
  clearExpiredSessions(db);
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const now = Date.now();
  const timeoutMinutes = getSessionTimeoutMinutes(db);
  const expiresAt = now + timeoutMinutes * 60 * 1000;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
    tokenHash,
    userId,
    expiresAt,
    new Date(now).toISOString()
  );
  return { rawToken, expiresAt, timeoutMinutes };
}

function getSessionUser(db, rawToken, opts = {}) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const tokenHash = hashToken(rawToken);
  const now = Date.now();
  const row = db
    .prepare(
      `SELECT s.token_hash, s.expires_at, u.id AS user_id, u.username
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    )
    .get(tokenHash);
  if (!row) return null;
  if (row.expires_at <= now) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  const timeoutMinutes = getSessionTimeoutMinutes(db);
  const ttlMs = timeoutMinutes * 60 * 1000;
  let expiresAt = row.expires_at;
  if (opts.touch !== false) {
    expiresAt = now + ttlMs;
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(expiresAt, tokenHash);
  }
  return { id: row.user_id, username: row.username, expiresAt, timeoutMinutes };
}

function updateActiveSessionsTimeout(db, timeoutMinutes) {
  const mins = sanitizeSessionTimeoutMinutes(timeoutMinutes);
  const now = Date.now();
  const newExpiresAt = now + mins * 60 * 1000;
  db.prepare('UPDATE sessions SET expires_at = ? WHERE expires_at > ?').run(newExpiresAt, now);
  return newExpiresAt;
}

function deleteSession(db, rawToken) {
  if (!rawToken) return;
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(rawToken));
}

function clearExpiredSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return cookies;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        cookies[key] = decodeURIComponent(val);
      } catch {
        cookies[key] = val;
      }
    }
  }
  return cookies;
}

function isHttpsRequest(req) {
  if (!req) return false;
  if (req.socket && req.socket.encrypted) return true;
  const remoteIp = normalizeIp(req.socket?.remoteAddress || '');
  if (isTrustedProxyIp(remoteIp)) {
    const xfProto = req.headers?.['x-forwarded-proto'];
    if (typeof xfProto === 'string' && xfProto.split(',')[0].trim().toLowerCase() === 'https') {
      return true;
    }
  }
  return false;
}

function buildSessionCookie(rawToken, req) {
  const maxAge = COOKIE_MAX_AGE_SEC;
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (isHttpsRequest(req)) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function buildClearCookie(req) {
  const parts = [`${SESSION_COOKIE_NAME}=`, 'HttpOnly', 'Path=/', 'SameSite=Lax', 'Max-Age=0'];
  if (isHttpsRequest(req)) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function checkLoginRateLimit(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry) return { allowed: true, retryAfterSec: 0 };
  if (now - entry.windowStart > RATE_WINDOW_MS) {
    loginAttempts.delete(ip);
    return { allowed: true, retryAfterSec: 0 };
  }
  if (entry.count >= RATE_MAX_ATTEMPTS) {
    const retryAfterSec = Math.ceil((RATE_WINDOW_MS - (now - entry.windowStart)) / 1000);
    return { allowed: false, retryAfterSec };
  }
  return { allowed: true, retryAfterSec: 0 };
}

function recordFailedLogin(ip) {
  const now = Date.now();
  if (loginAttempts.size >= MAX_TRACKED_IPS) {
    for (const [k, v] of loginAttempts.entries()) {
      if (now - v.windowStart > RATE_WINDOW_MS) loginAttempts.delete(k);
    }
    while (loginAttempts.size >= MAX_TRACKED_IPS) {
      const oldest = loginAttempts.keys().next().value;
      if (oldest === undefined) break;
      loginAttempts.delete(oldest);
    }
  }
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, windowStart: now });
  } else {
    entry.count += 1;
  }
}

function clearFailedLogins(ip) {
  loginAttempts.delete(ip);
}

module.exports = {
  SESSION_COOKIE_NAME,
  DEFAULT_SESSION_TIMEOUT_MINUTES,
  sanitizeSessionTimeoutMinutes,
  getSessionTimeoutMinutes,
  getSessionTtlMs,
  updateActiveSessionsTimeout,
  hashPassword,
  verifyPassword,
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
  checkLoginRateLimit,
  recordFailedLogin,
  clearFailedLogins,
};
