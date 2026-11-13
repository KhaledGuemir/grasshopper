import { TOO_LARGE, body, clientIp, fail, json, rateLimit } from '@/lib/server/http';
import {
  drainRelay,
  getRoom,
  listPeers,
  pushRelay,
  roomExpired,
} from '@/lib/server/rooms';
import { auth } from '@/lib/server/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_RELAY_BYTES = 48 * 1024;

/* HTTP relay fallback. The client posts input/commands to the host mailbox and
 * the host posts snapshots/events to each client mailbox. The server only
 * forwards, exactly like the WebRTC signaling mailboxes. */
export async function POST(request) {
  const payload = auth(request);
  if (!payload) return fail('unauthorized', 401);
  if (!rateLimit(`relay:post:${clientIp(request)}:${payload.peerId}`, 12000, 60_000)) {
    return fail('rate_limited', 429);
  }
  const input = await body(request, 64 * 1024);
  if (input === TOO_LARGE) return fail('payload_too_large', 413);

  const to = String(input.to || '');
  if (!/^p_[A-Za-z0-9]{1,32}$/.test(to)) return fail('missing_target', 400);
  if (input.ch !== 'ctrl' && input.ch !== 'state') return fail('bad_channel', 400);
  if (!input.msg || typeof input.msg !== 'object') return fail('bad_message', 400);

  const room = await getRoom(payload.room);
  if (!room) return fail('room_not_found', 404);
  if (roomExpired(room)) return fail('room_expired', 410);

  if (payload.role === 'client') {
    if (room.hostPeerId !== to) return fail('forbidden', 403);
  } else {
    if (to === room.hostPeerId) return fail('forbidden', 403);
    const peers = await listPeers(payload.room);
    if (!peers.some((p) => p.id === to && p.role !== 'host')) return fail('peer_not_found', 404);
  }

  const encoded = JSON.stringify(input.msg);
  if (encoded.length > MAX_RELAY_BYTES) return fail('relay_too_large', 413);

  await pushRelay(payload.room, to, {
    from: payload.peerId,
    ch: input.ch,
    msg: input.msg,
  });
  return json({ ok: true });
}

export async function GET(request) {
  const payload = auth(request);
  if (!payload) return fail('unauthorized', 401);
  if (!rateLimit(`relay:get:${clientIp(request)}:${payload.peerId}`, 3000, 60_000)) {
    return fail('rate_limited', 429);
  }
  const room = await getRoom(payload.room);
  if (!room) return fail('room_not_found', 404);
  if (roomExpired(room)) return fail('room_expired', 410);
  const peers = await listPeers(payload.room);
  if (!peers.some((p) => p.id === payload.peerId)) return fail('peer_not_found', 410);

  const messages = await drainRelay(payload.room, payload.peerId);
  return json({ ok: true, messages });
}
