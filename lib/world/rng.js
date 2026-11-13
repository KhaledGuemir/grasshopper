/* Deterministic pseudo-random numbers for world generation.
 *
 * The same seed must produce the same world on every peer. mulberry32 is small,
 * fast, and has enough quality for placement/scatter decisions.
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function seedFromRoom(code) {
  return hashString(String(code || 'solo').toUpperCase()) || 1;
}

export function randomSeed() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    return crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  }
  return (Math.random() * 0xffffffff) >>> 0 || 1;
}

function fnv1a(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/* Hash the static world, not the live NPC state. Positions are quantized to
 * centimetres so tiny float differences between browsers cannot cause a
 * false mismatch. */
export function worldChecksum(solids, chests, homes) {
  const rows = [];
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    const x = Number(s.x) || 0;
    const z = Number(s.z) || 0;
    const r = Number(s.r) || 0;
    const w = Number(s.w) || 0;
    const d = Number(s.d) || 0;
    const yaw = Number(s.yaw) || 0;
    rows.push(`s:${w ? 'w' : 'r'}:${x.toFixed(2)}:${z.toFixed(2)}:${r.toFixed(2)}:${w.toFixed(2)}:${d.toFixed(2)}:${yaw.toFixed(2)}`);
  }
  for (let i = 0; i < chests.length; i++) {
    const g = chests[i].g.position;
    rows.push(`c:${(Number(g.x) || 0).toFixed(2)}:${(Number(g.z) || 0).toFixed(2)}`);
  }
  for (let i = 0; i < (homes || []).length; i++) {
    const h = homes[i];
    rows.push(`h:${(Number(h.x) || 0).toFixed(2)}:${(Number(h.z) || 0).toFixed(2)}:${(Number(h.r) || 0).toFixed(2)}`);
  }
  rows.sort();
  return fnv1a(rows.join('|'));
}
