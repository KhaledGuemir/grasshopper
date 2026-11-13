import { fail, json, body } from '@/lib/server/http';
import { deleteRoom, normalizeCode, removePeer } from '@/lib/server/rooms';
import { auth } from '@/lib/server/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const payload = auth(request);
  if (!payload) return fail('unauthorized', 401);
  const input = await body(request);
  const code = normalizeCode(input.code || payload.room);
  if (code !== payload.room) return fail('forbidden', 403);
  if (payload.role === 'host') await deleteRoom(code);
  else await removePeer(code, payload.peerId);
  return json({ ok: true });
}
