import { fail, json, body } from '@/lib/server/http';
import { ROOM_TTL, deleteRoom, getRoom, heartbeat, normalizeCode } from '@/lib/server/rooms';
import { auth } from '@/lib/server/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const payload = auth(request);
  if (!payload) return fail('unauthorized', 401);
  if (payload.role !== 'host') return fail('forbidden', 403);
  const input = await body(request);
  const code = normalizeCode(input.code || payload.room);
  if (code !== payload.room) return fail('forbidden', 403);
  const room = await getRoom(code);
  if (!room) return fail('room_not_found', 404);
  if (Date.now() - room.createdAt > ROOM_TTL * 1000) {
    await deleteRoom(code);
    return fail('room_expired', 410);
  }
  await heartbeat(code);
  return json({ ok: true });
}
