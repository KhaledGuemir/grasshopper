/* Single place where the app talks to its room store.
 *
 * The default deployment is deliberately zero-config: if no Redis credentials
 * are present the app uses an in-process store. That is the correct choice for
 * `next start`, Docker, a home server or a single small VPS, which is also the
 * only way to run multiplayer for free without signing up for an external
 * service or pasting API keys anywhere.
 *
 * Set KV_REST_API_URL/TOKEN (Vercel Marketplace Redis) or
 * UPSTASH_REDIS_REST_URL/TOKEN to share rooms between serverless instances.
 */
import { Redis } from '@upstash/redis';

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

/* Keep every value a string, exactly like the in-process store. Upstash's
 * automatic JSON deserialization would otherwise hand back objects from
 * hgetall/lpop and break code that expects to parse the stored JSON itself. */
export const redis = url && token ? new Redis({ url, token, automaticDeserialization: false }) : null;
export const hasRedis = !!redis;
export const storeKind = hasRedis ? 'redis' : 'memory';

/* ------------------------------------------------------------------ *
 * In-process store
 *
 * Every value carries its own expiry. Hashes are plain objects and lists are
 * arrays, which keeps the fallback small and dependency-free while matching
 * the handful of Redis commands the room layer needs. A background sweep plus
 * lazy expiry prevents the unbounded growth the previous version had.
 * ------------------------------------------------------------------ */
const memory = (globalThis.__ghStore ||= {
  data: new Map(),
  sweep: null,
});
const MAX_KEYS = 20_000;

function expired(entry) {
  return entry.exp > 0 && entry.exp <= Date.now();
}

function entry(key) {
  const found = memory.data.get(key);
  if (!found) return null;
  if (expired(found)) {
    memory.data.delete(key);
    return null;
  }
  return found;
}

function put(key, value, ttlSeconds) {
  if (memory.data.size >= MAX_KEYS && !memory.data.has(key)) {
    // Bounded fallback: evict the oldest key rather than grow without limit.
    const oldest = memory.data.keys().next().value;
    if (oldest !== undefined) memory.data.delete(oldest);
  }
  memory.data.set(key, {
    v: value,
    exp: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0,
  });
}

function startSweep() {
  if (memory.sweep || hasRedis) return;
  memory.sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, found] of memory.data) {
      if (found.exp > 0 && found.exp <= now) memory.data.delete(key);
    }
  }, 60_000);
  if (typeof memory.sweep.unref === 'function') memory.sweep.unref();
}
startSweep();

export function storeStats() {
  return { kind: storeKind, keys: hasRedis ? null : memory.data.size };
}

export async function ping() {
  if (!redis) return 'memory';
  await redis.ping();
  return 'redis';
}

export async function get(key) {
  if (!redis) return entry(key)?.v ?? null;
  return redis.get(key);
}

export async function set(key, value, ttlSeconds) {
  if (!redis) {
    put(key, value, ttlSeconds);
    return 'OK';
  }
  if (ttlSeconds) return redis.set(key, value, { ex: ttlSeconds });
  return redis.set(key, value);
}

/* SET NX — used to claim a room code before writing room state. */
export async function setIfAbsent(key, value, ttlSeconds) {
  if (!redis) {
    if (entry(key)) return false;
    put(key, value, ttlSeconds);
    return true;
  }
  const result = await redis.set(key, value, {
    nx: true,
    ...(ttlSeconds ? { ex: ttlSeconds } : {}),
  });
  return result === 'OK';
}

export async function del(...keys) {
  if (!redis) {
    for (const key of keys) memory.data.delete(key);
    return keys.length;
  }
  return redis.del(...keys);
}

export async function expire(key, seconds) {
  if (!redis) {
    const found = entry(key);
    if (!found) return 0;
    found.exp = seconds > 0 ? Date.now() + seconds * 1000 : 0;
    return 1;
  }
  return redis.expire(key, seconds);
}

export async function hset(key, values) {
  if (!redis) {
    const found = entry(key);
    const hash = found && found.v && typeof found.v === 'object' ? found.v : {};
    for (const [field, value] of Object.entries(values)) hash[field] = String(value);
    put(key, hash, found && found.exp ? Math.max(1, Math.round((found.exp - Date.now()) / 1000)) : 0);
    return Object.keys(values).length;
  }
  const flat = {};
  for (const [field, value] of Object.entries(values)) flat[field] = String(value);
  return redis.hset(key, flat);
}

export async function hgetall(key) {
  if (!redis) {
    const found = entry(key);
    if (!found || !found.v || typeof found.v !== 'object') return null;
    return { ...found.v };
  }
  const result = await redis.hgetall(key);
  if (!result) return null;
  /* With automatic deserialization disabled, some Upstash versions return the
   * raw RESP field/value array instead of an object. Normalize both shapes. */
  if (Array.isArray(result)) {
    const out = {};
    for (let i = 0; i + 1 < result.length; i += 2) out[result[i]] = result[i + 1];
    return out;
  }
  return result;
}

export async function hdel(key, ...fields) {
  if (!redis) {
    const found = entry(key);
    if (!found || !found.v || typeof found.v !== 'object') return 0;
    let removed = 0;
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(found.v, field)) {
        delete found.v[field];
        removed++;
      }
    }
    return removed;
  }
  return redis.hdel(key, ...fields);
}

export async function lpush(key, ...values) {
  if (!redis) {
    const found = entry(key);
    const list = found && Array.isArray(found.v) ? found.v : [];
    for (const value of values) list.unshift(String(value));
    put(key, list, found && found.exp ? Math.max(1, Math.round((found.exp - Date.now()) / 1000)) : 0);
    return list.length;
  }
  return redis.lpush(key, ...values);
}

export async function lpop(key) {
  if (!redis) {
    const found = entry(key);
    if (!found || !Array.isArray(found.v) || !found.v.length) return null;
    return found.v.shift() ?? null;
  }
  return redis.lpop(key);
}

export async function lrange(key, start, stop) {
  if (!redis) {
    const list = entry(key)?.v;
    if (!Array.isArray(list)) return [];
    const end = stop < 0 ? list.length : stop + 1;
    return list.slice(start, end);
  }
  return redis.lrange(key, start, stop);
}

export async function ltrim(key, start, stop) {
  if (!redis) {
    const found = entry(key);
    if (!found || !Array.isArray(found.v)) return 'OK';
    const end = stop < 0 ? found.v.length : stop + 1;
    found.v = found.v.slice(start, end);
    return 'OK';
  }
  return redis.ltrim(key, start, stop);
}
