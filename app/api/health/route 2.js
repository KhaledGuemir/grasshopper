import { hasRedis, ping, storeKind, storeStats } from '@/lib/server/redis';
import { isServerless, secretSource } from '@/lib/server/tokens';
import { PROTOCOL_VERSION } from '@/lib/net/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  let store = 'memory';
  try {
    store = await ping();
  } catch {
    store = 'error';
  }
  const managed = isServerless();
  /* A serverless deployment without a shared store cannot keep a room alive
   * across instances; report that as unhealthy instead of failing at join. */
  const ok = store !== 'error' && (!managed || hasRedis);
  return Response.json(
    {
      ok,
      store: storeStatistics(store),
      mode: managed ? 'serverless' : 'self-hosted',
      redis: hasRedis,
      roomSecret: secretSource,
      turn: !!process.env.TURN_URL,
      protocol: PROTOCOL_VERSION,
      uptime: Math.round(process.uptime()),
      version: 1,
      ...(ok ? {} : { hint: 'Serverless needs Redis. Self-host for the zero-config setup.' }),
    },
    {
      status: ok ? 200 : 503,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    }
  );
}

function storeStatistics(store) {
  if (store === 'memory') {
    try {
      return storeStats();
    } catch {
      return { kind: storeKind };
    }
  }
  return { kind: store };
}
