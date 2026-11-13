import crypto from 'node:crypto';
import { TOO_LARGE, body, clientIp, fail, json, rateLimit } from '@/lib/server/http';
import { createRoom, getRoom, makeRoomCode, sanitizeName } from '@/lib/server/rooms';
import { createToken, isServerless } from '@/lib/server/tokens';
import { hasRedis, storeKind } from '@/lib/server/redis';
import { PROTOCOL_VERSION } from '@/lib/net/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function randomPeerId() {
  return `p_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

export async function POST(request) {
  if (isServerless() && !hasRedis) {
    return fail('redis_not_configured', 503, {
      hint: 'Serverless deployments need a shared room store. Self-host the app for zero-config multiplayer, or set Upstash/Vercel KV credentials.',
    });
  }
  if (!rateLimit(`create:${clientIp(request)}`, 12, 60_000)) {
    return fail('rate_limited', 429);
  }
  const input = await body(request, 4096);
  if (input === TOO_LARGE) return fail('payload_too_large', 413);
  const name = sanitizeName(input.name) || 'Host';
  const maxPlayers = Math.max(1, Math.min(8, Number(input.maxPlayers) || 8));
  const peerId = randomPeerId();

  let code = null;
  for (let i = 0; i < 12; i++) {
    const candidate = makeRoomCode();
    if (await getRoom(candidate)) continue;
    code = candidate;
    const room = await createRoom({
      code,
      seed: crypto.randomInt(1, 0x7fffffff),
      hostPeerId: peerId,
      hostName: name,
      maxPlayers,
      version: PROTOCOL_VERSION,
    });
    if (room) break;
    code = null;
  }
  if (!code) return fail('could_not_create_room', 503);

  try {
    const room = await getRoom(code);
    const token = createToken({ room: code, peerId, role: 'host' });
    return json({
      ok: true,
      code,
      seed: room.seed,
      peerId,
      token,
      hostPeerId: peerId,
      name,
      maxPlayers: room.maxPlayers,
      version: PROTOCOL_VERSION,
      store: storeKind,
    });
  } catch (err) {
    console.error('create room failed', err);
    return fail('server_not_configured', 503);
  }
}
