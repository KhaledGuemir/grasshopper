import test from 'node:test';
import assert from 'node:assert/strict';

import { POST as createRoom } from '../app/api/rooms/route.js';
import { POST as joinRoom } from '../app/api/rooms/join/route.js';
import { POST as leaveRoom } from '../app/api/rooms/leave/route.js';
import { GET as pollRelay, POST as sendRelay } from '../app/api/relay/route.js';
import { GET as pollSignal } from '../app/api/signal/route.js';

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

test('relay forwards input to the host and snapshots to a client', async () => {
  const host = await makeRoom();
  const client = await join(host, 'Client');

  const sent = await sendRelay(
    req('/api/relay', {
      method: 'POST',
      token: client.token,
      body: { room: host.code, to: host.peerId, ch: 'state', msg: { t: 'input', seq: 1, ax: 0, ay: 1 } },
    })
  );
  assert.equal(sent.status, 200);

  const hostPoll = await pollRelay(req('/api/relay', { token: host.token }));
  assert.equal(hostPoll.status, 200);
  const inbox = await hostPoll.json();
  assert.equal(inbox.messages.length, 1);
  assert.equal(inbox.messages[0].from, client.peerId);
  assert.equal(inbox.messages[0].msg.t, 'input');

  const snap = await sendRelay(
    req('/api/relay', {
      method: 'POST',
      token: host.token,
      body: { room: host.code, to: client.peerId, ch: 'state', msg: { t: 'snap', tick: 2 } },
    })
  );
  assert.equal(snap.status, 200);

  const clientPoll = await pollRelay(req('/api/relay', { token: client.token }));
  const outbox = await clientPoll.json();
  assert.equal(outbox.messages[0].msg.t, 'snap');
});

test('relay keeps the star topology and size limits', async () => {
  const host = await makeRoom();
  const a = await join(host, 'A');
  const b = await join(host, 'B');

  const cross = await sendRelay(
    req('/api/relay', {
      method: 'POST',
      token: a.token,
      body: { to: b.peerId, ch: 'state', msg: { t: 'input' } },
    })
  );
  assert.equal(cross.status, 403);

  const huge = await sendRelay(
    req('/api/relay', {
      method: 'POST',
      token: a.token,
      body: { to: host.peerId, ch: 'state', msg: { t: 'snap', blob: 'x'.repeat(60_000) } },
    })
  );
  assert.equal(huge.status, 413);

  const badChannel = await sendRelay(
    req('/api/relay', {
      method: 'POST',
      token: a.token,
      body: { to: host.peerId, ch: 'nope', msg: { t: 'input' } },
    })
  );
  assert.equal(badChannel.status, 400);
});

test('client leave notifies the host so the relay avatar can be removed', async () => {
  const host = await makeRoom();
  const client = await join(host, 'A');

  const left = await leaveRoom(
    req('/api/rooms/leave', {
      method: 'POST',
      body: { code: host.code, token: client.token },
    })
  );
  assert.equal(left.status, 200);

  const signalPoll = await pollSignal(
    req(`/api/signal?room=${host.code}`, { token: host.token })
  );
  assert.equal(signalPoll.status, 200);
  const signals = await signalPoll.json();
  assert.ok(signals.messages.some((m) => m.type === 'leave' && m.from === client.peerId));
});
