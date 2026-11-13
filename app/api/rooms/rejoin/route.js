import { TOO_LARGE, body, clientIp, fail, json, rateLimit } from '@/lib/server/http';
import {
  addPeer,
  getRoom,
  hostAlive,
  listPeers,
  pushSignal,
  roomExpired,
  sanitizeName,
} from '@/lib/server/rooms';
import { auth, createToken } from '@/lib/server/tokens';
import { PROTOCOL_VERSION } from '@/lib/net/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const payload = auth(request);
  if (!payload) return fail('unauthorized', 401);
  if (payload.role !== 'client') return fail('forbidden', 403);
  if (!rateLimit(`rejoin:${clientIp(request)}:${payload.peerId}`, 30, 60_000)) {
    return fail('rate_limited', 429);
  }
  const input = await body(request, 2048);
  if (input === TOO_LARGE) return fail('payload_too_large', 413);

  const code = payload.room;
  const room = await getRoom(code);
  if (!room) return fail('room_not_found', 404);
  if (roomExpired(room)) return fail('room_expired', 410);
  if (!(await hostAlive(code))) return fail('host_offline', 410);
  if (room.version !== PROTOCOL_VERSION) return fail('version_mismatch', 409);

  const peers = await listPeers(code);
  const name = sanitizeName(input.name) || 'Player';
  let peer = peers.find((p) => p.id === payload.peerId);
  if (!peer) {
    /* The peer was pruned or the server restarted while the tab was away. Put
     * it back at its reserved identity instead of silently creating a new one,
     * so the host can keep the same remote avatar. */
    const added = await addPeer(code, {
      id: payload.peerId,
      name,
      role: payload.role,
      joinedAt: Date.now(),
    });
    if (!added.ok) return fail(added.error || 'room_full', 409);
    peer = added.peers.find((p) => p.id === payload.peerId);
  }

  await pushSignal(code, room.hostPeerId, {
    from: payload.peerId,
    type: 'join',
    data: { name: peer?.name || name, rejoin: true },
    ts: Date.now(),
  });

  return json({
    ok: true,
    code,
    seed: room.seed,
    peerId: payload.peerId,
    token: createToken({ room: code, peerId: payload.peerId, role: payload.role }),
    hostPeerId: room.hostPeerId,
    name: peer?.name || name,
    players: await listPeers(code),
    version: PROTOCOL_VERSION,
  });
}
