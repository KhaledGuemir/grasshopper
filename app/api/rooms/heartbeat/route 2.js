import { TOO_LARGE, body, fail, json } from '@/lib/server/http';
import {
  ROOM_TTL,
  deleteRoom,
  getRoom,
  heartbeatRoom,
  roomExpired,
  touchPeer,
} from '@/lib/server/rooms';
import { auth } from '@/lib/server/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* Both sides use this route: the host refreshes the room TTL, clients refresh
 * their presence timestamp. Presence keeps abandoned clients out of the room
 * capacity check. */
export async function POST(request) {
  const payload = auth(request);
  if (!payload) return fail('unauthorized', 401);
  const input = await body(request, 2048);
  if (input === TOO_LARGE) return fail('payload_too_large', 413);

  const code = payload.room;
  const room = await getRoom(code);
  if (!room) return fail('room_not_found', 404);
  if (roomExpired(room)) {
    await deleteRoom(code);
    return fail('room_expired', 410);
  }

  if (payload.role === 'host') {
    if (room.hostPeerId !== payload.peerId) return fail('forbidden', 403);
    await heartbeatRoom(code);
    return json({
      ok: true,
      role: 'host',
      remaining: Math.max(0, ROOM_TTL - Math.floor((Date.now() - room.createdAt) / 1000)),
    });
  }

  const touched = await touchPeer(code, payload.peerId);
  if (!touched) return fail('peer_not_found', 410);
  return json({ ok: true, role: 'client' });
}
