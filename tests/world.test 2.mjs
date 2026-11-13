import test from 'node:test';
import assert from 'node:assert/strict';

import { mulberry32, hashString, seedFromRoom, worldChecksum } from '../lib/world/rng.js';

test('same seed produces the same sequence', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const left = [a(), a(), a(), a()];
  const right = [b(), b(), b(), b()];
  assert.deepEqual(left, right);
});

test('different seeds diverge', () => {
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
});

test('world checksum is stable and order independent', () => {
  const solids = [
    { x: 1, z: 2, r: 0.5 },
    { x: 3.25, z: -4.5, r: 1.2 },
  ];
  const chests = [{ g: { position: { x: 9, z: 8 } } }];
  const homes = [{ x: 0, z: 6, r: 12 }];
  const one = worldChecksum(solids, chests, homes);
  const two = worldChecksum([...solids].reverse(), chests, homes);
  assert.equal(one, two);
  assert.match(one, /^[0-9a-f]{8}$/);
});

test('room codes map to stable seeds', () => {
  assert.equal(seedFromRoom('abc123'), seedFromRoom('ABC123'));
  assert.notEqual(hashString('ABC123'), hashString('ABC124'));
});
