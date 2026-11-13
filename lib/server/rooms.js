import crypto from 'node:crypto';
import { del, expire, get, hgetall, hset, lpush, lrange, ltrim, set } from './redis.js';

export const ROOM_TTL = 60 * 60 * 2;
export const SIGNAL_TTL = 120;
export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 1;

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function normalizeCode(code) {
  return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export function sanitizeName(name) {
  return String(name || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
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
const signalKey = (code, peerId) => `signal:${code}:${peerId}`;

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

export async function createRoom({ code, seed, hostPeerId, hostName, maxPlayers = MAX_PLAYERS, version = 1 }) {
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
    [hostPeerId]: JSON.stringify({ id: hostPeerId, name: hostName, role: 'host', joinedAt: Date.now() }),
  });
  await expire(peersKey(code), ROOM_TTL);
  await set(aliveKey(code), String(Date.now()), 60);
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

export async function addPeer(code, peer) {
  const room = await getRoom(code);
  if (!room) return { ok: false, error: 'room_not_found' };
  const peers = await listPeers(code);
  if (peers.length >= room.maxPlayers) return { ok: false, error: 'room_full' };
  await hset(peersKey(code), {
    [peer.id]: JSON.stringify({ ...peer, role: peer.role || 'client', joinedAt: Date.now() }),
  });
  await expire(peersKey(code), ROOM_TTL);
  return { ok: true, room, peers: await listPeers(code) };
}

export async function deleteRoom(code) {
  await del(roomKey(code), peersKey(code), aliveKey(code));
}

export async function removePeer(code, peerId) {
  const peers = await listPeers(code);
  if (!peers.some((p) => p.id === peerId)) return;
  const remaining = peers.filter((p) => p.id !== peerId);
  await del(peersKey(code));
  if (remaining.length) {
    const map = {};
    for (const p of remaining) map[p.id] = JSON.stringify(p);
    await hset(peersKey(code), map);
    await expire(peersKey(code), ROOM_TTL);
  }
}

export async function heartbeat(code) {
  await set(aliveKey(code), String(Date.now()), 60);
  await expire(roomKey(code), ROOM_TTL);
  await expire(peersKey(code), ROOM_TTL);
}

export async function hostAlive(code) {
  const v = await get(aliveKey(code));
  return v != null;
}

export async function pushSignal(code, toPeerId, message) {
  const key = signalKey(code, toPeerId);
  await lpush(key, JSON.stringify(message));
  await ltrim(key, 0, 99);
  await expire(key, SIGNAL_TTL);
}

export async function drainSignals(code, peerId) {
  const key = signalKey(code, peerId);
  const rows = await lrange(key, 0, 99);
  if (rows && rows.length) await del(key);
  const out = [];
  for (const row of rows || []) {
    try {
      const msg = JSON.parse(row);
      if (msg && msg.type) out.push(msg);
    } catch {
      // ignore malformed entries
    }
  }
  return out.reverse();
}
