/* HMAC room tokens.
 *
 * Zero-config deployments must still be safe. The secret is resolved in this
 * order:
 *
 *   1. ROOM_SECRET, when the operator sets one (recommended for a VPS).
 *   2. A value derived from the Redis credentials, so every serverless
 *      instance sharing one database also shares one signing key. This keeps
 *      Vercel + Upstash working without an extra secret.
 *   3. A random per-process secret for the in-memory single-node fallback.
 *
 * The old development constant ("gh-dev-room-secret-change-me") is gone: a
 * public, known signing key lets anyone forge a host token.
 */
import crypto from 'node:crypto';

const ROOM_CODE = /^[A-Z0-9]{6}$/;
const PEER_ID = /^p_[A-Za-z0-9]{1,32}$/;

function resolveSecret() {
  const explicit = (process.env.ROOM_SECRET || '').trim();
  if (explicit) {
    return {
      secret: crypto.createHash('sha256').update('gh-room:' + explicit).digest(),
      source: 'env',
    };
  }

  const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
  const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
  if (redisUrl && redisToken) {
    return {
      secret: crypto
        .createHash('sha256')
        .update('gh-room-redis:' + redisUrl + ':' + redisToken)
        .digest(),
      source: 'derived',
    };
  }

  globalThis.__ghTokenSecret ||= crypto.randomBytes(32);
  return { secret: globalThis.__ghTokenSecret, source: 'generated' };
}

const resolved = resolveSecret();
const secret = resolved.secret;

export const secretSource = resolved.source;

function b64url(value) {
  return Buffer.from(value).toString('base64url');
}

function sign(data) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

export function createToken({ room, peerId, role = 'client', ttlSeconds = 7200 }) {
  if (!ROOM_CODE.test(room)) throw new Error('invalid room code');
  if (!PEER_ID.test(peerId)) throw new Error('invalid peer id');
  if (role !== 'host' && role !== 'client') throw new Error('invalid role');
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    room,
    peerId,
    role,
    iat: now,
    exp: now + Math.max(60, Math.min(ttlSeconds, 7200)),
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string' || token.length > 4096) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object') return null;
    if (!ROOM_CODE.test(String(payload.room || ''))) return null;
    if (!PEER_ID.test(String(payload.peerId || ''))) return null;
    if (payload.role !== 'host' && payload.role !== 'client') return null;
    if (!Number.isFinite(payload.exp) || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function bearerToken(req) {
  const h = req.headers.get('authorization') || '';
  if (!h.toLowerCase().startsWith('bearer ')) return null;
  return h.slice(7).trim();
}

export function auth(req) {
  return verifyToken(bearerToken(req));
}

/* Serverless platforms use multiple short-lived instances, so room state must
 * be shared (Redis). Everywhere else the in-process store is a valid target. */
export function isServerless() {
  return !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;
}

export function isVercel() {
  return !!process.env.VERCEL;
}
