import { fail, json, clientIp, rateLimit } from '@/lib/server/http';
import { deleteRoom, getRoom, hostAlive, listPeers, normalizeCode, roomExpired } from '@/lib/server/rooms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request, context) {
  if (!rateLimit(`status:${clientIp(request)}`, 120, 60_000)) {
    return fail('rate_limited', 429);
  }
  const { code: raw } = await context.params;
  const code = normalizeCode(raw);
  const room = await getRoom(code);
  if (!room) return fail('room_not_found', 404);
  if (roomExpired(room)) {
    await deleteRoom(code);
    return fail('room_expired', 410);
  }
  const peers = await listPeers(code);
  return json({
    ok: true,
    code: room.code,
    hostName: room.hostName,
    maxPlayers: room.maxPlayers,
    playerCount: peers.length,
    status: room.status,
    version: room.version,
    hostAlive: await hostAlive(code),
  });
}
