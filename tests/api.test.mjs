import test from 'node:test';
import assert from 'node:assert/strict';

import { POST as createRoom } from '../app/api/rooms/route.js';
import { POST as joinRoom } from '../app/api/rooms/join/route.js';
import { POST as heartbeat } from '../app/api/rooms/heartbeat/route.js';
import { GET as roomStatus } from '../app/api/rooms/[code]/route.js';
import { POST as leaveRoom } from '../app/api/rooms/leave/route.js';
import { POST as rejoinRoom } from '../app/api/rooms/rejoin/route.js';
import { GET as pollSignal, POST as sendSignal } from '../app/api/signal/route.js';
import { POST as turn } from '../app/api/turn/route.js';
import { GET as health } from '../app/api/health/route.js';

function req(url, { method = 'GET', token, body } = {}) {
  return new Request(`http://localhost${url}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test('create, join, signal, heartbeat and status', async () => {
  const created = await createRoom(req('/api/rooms', { method: 'POST', body: { name: 'Host', maxPlayers: 8 } }));
  assert.equal(created.status, 200);
  const host = await created.json();
  assert.equal(host.code.length, 6);
  assert.ok(host.seed > 0);
  assert.ok(host.token);

  const joined = await joinRoom(
    req('/api/rooms/join', { method: 'POST', body: { code: host.code, name: 'Client' } })
  );
  assert.equal(joined.status, 200);
  const client = await joined.json();
  assert.notEqual(client.peerId, host.peerId);
  assert.equal(client.seed, host.seed);

  const hostPoll = await pollSignal(req(`/api/signal?room=${host.code}`, { token: host.token }));
  assert.equal(hostPoll.status, 200);
  const hostMessages = await hostPoll.json();
  assert.equal(hostMessages.messages.length, 1);
  assert.equal(hostMessages.messages[0].type, 'join');

  const offer = await sendSignal(
    req('/api/signal', {
      method: 'POST',
      token: host.token,
      body: { room: host.code, to: client.peerId, type: 'offer', data: { sdp: 'offer' } },
    })
  );
  assert.equal(offer.status, 200);

  const clientPoll = await pollSignal(req(`/api/signal?room=${host.code}`, { token: client.token }));
  const clientMessages = await clientPoll.json();
  assert.equal(clientMessages.messages[0].type, 'offer');
  assert.equal(clientMessages.messages[0].data.sdp, 'offer');

  const beat = await heartbeat(req('/api/rooms/heartbeat', { method: 'POST', token: host.token, body: { code: host.code } }));
  assert.equal(beat.status, 200);

  const rejoin = await rejoinRoom(
    req('/api/rooms/rejoin', { method: 'POST', token: client.token, body: { name: 'Client' } })
  );
  assert.equal(rejoin.status, 200);
  const rejoinData = await rejoin.json();
  assert.equal(rejoinData.seed, host.seed);

  const status = await roomStatus(req(`/api/rooms/${host.code}`), { params: Promise.resolve({ code: host.code }) });
  const info = await status.json();
  assert.equal(info.playerCount, 2);

  const ice = await turn(req('/api/turn', { method: 'POST', token: client.token }));
  const iceData = await ice.json();
  assert.ok(Array.isArray(iceData.iceServers));
  assert.ok(iceData.iceServers.length >= 1);

  const left = await leaveRoom(
    req('/api/rooms/leave', { method: 'POST', token: client.token, body: { code: host.code } })
  );
  assert.equal(left.status, 200);
  const after = await roomStatus(req(`/api/rooms/${host.code}`), { params: Promise.resolve({ code: host.code }) });
  const afterInfo = await after.json();
  assert.equal(afterInfo.playerCount, 1);
});

test('rejects missing and malformed tokens', async () => {
  const missing = await sendSignal(req('/api/signal', { method: 'POST', body: { type: 'offer' } }));
  assert.equal(missing.status, 401);

  const bad = await sendSignal(req('/api/signal', { method: 'POST', token: 'nope', body: { type: 'offer' } }));
  assert.equal(bad.status, 401);
});

test('health reports memory in development', async () => {
  const res = await health();
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.redis, 'memory');
});
