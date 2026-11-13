import crypto from 'node:crypto';
import { fail, json, clientIp, rateLimit } from '@/lib/server/http';
import { auth } from '@/lib/server/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* Public, free STUN servers. They need no account, key or quota and cover the
 * common home-NAT case. Add TURN_* env vars only if you run coturn yourself
 * (see deploy/coturn) or use a provider. */
const DEFAULT_STUN = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

function stunServers() {
  const custom = (process.env.STUN_URLS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!custom.length) return DEFAULT_STUN;
  return custom.map((urls) => ({ urls }));
}

export async function POST(request) {
  const payload = auth(request);
  if (!payload) return fail('unauthorized', 401);
  if (!rateLimit(`turn:${clientIp(request)}:${payload.peerId}`, 60, 60_000)) {
    return fail('rate_limited', 429);
  }

  const iceServers = [...stunServers()];
  let expiresAt = null;
  const turnUrl = (process.env.TURN_URL || '').trim();
  if (turnUrl) {
    const urls = turnUrl.split(',').map((s) => s.trim()).filter(Boolean);
    let username = process.env.TURN_USERNAME;
    let credential = process.env.TURN_CREDENTIAL;

    if (process.env.TURN_SECRET) {
      const ttl = 3600;
      expiresAt = Math.floor(Date.now() / 1000) + ttl;
      username = `${expiresAt}:${payload.room}`;
      credential = crypto.createHmac('sha1', process.env.TURN_SECRET).update(username).digest('base64');
    }

    if (username && credential) {
      iceServers.push({
        urls,
        username,
        credential,
        ...(expiresAt ? { expiresAt } : {}),
      });
    }
  }
  return json({ ok: true, iceServers, stunOnly: iceServers.length === stunServers().length });
}
