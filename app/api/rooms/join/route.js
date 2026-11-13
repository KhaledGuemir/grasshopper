import crypto from 'node:crypto';
import { fail, json, body, clientIp, rateLimit } from '@/lib/server/http';
import { addPeer, getRoom, hostAlive, normalizeCode, pushSignal, sanitizeName } from '@/lib/server/rooms';
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
  if (!rateLimit(`join:${clientIp(request)}`, 40, 60_000)) {
    return fail('rate_limited', 429);
  }
  const input = await body(request);
  const code = normalizeCode(input.code);
  const name = sanitizeName(input.name) || 'Player';
  if (code.length !== 6) return fail('invalid_room_code', 400);
  if (Number(input.version || PROTOCOL_VERSION) !== PROTOCOL_VERSION) {
    return fail('version_mismatch', 409);
  }

  const room = await getRoom(code);
  if (!room) return fail('room_not_found', 404);
  if (!(await hostAlive(code))) return fail('host_offline', 410);
  if (room.version !== PROTOCOL_VERSION) return fail('version_mismatch', 409);

  const peerId = randomPeerId();
  const added = await addPeer(code, { id: peerId, name, role: 'client' });
  if (!added.ok) return fail(added.error || 'room_full', added.error === 'room_full' ? 409 : 404);

  try {
    const token = createToken({ room: code, peerId, role: 'client' });
    await pushSignal(code, room.hostPeerId, {
      from: peerId,
      type: 'join',
      data: { name },
      ts: Date.now(),
    });
    return json({
      ok: true,
      code,
      seed: room.seed,
      peerId,
      token,
      hostPeerId: room.hostPeerId,
      name,
      maxPlayers: room.maxPlayers,
      players: added.peers,
      version: PROTOCOL_VERSION,
    });
  } catch (err) {
    console.error('join room failed', err);
    return fail('server_not_configured', 503);
  }
}
