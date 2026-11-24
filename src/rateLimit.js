'use strict';

function normalizeIp(raw) {
  let ip = String(raw || '').trim();
  if (!ip) return 'unknown';
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }
  return ip || 'unknown';
}

function isTrustedProxyIp(ip) {
  const clean = normalizeIp(ip).toLowerCase();
  if (clean === '127.0.0.1' || clean === '::1' || clean === 'localhost') return true;
  if (clean.startsWith('10.') || clean.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(clean)) return true;
  // Tailscale CGNAT 100.64.0.0/10 / ULA IPv6 fc00::/7
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(clean)) return true;
  if (clean.startsWith('fc') || clean.startsWith('fd')) return true;
  return false;
}

function getClientIp(req) {
  const remoteIp = normalizeIp(req?.socket?.remoteAddress || '');
  if (!isTrustedProxyIp(remoteIp)) {
    return remoteIp;
  }

  const cfIp = req.headers?.['cf-connecting-ip'];
  if (typeof cfIp === 'string' && cfIp.trim()) {
    return normalizeIp(cfIp.split(',')[0]);
  }
  const realIp = req.headers?.['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return normalizeIp(realIp.split(',')[0]);
  }
  const xff = req.headers?.['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    // Use rightmost IP appended by the trusted reverse proxy rather than leftmost user-spoofable header
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) {
      return normalizeIp(parts[parts.length - 1]);
    }
  }
  return remoteIp;
}

/**
 * Bounded fixed/sliding counter bucket limiter resistant to spoofed-IP memory exhaustion.
 */
function createRateLimiter({ windowMs, max, blockMs = 0, maxEntries = 10000 }) {
  const buckets = new Map();
  let lastPrune = 0;

  function pruneExpired(now) {
    if (buckets.size < maxEntries && now - lastPrune < Math.min(windowMs, 60000)) return;
    lastPrune = now;
    for (const [key, entry] of buckets.entries()) {
      const inactive = now - entry.windowStart > windowMs;
      const unblocked = !entry.blockedUntil || now >= entry.blockedUntil;
      if (inactive && unblocked) {
        buckets.delete(key);
      }
    }
    while (buckets.size >= maxEntries) {
      const oldestKey = buckets.keys().next().value;
      if (oldestKey === undefined) break;
      buckets.delete(oldestKey);
    }
  }

  function peek(key) {
    const cleanKey = String(key || 'unknown');
    const now = Date.now();
    const entry = buckets.get(cleanKey);
    if (!entry) {
      return {
        allowed: true,
        limit: max,
        remaining: max,
        retryAfterSec: 0,
        resetAt: now + windowMs,
      };
    }
    if (entry.blockedUntil && now < entry.blockedUntil) {
      return {
        allowed: false,
        limit: max,
        remaining: 0,
        retryAfterSec: Math.max(1, Math.ceil((entry.blockedUntil - now) / 1000)),
        resetAt: entry.blockedUntil,
      };
    }
    if (now - entry.windowStart >= windowMs) {
      buckets.delete(cleanKey);
      return {
        allowed: true,
        limit: max,
        remaining: max,
        retryAfterSec: 0,
        resetAt: now + windowMs,
      };
    }
    const allowed = entry.count < max;
    const remaining = Math.max(0, max - entry.count);
    const resetAt = entry.windowStart + windowMs;
    const retryAfterSec = allowed ? 0 : Math.max(1, Math.ceil((resetAt - now) / 1000));
    return { allowed, limit: max, remaining, retryAfterSec, resetAt };
  }

  function consume(key, weight = 1) {
    const cleanKey = String(key || 'unknown');
    const now = Date.now();
    pruneExpired(now);

    let entry = buckets.get(cleanKey);
    if (!entry || (now - entry.windowStart >= windowMs && (!entry.blockedUntil || now >= entry.blockedUntil))) {
      entry = { count: 0, windowStart: now, blockedUntil: 0 };
    }
    if (entry.blockedUntil && now < entry.blockedUntil) {
      buckets.delete(cleanKey);
      buckets.set(cleanKey, entry);
      return {
        allowed: false,
        limit: max,
        remaining: 0,
        retryAfterSec: Math.max(1, Math.ceil((entry.blockedUntil - now) / 1000)),
        resetAt: entry.blockedUntil,
      };
    }

    entry.count += Math.max(1, Number(weight) || 1);
    if (entry.count > max) {
      if (blockMs > 0) {
        entry.blockedUntil = now + blockMs;
      }
      buckets.delete(cleanKey);
      buckets.set(cleanKey, entry);
      const resetAt = entry.blockedUntil || entry.windowStart + windowMs;
      return {
        allowed: false,
        limit: max,
        remaining: 0,
        retryAfterSec: Math.max(1, Math.ceil((resetAt - now) / 1000)),
        resetAt,
      };
    }

    // Refresh LRU order
    buckets.delete(cleanKey);
    buckets.set(cleanKey, entry);
    return {
      allowed: true,
      limit: max,
      remaining: Math.max(0, max - entry.count),
      retryAfterSec: 0,
      resetAt: entry.windowStart + windowMs,
    };
  }

  function recordFailure(key) {
    return consume(key, 1);
  }

  function reset(key) {
    buckets.delete(String(key || 'unknown'));
  }

  return { peek, consume, recordFailure, reset };
}

/**
 * Tracks simultaneous active connections/requests per IP to defend against concurrency/slow-body floods.
 */
function createConcurrencyLimiter(maxConcurrent = 30, maxEntries = 10000) {
  const active = new Map();

  function acquire(ip) {
    const clean = String(ip || 'unknown');
    const current = active.get(clean) || 0;
    if (current >= maxConcurrent) {
      return null;
    }
    if (!active.has(clean) && active.size >= maxEntries) {
      const oldest = active.keys().next().value;
      if (oldest !== undefined) active.delete(oldest);
    }
    active.set(clean, current + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (active.get(clean) || 1) - 1;
      if (left <= 0) active.delete(clean);
      else active.set(clean, left);
    };
  }

  return { acquire };
}

module.exports = {
  normalizeIp,
  isTrustedProxyIp,
  getClientIp,
  createRateLimiter,
  createConcurrencyLimiter,
};
