import test from 'node:test';
import assert from 'node:assert/strict';

import { POST as createRoom } from '../app/api/rooms/route.js';
import { POST as joinRoom } from '../app/api/rooms/join/route.js';
import { GET as roomStatus } from '../app/api/rooms/[code]/route.js';
import { POST as leaveRoom } from '../app/api/rooms/leave/route.js';
import { GET as pollSignal, POST as sendSignal } from '../app/api/signal/route.js';
import { POST as heartbeat } from '../app/api/rooms/heartbeat/route.js';

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

async function makeRoom() {
  const res = await createRoom(req('/api/rooms', { method: 'POST', body: { name: 'Host' } }));
  assert.equal(res.status, 200);
  return res.json();
}

async function join(room, name) {
  const res = await joinRoom(req('/api/rooms/join', { method: 'POST', body: { code: room.code, name } }));
  assert.equal(res.status, 200);
  return res.json();
}

test('clients cannot signal each other', async () => {
  const host = await makeRoom();
  const a = await join(host, 'A');
  const b = await join(host, 'B');

  const forbidden = await sendSignal(
    req('/api/signal', {
      method: 'POST',
      token: a.token,
      body: { room: host.code, to: b.peerId, type: 'offer', data: { sdp: 'nope' } },
    })
  );
  assert.equal(forbidden.status, 403);

  const hostGone = await sendSignal(
    req('/api/signal', {
      method: 'POST',
      token: host.token,
      body: { room: host.code, to: 'p_missing000', type: 'offer', data: { sdp: 'x' } },
    })
  );
  assert.equal(hostGone.status, 404);
});

test('signal payloads and room bodies are size limited', async () => {
  const host = await makeRoom();
  const client = await join(host, 'A');

  const hugeData = await sendSignal(
    req('/api/signal', {
      method: 'POST',
      token: host.token,
      body: { room: host.code, to: client.peerId, type: 'offer', data: { sdp: 'x'.repeat(25_000) } },
    })
  );
  assert.equal(hugeData.status, 413);

  const hugeCreate = await createRoom(
    req('/api/rooms', { method: 'POST', body: { name: 'x'.repeat(5000) } })
  );
  assert.equal(hugeCreate.status, 413);
});

test('clients keep presence and the token can be refreshed on rejoin', async () => {
  const host = await makeRoom();
  const client = await join(host, 'A');

  const beat = await heartbeat(
    req('/api/rooms/heartbeat', { method: 'POST', token: client.token, body: { code: host.code } })
  );
  assert.equal(beat.status, 200);
  const body = await beat.json();
  assert.equal(body.role, 'client');
});

test('host leave closes the room and later joins fail cleanly', async () => {
  const host = await makeRoom();
  const client = await join(host, 'A');

  const left = await leaveRoom(
    req('/api/rooms/leave', { method: 'POST', token: host.token, body: { code: host.code } })
  );
  assert.equal(left.status, 200);

  const status = await roomStatus(req(`/api/rooms/${host.code}`), {
    params: Promise.resolve({ code: host.code }),
  });
  assert.equal(status.status, 404);

  const late = await joinRoom(
    req('/api/rooms/join', { method: 'POST', body: { code: host.code, name: 'Late' } })
  );
  assert.equal(late.status, 404);

  const poll = await pollSignal(req(`/api/signal?room=${host.code}`, { token: client.token }));
  assert.notEqual(poll.status, 200);
});

test('unauthenticated and oversized signal requests are rejected', async () => {
  const missing = await pollSignal(req('/api/signal?room=ABCDEF'));
  assert.equal(missing.status, 401);

  const badType = await sendSignal(
    req('/api/signal', { method: 'POST', token: 'bad.token', body: { type: 'offer' } })
  );
  assert.equal(badType.status, 401);
});
