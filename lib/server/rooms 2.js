import crypto from 'node:crypto';
import {
  del,
  expire,
  get,
  hdel,
  hgetall,
  hset,
  lpop,
  lpush,
  ltrim,
  set,
  setIfAbsent,
} from './redis.js';

export const ROOM_TTL = 60 * 60 * 2;
export const SIGNAL_TTL = 120;
export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 1;
export const PEER_STALE_SECONDS = 10 * 60;
export const HOST_ALIVE_TTL = 120;
const MAX_SIGNALS = 100;

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function normalizeCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

export function validCode(code) {
  return /^[A-Z0-9]{6}$/.test(code);
}

export function sanitizeName(name) {
  return String(name || '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20);
}

export function makeRoomCode() {
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return out;
}

const roomKey = (code) => `room:${code}`;
const peersKey = (code) => `room:${code}:peers`;
const aliveKey = (code) => `room:${code}:hostAlive`;
const claimKey = (code) => `room:${code}:claim`;
const signalKey = (code, peerId) => `signal:${code}:${peerId}`;
const relayKey = (code, peerId) => `relay:${code}:${peerId}`;

export async function getRoom(code) {
  const raw = await hgetall(roomKey(code));
  if (!raw || !raw.seed) return null;
  return {
    code: raw.code || code,
    seed: Number(raw.seed) || 1,
    hostPeerId: raw.hostPeerId,
    hostName: raw.hostName,
    maxPlayers: Number(raw.maxPlayers) || MAX_PLAYERS,
    version: Number(raw.version) || 1,
    status: raw.status || 'lobby',
    createdAt: Number(raw.createdAt) || 0,
  };
}

export function roomExpired(room) {
  return !!room && room.createdAt > 0 && Date.now() - room.createdAt > ROOM_TTL * 1000;
}

export async function createRoom({
  code,
  seed,
  hostPeerId,
  hostName,
  maxPlayers = MAX_PLAYERS,
  version = 1,
}) {
  /* Claim the code first so two simultaneous creates cannot overwrite each
   * other's room. The claim is short-lived; the room hash is the real record. */
  const claimed = await setIfAbsent(claimKey(code), '1', 30);
  if (!claimed) return null;

  const room = {
    code,
    seed: String(seed),
    hostPeerId,
    hostName,
    maxPlayers: String(Math.max(1, Math.min(MAX_PLAYERS, Number(maxPlayers) || MAX_PLAYERS))),
    version: String(version),
    status: 'lobby',
    createdAt: String(Date.now()),
  };
  await hset(roomKey(code), room);
  await expire(roomKey(code), ROOM_TTL);
  await hset(peersKey(code), {
    [hostPeerId]: JSON.stringify({
      id: hostPeerId,
      name: hostName,
      role: 'host',
      joinedAt: Date.now(),
      lastSeen: Date.now(),
    }),
  });
  await expire(peersKey(code), ROOM_TTL);
  await set(aliveKey(code), String(Date.now()), HOST_ALIVE_TTL);
  return getRoom(code);
}

export async function listPeers(code) {
  const raw = await hgetall(peersKey(code));
  if (!raw) return [];
  const out = [];
  for (const value of Object.values(raw)) {
    try {
      const peer = JSON.parse(value);
      if (peer && peer.id) out.push(peer);
    } catch {
      // ignore malformed entries
    }
  }
  return out;
}

/* Presence cleanup: clients refresh lastSeen through the heartbeat route. Host
 * entries are kept by the room TTL. */
export async function prunePeers(code) {
  const peers = await listPeers(code);
  const now = Date.now();
  const stale = [];
  for (const peer of peers) {
    if (peer.role === 'host') continue;
    const seen = Number(peer.lastSeen || peer.joinedAt || 0);
    if (seen && now - seen > PEER_STALE_SECONDS * 1000) stale.push(peer.id);
  }
  if (stale.length) await hdel(peersKey(code), ...stale);
  return stale;
}

export async function addPeer(code, peer) {
  const room = await getRoom(code);
  if (!room) return { ok: false, error: 'room_not_found' };
  await prunePeers(code);
  const peers = await listPeers(code);
  if (peers.length >= room.maxPlayers) return { ok: false, error: 'room_full' };
  const record = {
    ...peer,
    role: peer.role || 'client',
    joinedAt: peer.joinedAt || Date.now(),
    lastSeen: Date.now(),
  };
  await hset(peersKey(code), { [record.id]: JSON.stringify(record) });
  await expire(peersKey(code), ROOM_TTL);
  return { ok: true, room, peers: await listPeers(code) };
}

export async function touchPeer(code, peerId) {
  const peers = await listPeers(code);
  const peer = peers.find((p) => p.id === peerId);
  if (!peer) return false;
  peer.lastSeen = Date.now();
  await hset(peersKey(code), { [peerId]: JSON.stringify(peer) });
  return true;
}

export async function deleteRoom(code) {
  const peers = await listPeers(code);
  await del(
    roomKey(code),
    peersKey(code),
    aliveKey(code),
    claimKey(code),
    ...peers.flatMap((p) => [signalKey(code, p.id), relayKey(code, p.id)])
  );
}

export async function removePeer(code, peerId) {
  await hdel(peersKey(code), peerId);
  await del(signalKey(code, peerId), relayKey(code, peerId));
}

export async function heartbeatRoom(code) {
  const room = await getRoom(code);
  if (!room) return false;
  await set(aliveKey(code), String(Date.now()), HOST_ALIVE_TTL);
  await expire(roomKey(code), ROOM_TTL);
  await expire(peersKey(code), ROOM_TTL);
  return true;
}

export async function hostAlive(code) {
  const v = await get(aliveKey(code));
  return v != null;
}

export async function pushSignal(code, toPeerId, message) {
  const key = signalKey(code, toPeerId);
  await lpush(key, JSON.stringify(message));
  await ltrim(key, 0, MAX_SIGNALS - 1);
  await expire(key, SIGNAL_TTL);
}

/* Drain a mailbox atomically. The previous implementation read the list and
 * then deleted it, which could drop a message pushed in between. LPOP one at a
 * time is race-free, and the chronological order is restored before returning. */
export async function drainSignals(code, peerId) {
  const key = signalKey(code, peerId);
  const out = [];
  for (let i = 0; i < MAX_SIGNALS; i++) {
    const row = await lpop(key);
    if (row == null) break;
    try {
      const msg = JSON.parse(row);
      if (msg && msg.type) out.push(msg);
    } catch {
      // ignore malformed entries
    }
  }
  return out.reverse();
}


/* ------------------------------------------------------------------ *
 * HTTP relay fallback
 *
 * WebRTC is direct and cheap, but it cannot traverse every NAT or firewall
 * without a TURN service. These short-lived mailboxes let the same host/client
 * session keep playing through the app's own HTTP endpoints instead, using no
 * external relay or key. They carry the same channel messages as the data
 * channels, just at HTTP polling rates.
 * ------------------------------------------------------------------ */
export async function pushRelay(code, toPeerId, message) {
  const key = relayKey(code, toPeerId);
  await lpush(key, JSON.stringify(message));
  await ltrim(key, 0, MAX_SIGNALS - 1);
  await expire(key, 60);
}

export async function drainRelay(code, peerId) {
  const key = relayKey(code, peerId);
  const out = [];
  for (let i = 0; i < MAX_SIGNALS; i++) {
    const row = await lpop(key);
    if (row == null) break;
    try {
      const msg = JSON.parse(row);
      if (msg && msg.ch && msg.msg) out.push(msg);
    } catch {
      // ignore malformed entries
    }
  }
  return out.reverse();
}
