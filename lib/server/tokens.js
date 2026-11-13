import crypto from 'node:crypto';

const DEV_SECRET = 'gh-dev-room-secret-change-me';
const secret = process.env.ROOM_SECRET || DEV_SECRET;

function b64url(value) {
  return Buffer.from(value).toString('base64url');
}

function sign(data) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

export function createToken({ room, peerId, role = 'client', ttlSeconds = 7200 }) {
  if (isVercel() && !process.env.ROOM_SECRET) {
    throw new Error('ROOM_SECRET is not configured');
  }
  const payload = {
    room,
    peerId,
    role,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || !payload.room || !payload.peerId) return null;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
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
  const payload = verifyToken(bearerToken(req));
  return payload;
}

/* Vercel is the only environment where room state must live in Redis:
 * Functions are multi-instance. A local `next start` is a single process and
 * may use the in-memory room store for a small LAN game. */
export function isVercel() {
  return !!process.env.VERCEL;
}
