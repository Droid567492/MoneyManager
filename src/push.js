'use strict';

const crypto = require('node:crypto');
const { getSetting, setSetting } = require('./db');

function b64UrlEncode(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function b64UrlDecode(str) {
  const normalized = String(str || '')
    .trim()
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padLen = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + '='.repeat(padLen), 'base64');
}

function getOrCreateVapidKeys(db) {
  try {
    const raw = getSetting(db, 'vapid_keys', '');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.publicKey && parsed?.privateJwk && parsed?.publicJwk) {
        return parsed;
      }
    }
  } catch {
    // Regenerate if corrupted
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const publicJwk = publicKey.export({ format: 'jwk' });
  const privateJwk = privateKey.export({ format: 'jwk' });

  // Uncompressed P-256 point: 0x04 || x (32B) || y (32B)
  const rawPub = Buffer.concat([
    Buffer.from([0x04]),
    b64UrlDecode(publicJwk.x),
    b64UrlDecode(publicJwk.y),
  ]);
  const bundle = {
    publicKey: b64UrlEncode(rawPub),
    publicJwk,
    privateJwk,
    createdAt: new Date().toISOString(),
  };
  setSetting(db, 'vapid_keys', JSON.stringify(bundle));
  return bundle;
}

function buildVapidAuthHeader(endpoint, vapidKeys, subject = 'mailto:moneymanager@localhost') {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const headerB64 = b64UrlEncode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payloadB64 = b64UrlEncode(JSON.stringify({ aud: audience, exp, sub: subject }));
  const signingInput = `${headerB64}.${payloadB64}`;

  const privateKeyObj = crypto.createPrivateKey({ key: vapidKeys.privateJwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(signingInput, 'utf8'), {
    key: privateKeyObj,
    dsaEncoding: 'ieee-p1363',
  });
  const jwt = `${signingInput}.${b64UrlEncode(sig)}`;
  return `vapid t=${jwt}, k=${vapidKeys.publicKey}`;
}

/**
 * RFC 8291 + RFC 8188 aes128gcm Web Push payload encryption using pure Node crypto.
 */
function encryptWebPushPayload(subscription, payloadInput) {
  const uaPublicKey = b64UrlDecode(subscription?.keys?.p256dh);
  const authSecret = b64UrlDecode(subscription?.keys?.auth);
  if (uaPublicKey.length !== 65 || uaPublicKey[0] !== 0x04) {
    throw new Error('Invalid push subscription p256dh key.');
  }
  if (authSecret.length !== 16) {
    throw new Error('Invalid push subscription auth secret.');
  }

  const plaintext = Buffer.isBuffer(payloadInput)
    ? payloadInput
    : Buffer.from(typeof payloadInput === 'string' ? payloadInput : JSON.stringify(payloadInput), 'utf8');

  const asEcdh = crypto.createECDH('prime256v1');
  asEcdh.generateKeys();
  const asPublicKey = asEcdh.getPublicKey();
  const sharedSecret = asEcdh.computeSecret(uaPublicKey);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), uaPublicKey, asPublicKey]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', sharedSecret, authSecret, keyInfo, 32));

  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12));

  const paddedRecord = Buffer.concat([plaintext, Buffer.from([0x02])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(paddedRecord), cipher.final(), cipher.getAuthTag()]);

  const rsBuf = Buffer.alloc(4);
  rsBuf.writeUInt32BE(4096, 0);
  const idLenBuf = Buffer.from([asPublicKey.length]);
  return Buffer.concat([salt, rsBuf, idLenBuf, asPublicKey, ciphertext]);
}

function savePushSubscription(db, userId, sub, userAgent = '') {
  const endpoint = String(sub?.endpoint || '').trim();
  const p256dh = String(sub?.keys?.p256dh || '').trim();
  const auth = String(sub?.keys?.auth || '').trim();
  if (!endpoint || !/^https?:\/\//i.test(endpoint)) {
    throw new Error('Valid push endpoint URL is required.');
  }
  if (b64UrlDecode(p256dh).length !== 65 || b64UrlDecode(auth).length !== 16) {
    throw new Error('Valid p256dh and auth push keys are required.');
  }
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
       user_id = excluded.user_id,
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       user_agent = excluded.user_agent`
  ).run(userId ? Number(userId) : null, endpoint, p256dh, auth, String(userAgent || '').slice(0, 200), now);

  return db.prepare('SELECT id, user_id, endpoint, created_at, last_sent_at FROM push_subscriptions WHERE endpoint = ?').get(endpoint);
}

function removePushSubscription(db, endpoint) {
  const clean = String(endpoint || '').trim();
  if (!clean) return 0;
  return Number(db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(clean).changes || 0);
}

function countPushSubscriptions(db) {
  try {
    return Number(db.prepare('SELECT COUNT(*) AS cnt FROM push_subscriptions').get()?.cnt || 0);
  } catch {
    return 0;
  }
}

async function sendWebPushMessage(db, subRow, payloadObj) {
  const vapidKeys = getOrCreateVapidKeys(db);
  const subscription = {
    endpoint: subRow.endpoint,
    keys: {
      p256dh: subRow.p256dh,
      auth: subRow.auth,
    },
  };
  const encryptedBody = encryptWebPushPayload(subscription, payloadObj);
  const authHeader = buildVapidAuthHeader(subRow.endpoint, vapidKeys);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(subRow.endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'Content-Length': String(encryptedBody.length),
        TTL: '86400',
        Urgency: 'high',
        Authorization: authHeader,
      },
      body: encryptedBody,
    });
    if (res.status === 404 || res.status === 410) {
      removePushSubscription(db, subRow.endpoint);
      return { ok: false, status: res.status, pruned: true };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, pruned: false };
    }
    db.prepare('UPDATE push_subscriptions SET last_sent_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      subRow.id
    );
    return { ok: true, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

async function broadcastPushNotification(db, payloadObj) {
  let subs = [];
  try {
    subs = db.prepare('SELECT * FROM push_subscriptions ORDER BY id DESC').all();
  } catch {
    return { total: 0, sent: 0, failed: 0, pruned: 0 };
  }
  if (subs.length === 0) return { total: 0, sent: 0, failed: 0, pruned: 0 };

  let sent = 0;
  let failed = 0;
  let pruned = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        const outcome = await sendWebPushMessage(db, sub, payloadObj);
        if (outcome.ok) sent += 1;
        else {
          failed += 1;
          if (outcome.pruned) pruned += 1;
        }
      } catch {
        failed += 1;
      }
    })
  );
  return { total: subs.length, sent, failed, pruned };
}

function buildAutoLogNotificationPayload(tx, sourceLabel = '') {
  if (!tx) return null;
  const sign = tx.type === 'income' ? '+' : tx.type === 'transfer' ? '⇄ ' : '-';
  const cur = tx.currency || 'HUF';
  const amtNum = Number(tx.amount || 0);
  const amtText =
    cur === 'HUF' || Math.abs(amtNum - Math.round(amtNum)) < 0.005
      ? Math.round(amtNum).toLocaleString('en-US')
      : amtNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const acct = tx.account_name || 'Account';
  const pocket = tx.pocket_name || '';
  const where = pocket ? `${acct} (${pocket})` : acct;
  const label = tx.merchant || tx.category_name || 'Transaction';
  const originTag = sourceLabel || (tx.auto_source === 'receipt_autolog' ? 'Receipt Auto-Log' : 'Bank Notification');
  return {
    title: `MoneyManager: ${sign}${amtText} ${cur}`,
    body: `${label} · ${where} · ${originTag}`,
    tag: `mm-autolog-${tx.id || Date.now()}`,
    txId: tx.id || null,
    url: './',
  };
}

async function notifyAutoLoggedTransaction(db, tx, sourceLabel = '') {
  const payload = buildAutoLogNotificationPayload(tx, sourceLabel);
  if (!payload) return { total: 0, sent: 0, failed: 0, pruned: 0 };
  return broadcastPushNotification(db, payload);
}

module.exports = {
  b64UrlEncode,
  b64UrlDecode,
  getOrCreateVapidKeys,
  buildVapidAuthHeader,
  encryptWebPushPayload,
  savePushSubscription,
  removePushSubscription,
  countPushSubscriptions,
  broadcastPushNotification,
  buildAutoLogNotificationPayload,
  notifyAutoLoggedTransaction,
};
