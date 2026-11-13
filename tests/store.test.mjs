import test from 'node:test';
import assert from 'node:assert/strict';

import {
  del,
  expire,
  get,
  hdel,
  hgetall,
  hset,
  lpop,
  lpush,
  lrange,
  ltrim,
  set,
  setIfAbsent,
  storeStats,
} from '../lib/server/redis.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('the default store is the in-process fallback', () => {
  const stats = storeStats();
  assert.equal(stats.kind, 'memory');
});

test('values and hashes honour TTLs', async () => {
  await set('ttl:key', 'value', 1);
  assert.equal(await get('ttl:key'), 'value');
  await sleep(1100);
  assert.equal(await get('ttl:key'), null);

  await hset('ttl:hash', { a: '1' });
  await expire('ttl:hash', 1);
  assert.deepEqual(await hgetall('ttl:hash'), { a: '1' });
  await sleep(1100);
  assert.equal(await hgetall('ttl:hash'), null);
});

test('hash fields can be updated and removed', async () => {
  await hset('h', { a: '1', b: '2' });
  await hset('h', { b: '3' });
  assert.deepEqual(await hgetall('h'), { a: '1', b: '3' });
  assert.equal(await hdel('h', 'a'), 1);
  assert.deepEqual(await hgetall('h'), { b: '3' });
  await del('h');
  assert.equal(await hgetall('h'), null);
});

test('lists pop oldest-first and can be trimmed', async () => {
  await lpush('l', 'one', 'two', 'three');
  assert.deepEqual(await lrange('l', 0, -1), ['three', 'two', 'one']);
  assert.equal(await lpop('l'), 'three');
  await ltrim('l', 0, 0);
  assert.deepEqual(await lrange('l', 0, -1), ['two']);
  await del('l');
});

test('setIfAbsent is a one-shot claim', async () => {
  assert.equal(await setIfAbsent('claim', 'a', 30), true);
  assert.equal(await setIfAbsent('claim', 'b', 30), false);
  assert.equal(await get('claim'), 'a');
  await del('claim');
});
