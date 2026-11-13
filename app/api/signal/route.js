import { fail, json, body, clientIp, rateLimit } from '@/lib/server/http';
import { drainSignals, listPeers, normalizeCode, pushSignal } from '@/lib/server/rooms';
import { auth } from '@/lib/server/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = new Set(['offer', 'answer', 'ice', 'ready', 'leave', 'error']);

export async function POST(request) {
  const payload = auth(request);
  if (!payload) return fail('unauthorized', 401);
  if (!rateLimit(`signal:${clientIp(request)}:${payload.peerId}`, 120, 60_000)) {
    return fail('rate_limited', 429);
  }
  const input = await body(request);
  const code = normalizeCode(input.room || payload.room);
  if (code !== payload.room) return fail('forbidden', 403);
  const type = String(input.type || '');
  if (!ALLOWED.has(type)) return fail('bad_signal_type', 400);
  const to = String(input.to || '');
  if (!to) return fail('missing_target', 400);

  const peers = await listPeers(code);
  if (!peers.some((p) => p.id === to)) return fail('peer_not_found', 404);

  const data = input.data ?? null;
  const encoded = JSON.stringify(data);
  if (encoded && encoded.length > 24_000) return fail('signal_too_large', 413);

  await pushSignal(code, to, {
    from: payload.peerId,
    type,
    data,
    ts: Date.now(),
  });
  return json({ ok: true });
}

export async function GET(request) {
  const payload = auth(request);
  if (!payload) return fail('unauthorized', 401);
  if (!rateLimit(`poll:${clientIp(request)}:${payload.peerId}`, 180, 60_000)) {
    return fail('rate_limited', 429);
  }
  const url = new URL(request.url);
  const code = normalizeCode(url.searchParams.get('room') || payload.room);
  if (code !== payload.room) return fail('forbidden', 403);
  const messages = await drainSignals(code, payload.peerId);
  return json({ ok: true, messages });
}
