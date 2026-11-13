import { PROTOCOL_VERSION } from './protocol.js';

/* Optional split deployment: the UI can be served by one host while a small
 * Node process serves the room/signaling API. Empty means same-origin, which
 * is the zero-config setup. */
const SIGNAL_BASE = (process.env.NEXT_PUBLIC_SIGNAL_URL || '').replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = 12_000;

export const FALLBACK_ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

function signalUrl(path) {
  return SIGNAL_BASE ? SIGNAL_BASE + path : path;
}

function timeoutSignal() {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  }
  return undefined;
}

async function request(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    signal: options.signal || timeoutSignal(),
    cache: 'no-store',
  });
  return readResponse(res);
}

async function readResponse(res) {
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = new Error((data && (data.error || data.hint)) || `request_failed_${res.status}`);
    err.code = (data && data.error) || `http_${res.status}`;
    err.status = res.status;
    throw err;
  }
  return data || {};
}

export async function createRoom(name, maxPlayers = 8) {
  return request(signalUrl('/api/rooms'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, maxPlayers, version: PROTOCOL_VERSION }),
  });
}

export async function joinRoom(code, name) {
  return request(signalUrl('/api/rooms/join'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, name, version: PROTOCOL_VERSION }),
  });
}

export async function rejoinRoom(session) {
  return request(signalUrl('/api/rooms/rejoin'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify({ name: session.name || 'Player' }),
  });
}

export async function leaveRoom(session) {
  /* sendBeacon survives tab close and does not need an Authorization header;
   * the route accepts the token in the body for this path. */
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([JSON.stringify({ code: session.room, token: session.token })], {
        type: 'application/json',
      });
      if (navigator.sendBeacon(signalUrl('/api/rooms/leave'), blob)) return;
    }
  } catch {
    // fall through to fetch
  }
  try {
    await fetch(signalUrl('/api/rooms/leave'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
        'X-Room': session.room,
      },
      keepalive: true,
      body: JSON.stringify({ code: session.room }),
    });
  } catch {
    // best effort on unload
  }
}

export async function heartbeat(session) {
  return request(signalUrl('/api/rooms/heartbeat'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify({ code: session.room }),
  });
}

export async function sendSignal(session, to, type, data) {
  return request(signalUrl('/api/signal'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify({ room: session.room, to, type, data }),
  });
}

export async function pollSignals(session) {
  const url = new URL(signalUrl('/api/signal'), window.location.origin);
  url.searchParams.set('room', session.room);
  const data = await request(url.toString(), {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  return data.messages || [];
}

export async function getIceServers(session) {
  try {
    const data = await request(signalUrl('/api/turn'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (Array.isArray(data.iceServers) && data.iceServers.length) return data.iceServers;
  } catch {
    // fall through to the public STUN list
  }
  return FALLBACK_ICE;
}

export async function roomStatus(code) {
  return request(signalUrl(`/api/rooms/${encodeURIComponent(code)}`));
}


/* HTTP relay fallback (used when WebRTC cannot establish a direct path). */
export async function sendRelay(session, to, ch, msg) {
  return request(signalUrl('/api/relay'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify({ room: session.room, to, ch, msg }),
  });
}

export async function pollRelay(session) {
  const data = await request(signalUrl('/api/relay'), {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  return data.messages || [];
}
