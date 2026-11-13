export const SESSION_KEY = 'gh-mp-session';

export function loadSession() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.room || !s.token || !s.peerId) return null;
    if (s.role !== 'host' && s.role !== 'client') return null;
    return s;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(SESSION_KEY);
}

export function markSessionRejoin() {
  if (typeof window === 'undefined') return;
  const s = loadSession();
  if (!s) return;
  s.rejoin = true;
  saveSession(s);
}

export function readBootConfig() {
  if (typeof window === 'undefined') return null;
  const q = new URLSearchParams(window.location.search);
  const wantsMp = q.get('mp') === '1';
  const session = loadSession();
  if (!wantsMp || !session) return null;
  return session;
}

export function readSeedFromUrl() {
  if (typeof window === 'undefined') return null;
  const v = new URLSearchParams(window.location.search).get('seed');
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n >>> 0 : null;
}
