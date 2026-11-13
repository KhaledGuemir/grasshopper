import { fail, json, body } from '@/lib/server/http';
import { addPeer, getRoom, hostAlive, listPeers, normalizeCode, pushSignal, sanitizeName } from '@/lib/server/rooms';
import { auth } from '@/lib/server/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const payload = auth(request);
  if (!payload) return fail('unauthorized', 401);
  const input = await body(request);
  const code = normalizeCode(payload.room);
  const room = await getRoom(code);
  if (!room) return fail('room_not_found', 404);
  if (!(await hostAlive(code))) return fail('host_offline', 410);

  const peers = await listPeers(code);
  const name = sanitizeName(input.name) || 'Player';
  let peer = peers.find((p) => p.id === payload.peerId);
  if (!peer) {
    const added = await addPeer(code, { id: payload.peerId, name, role: payload.role });
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
    hostPeerId: room.hostPeerId,
    players: await listPeers(code),
  });
}
