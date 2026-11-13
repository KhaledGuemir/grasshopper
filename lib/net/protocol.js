export const PROTOCOL_VERSION = 1;

export const INPUT = {
  JUMP: 1,
  SPRINT: 2,
  FIRE: 4,
  USE: 8,
};

export const SIGNAL = {
  JOIN: 'join',
  OFFER: 'offer',
  ANSWER: 'answer',
  ICE: 'ice',
  READY: 'ready',
  LEAVE: 'leave',
  ERROR: 'error',
};

export const CHANNEL = {
  CTRL: 'ctrl',
  STATE: 'state',
};

export const MSG = {
  WELCOME: 'welcome',
  INPUT: 'input',
  CMD: 'cmd',
  SNAP: 'snap',
  EV: 'ev',
  CHAT: 'chat',
  PING: 'ping',
  PONG: 'pong',
  READY: 'ready',
  BYE: 'bye',
};

export function encode(msg) {
  return JSON.stringify(msg);
}

export function decode(data) {
  if (typeof data !== 'string') return null;
  try {
    const msg = JSON.parse(data);
    return msg && typeof msg.t === 'string' ? msg : null;
  } catch {
    return null;
  }
}
