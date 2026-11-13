export function json(data, status = 200, extraHeaders = {}) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

export function fail(error, status = 400, extra = {}) {
  return json({ ok: false, error, ...extra }, status);
}

/* Sentinel returned when a request body exceeds the route's budget. Callers
 * turn this into a 413 rather than silently treating it as an empty object
 * (which used to let a huge body create a room with a default name). */
export const TOO_LARGE = Symbol('body-too-large');

export async function body(req, maxBytes = 16 * 1024) {
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > maxBytes) return TOO_LARGE;
  let text;
  try {
    text = await req.text();
  } catch {
    return {};
  }
  if (text.length > maxBytes) return TOO_LARGE;
  if (!text) return {};
  try {
    const data = JSON.parse(text);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

export function clientIp(req) {
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-real-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/* Small in-memory limiter. Good enough for a single Node process and a useful
 * first line of defence behind a reverse proxy; Redis-backed limits can be
 * layered on later without changing call sites. */
const buckets = (globalThis.__ghRate ||= new Map());
const MAX_BUCKETS = 10_000;

export function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now > bucket.reset) {
    if (buckets.size >= MAX_BUCKETS) {
      // Drop expired buckets before evicting a live one.
      for (const [k, v] of buckets) {
        if (now > v.reset) buckets.delete(k);
      }
      if (buckets.size >= MAX_BUCKETS) {
        const oldest = buckets.keys().next().value;
        if (oldest !== undefined) buckets.delete(oldest);
      }
    }
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}

export function rateLimitCount() {
  return buckets.size;
}
