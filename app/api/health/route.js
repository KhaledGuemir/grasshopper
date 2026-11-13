import { hasRedis, ping } from '@/lib/server/redis';
import { isVercel } from '@/lib/server/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  let redis = 'memory';
  try {
    redis = await ping();
  } catch {
    redis = 'error';
  }
  const managed = isVercel();
  const ok = redis !== 'error' && (!managed || (hasRedis && !!process.env.ROOM_SECRET));
  return Response.json(
    {
      ok,
      redis,
      production: managed,
      local: !managed,
      roomSecret: !!process.env.ROOM_SECRET,
      turn: !!process.env.TURN_URL,
      version: 1,
    },
    {
      status: ok ? 200 : 503,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    }
  );
}
