import { TOO_LARGE, body, fail, json } from '@/lib/server/http';
import { deleteRoom, getRoom, normalizeCode, pushSignal, removePeer } from '@/lib/server/rooms';
import { auth, verifyToken } from '@/lib/server/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const input = await body(request, 2048);
  if (input === TOO_LARGE) return fail('payload_too_large', 413);
  /* sendBeacon cannot attach headers, so accept the token in the body too. */
  const payload = auth(request) || verifyToken(input.token);
  if (!payload) return fail('unauthorized', 401);

  const code = normalizeCode(input.code || request.headers.get('x-room') || payload.room);
  if (code !== payload.room) return fail('forbidden', 403);

  const room = await getRoom(code);
  if (payload.role === 'host') {
    await deleteRoom(code);
  } else {
    await removePeer(code, payload.peerId);
    /* Tell the host immediately so the relay avatar disappears without
     * waiting for the presence timeout. */
    if (room && room.hostPeerId) {
      await pushSignal(code, room.hostPeerId, {
        from: payload.peerId,
        type: 'leave',
        data: {},
        ts: Date.now(),
      });
    }
  }
  return json({ ok: true });
}
