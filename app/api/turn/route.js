import crypto from 'node:crypto';
import { fail, json, clientIp, rateLimit } from '@/lib/server/http';
import { auth } from '@/lib/server/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STUN = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export async function POST(request) {
  const payload = auth(request);
  if (!payload) return fail('unauthorized', 401);
  if (!rateLimit(`turn:${clientIp(request)}:${payload.peerId}`, 30, 60_000)) {
    return fail('rate_limited', 429);
  }

  const iceServers = [...STUN];
  const turnUrl = process.env.TURN_URL;
  if (turnUrl) {
    const urls = turnUrl.split(',').map((s) => s.trim()).filter(Boolean);
    let username = process.env.TURN_USERNAME;
    let credential = process.env.TURN_CREDENTIAL;

    if (process.env.TURN_SECRET) {
      const ttl = 3600;
      const exp = Math.floor(Date.now() / 1000) + ttl;
      username = `${exp}:${payload.room}`;
      credential = crypto.createHmac('sha1', process.env.TURN_SECRET).update(username).digest('base64');
    }

    if (username && credential) {
      iceServers.push({ urls, username, credential });
    }
  }
  return json({ ok: true, iceServers });
}
