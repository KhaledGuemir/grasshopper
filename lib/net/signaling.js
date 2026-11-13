import { PROTOCOL_VERSION } from './protocol.js';

/* Optional split deployment: Vercel serves the UI, a local/tunneled Node
 * process serves the room/signaling API. Empty means same-origin. */
const SIGNAL_BASE = (process.env.NEXT_PUBLIC_SIGNAL_URL || '').replace(/\/+$/, '');

function signalUrl(path) {
  return SIGNAL_BASE ? SIGNAL_BASE + path : path;
}

async function readResponse(res) {
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `request_failed_${res.status}`);
    err.code = (data && data.error) || `http_${res.status}`;
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function createRoom(name, maxPlayers = 8) {
  const res = await fetch(signalUrl('/api/rooms'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ name, maxPlayers, version: PROTOCOL_VERSION }),
  });
  return readResponse(res);
}

export async function joinRoom(code, name) {
  const res = await fetch(signalUrl('/api/rooms/join'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ code, name, version: PROTOCOL_VERSION }),
  });
  return readResponse(res);
}

export async function rejoinRoom(session) {
  const res = await fetch(signalUrl('/api/rooms/rejoin'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.token}`,
    },
    cache: 'no-store',
    body: JSON.stringify({ name: session.name || 'Player' }),
  });
  return readResponse(res);
}

export async function leaveRoom(session) {
  try {
    await fetch(signalUrl('/api/rooms/leave'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      cache: 'no-store',
      keepalive: true,
      body: JSON.stringify({ code: session.room }),
    });
  } catch {
    // best effort on unload
  }
}

export async function heartbeat(session) {
  const res = await fetch(signalUrl('/api/rooms/heartbeat'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.token}`,
    },
    cache: 'no-store',
    body: JSON.stringify({ code: session.room }),
  });
  return readResponse(res);
}

export async function sendSignal(session, to, type, data) {
  const res = await fetch(signalUrl('/api/signal'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.token}`,
    },
    cache: 'no-store',
    body: JSON.stringify({ room: session.room, to, type, data }),
  });
  return readResponse(res);
}

export async function pollSignals(session) {
  const url = new URL(signalUrl('/api/signal'), window.location.origin);
  url.searchParams.set('room', session.room);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${session.token}` },
    cache: 'no-store',
  });
  const data = await readResponse(res);
  return data.messages || [];
}

export async function getIceServers(session) {
  const res = await fetch(signalUrl('/api/turn'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.token}` },
    cache: 'no-store',
  });
  const data = await readResponse(res);
  return Array.isArray(data.iceServers) && data.iceServers.length
    ? data.iceServers
    : [{ urls: 'stun:stun.l.google.com:19302' }];
}

export async function roomStatus(code) {
  const res = await fetch(signalUrl(`/api/rooms/${encodeURIComponent(code)}`), { cache: 'no-store' });
  return readResponse(res);
}
