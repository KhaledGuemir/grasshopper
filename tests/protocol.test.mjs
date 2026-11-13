import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHANNEL,
  INPUT,
  MSG,
  PROTOCOL_VERSION,
  decode,
  encode,
} from '../lib/net/protocol.js';

test('protocol version is explicit', () => {
  assert.equal(PROTOCOL_VERSION, 1);
});

test('messages round-trip through encode/decode', () => {
  const msg = { t: MSG.SNAP, tick: 900, players: [{ i: 'p_1', x: 1.25 }] };
  assert.deepEqual(decode(encode(msg)), msg);
});

test('input bit flags are stable', () => {
  assert.equal(INPUT.JUMP, 1);
  assert.equal(INPUT.SPRINT, 2);
  assert.equal(INPUT.FIRE, 4);
  assert.equal(INPUT.USE, 8);
  assert.equal((INPUT.JUMP | INPUT.SPRINT | INPUT.FIRE | INPUT.USE), 15);
});

test('channel names are stable', () => {
  assert.equal(CHANNEL.CTRL, 'ctrl');
  assert.equal(CHANNEL.STATE, 'state');
});

test('malformed messages are rejected', () => {
  assert.equal(decode('not json'), null);
  assert.equal(decode('{"nope":1}'), null);
  assert.equal(decode('null'), null);
  assert.equal(decode(42), null);
});
