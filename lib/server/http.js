export function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function fail(error, status = 400, extra = {}) {
  return json({ ok: false, error, ...extra }, status);
}

export async function body(req) {
  try {
    const data = await req.json();
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

export function clientIp(req) {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

/* Small in-memory rate limiter for development and as a cheap first line of
 * defence. In production, put Redis-backed limits in front of the endpoints. */
const buckets = (globalThis.__ghRate ||= new Map());

export function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now > bucket.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}
