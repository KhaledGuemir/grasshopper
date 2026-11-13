/* Single place where the app talks to Redis.
 *
 * Production uses Vercel Marketplace Redis (Upstash). Local development and
 * preview environments without Redis fall back to an in-process Map so the
 * lobby can still be exercised. The fallback is intentionally not durable and
 * must never be used as production room storage.
 */
import { Redis } from '@upstash/redis';

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const redis = url && token ? new Redis({ url, token }) : null;
export const hasRedis = !!redis;

const memory = (globalThis.__ghMemory ||= {
  values: new Map(),
  hashes: new Map(),
  lists: new Map(),
});

function memHash(key) {
  let h = memory.hashes.get(key);
  if (!h) {
    h = new Map();
    memory.hashes.set(key, h);
  }
  return h;
}

function memList(key) {
  let l = memory.lists.get(key);
  if (!l) {
    l = [];
    memory.lists.set(key, l);
  }
  return l;
}

export async function ping() {
  if (!redis) return 'memory';
  await redis.ping();
  return 'redis';
}

export async function get(key) {
  if (!redis) return memory.values.get(key) ?? null;
  return redis.get(key);
}

export async function set(key, value, ttlSeconds) {
  if (!redis) {
    memory.values.set(key, value);
    return 'OK';
  }
  if (ttlSeconds) return redis.set(key, value, { ex: ttlSeconds });
  return redis.set(key, value);
}

export async function del(...keys) {
  if (!redis) {
    for (const key of keys) {
      memory.values.delete(key);
      memory.hashes.delete(key);
      memory.lists.delete(key);
    }
    return keys.length;
  }
  return redis.del(...keys);
}

export async function expire(key, seconds) {
  if (!redis) return 1;
  return redis.expire(key, seconds);
}

export async function hset(key, values) {
  if (!redis) {
    const h = memHash(key);
    for (const [field, value] of Object.entries(values)) h.set(field, String(value));
    return Object.keys(values).length;
  }
  const flat = {};
  for (const [field, value] of Object.entries(values)) flat[field] = String(value);
  return redis.hset(key, flat);
}

export async function hgetall(key) {
  if (!redis) {
    const h = memory.hashes.get(key);
    return h ? Object.fromEntries(h.entries()) : null;
  }
  return redis.hgetall(key);
}

export async function lpush(key, ...values) {
  if (!redis) {
    const l = memList(key);
    for (const value of values) l.unshift(value);
    return l.length;
  }
  return redis.lpush(key, ...values);
}

export async function lrange(key, start, stop) {
  if (!redis) {
    const l = memory.lists.get(key) || [];
    const end = stop < 0 ? l.length : stop + 1;
    return l.slice(start, end);
  }
  return redis.lrange(key, start, stop);
}

export async function ltrim(key, start, stop) {
  if (!redis) {
    const l = memory.lists.get(key);
    if (!l) return 'OK';
    const end = stop < 0 ? l.length : stop + 1;
    memory.lists.set(key, l.slice(start, end));
    return 'OK';
  }
  return redis.ltrim(key, start, stop);
}
