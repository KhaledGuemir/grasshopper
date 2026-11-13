import crypto from 'node:crypto';
import { fail, json, body, clientIp, rateLimit } from '@/lib/server/http';
import { createRoom, getRoom, makeRoomCode, sanitizeName } from '@/lib/server/rooms';
import { createToken, isVercel } from '@/lib/server/tokens';
import { hasRedis } from '@/lib/server/redis';
import { PROTOCOL_VERSION } from '@/lib/net/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function randomPeerId() {
  return `p_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

export async function POST(request) {
  if (isVercel() && !hasRedis) return fail('redis_not_configured', 503);
  if (!rateLimit(`create:${clientIp(request)}`, 12, 60_000)) {
    return fail('rate_limited', 429);
  }
  const input = await body(request);
  const name = sanitizeName(input.name) || 'Host';
  const maxPlayers = Math.max(1, Math.min(8, Number(input.maxPlayers) || 8));
  const peerId = randomPeerId();

  let code = null;
  for (let i = 0; i < 12; i++) {
    const candidate = makeRoomCode();
    if (!(await getRoom(candidate))) {
      code = candidate;
      break;
    }
  }
  if (!code) return fail('could_not_create_room', 503);

  const seed = crypto.randomInt(1, 0x7fffffff);
  try {
    await createRoom({
      code,
      seed,
      hostPeerId: peerId,
      hostName: name,
      maxPlayers,
      version: PROTOCOL_VERSION,
    });
    const token = createToken({ room: code, peerId, role: 'host' });
    return json({
      ok: true,
      code,
      seed,
      peerId,
      token,
      hostPeerId: peerId,
      name,
      maxPlayers,
      version: PROTOCOL_VERSION,
    });
  } catch (err) {
    console.error('create room failed', err);
    return fail('server_not_configured', 503);
  }
}
