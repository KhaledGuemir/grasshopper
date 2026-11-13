import { CHANNEL, MSG, SIGNAL, decode, encode } from './protocol.js';
import { heartbeat, pollRelay, pollSignals, roomStatus, sendRelay, sendSignal } from './signaling.js';

export const DEFAULT_ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

const POLL_MS = 1500;
const POLL_HIDDEN_MS = 5000;
const CLIENT_POLL_MS = 800;
const RELAY_POLL_MS = 60;
const RELAY_FALLBACK_MS = 9000;
const ICE_TIMEOUT_MS = 4000;
const DISCONNECT_GRACE_MS = 10_000;
const MAX_BUFFERED = 1024 * 1024;

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function waitForIce(pc, timeoutMs = ICE_TIMEOUT_MS) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

function wireLink(link, onChannelMessage, onOpen, onClose) {
  const channels = link.channels;
  let openCount = 0;
  let openFired = false;

  const maybeOpen = () => {
    if (openFired) return;
    if (channels.ctrl?.readyState === 'open' && channels.state?.readyState === 'open') {
      openFired = true;
      onOpen();
    }
  };

  const bind = (label, ch) => {
    channels[label] = ch;
    ch.binaryType = 'arraybuffer';
    ch.onopen = () => {
      openCount++;
      maybeOpen();
    };
    ch.onmessage = (event) => {
      const msg = decode(event.data);
      if (msg) onChannelMessage(label, msg);
    };
    ch.onclose = () => onClose(`channel_${label}_closed`);
    ch.onerror = () => onClose(`channel_${label}_error`);
    if (ch.readyState === 'open') {
      openCount++;
      maybeOpen();
    }
  };

  if (link.ctrl) bind(CHANNEL.CTRL, link.ctrl);
  if (link.state) bind(CHANNEL.STATE, link.state);
  link.bindChannel = bind;
  link.openCount = () => openCount;

  let disconnectTimer = null;
  link.pc.onconnectionstatechange = () => {
    const s = link.pc.connectionState;
    if (s === 'failed' || s === 'closed') {
      if (disconnectTimer) clearTimeout(disconnectTimer);
      onClose(`pc_${s}`);
      return;
    }
    if (s === 'disconnected') {
      if (!disconnectTimer) {
        disconnectTimer = setTimeout(() => onClose('pc_disconnected'), DISCONNECT_GRACE_MS);
      }
      return;
    }
    if (disconnectTimer) {
      clearTimeout(disconnectTimer);
      disconnectTimer = null;
    }
  };
}

async function makeHostLink(iceServers, onMessage, onOpen, onClose) {
  const pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' });
  const link = {
    pc,
    ctrl: pc.createDataChannel(CHANNEL.CTRL, { ordered: true }),
    state: pc.createDataChannel(CHANNEL.STATE, { ordered: false, maxRetransmits: 0 }),
    channels: {},
  };
  wireLink(link, onMessage, onOpen, onClose);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIce(pc);
  return { link, sdp: pc.localDescription };
}

async function makeClientLink(iceServers, offerSdp, onMessage, onOpen, onClose) {
  const pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' });
  const link = { pc, ctrl: null, state: null, channels: {} };
  wireLink(link, onMessage, onOpen, onClose);
  pc.ondatachannel = (event) => {
    const label = event.channel.label;
    if (label === CHANNEL.CTRL || label === CHANNEL.STATE) link.bindChannel(label, event.channel);
  };
  await pc.setRemoteDescription(offerSdp);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitForIce(pc);
  return { link, sdp: pc.localDescription };
}

function safeSend(link, channel, msg, dropIfBusy) {
  if (!link) return false;
  const ch = link.channels[channel];
  if (!ch || ch.readyState !== 'open') return false;
  if (dropIfBusy && ch.bufferedAmount > 256 * 1024) return false;
  if (ch.bufferedAmount > MAX_BUFFERED) return false;
  try {
    ch.send(encode(msg));
    return true;
  } catch {
    return false;
  }
}

export class NetSession {
  constructor({ role, session, callbacks = {}, iceServers }) {
    this.role = role;
    this.session = session;
    this.callbacks = callbacks;
    this.iceServers = iceServers && iceServers.length ? iceServers : DEFAULT_ICE;
    this.peers = new Map();
    this.pending = new Map();
    this.pollTimer = null;
    this.heartbeatTimer = null;
    this.relayTimer = null;
    this.relayPollTimer = null;
    this.relaySweepTimer = null;
    this.relayHelloTimer = null;
    this.relayAlive = false;
    this.relayPollEvery = 0;
    this.roomCheckBusy = false;
    this.lastRoomCheck = 0;
    this.lastStallAt = 0;
    this.watchdogTimer = null;
    this.lastMessageAt = 0;
    this.pollBusy = false;
    this.relayBusy = false;
    this.relayMode = false;
    this.relayFailures = 0;
    this.pendingRelay = 0;
    this.sentMessages = 0;
    this.receivedMessages = 0;
    this.recent = [];
    this.opened = false;
    this.stopped = false;
    this.startedAt = nowMs();
    this.lastPollAt = 0;
    this.lastPing = 0;
    this.rtt = null;
    this.pendingPings = new Map();
    this.heartbeatFailures = 0;
    this.link = null;
    this.hostPeerId = session.hostPeerId || null;
  }

  async start() {
    this.startHeartbeat();
    this.watchdogTimer = setInterval(() => this.checkWatchdog(), 5000);
    if (this.role === 'host') return this.startHost();
    if (typeof RTCPeerConnection === 'undefined') {
      /* The HTTP relay works even without WebRTC. */
      void this.enableRelay('webrtc_unsupported');
      return Promise.resolve();
    }
    return this.startClient();
  }

  startHeartbeat() {
    const every = this.role === 'host' ? 30_000 : 45_000;
    const beat = async () => {
      try {
        await heartbeat(this.session);
        this.heartbeatFailures = 0;
      } catch (err) {
        this.heartbeatFailures++;
        if (this.heartbeatFailures >= 2) this.callbacks.onError?.(err);
      }
    };
    this.heartbeatTimer = setInterval(beat, every);
    beat();
  }

  startHost() {
    this.pollTimer = setInterval(() => this.hostPoll(), POLL_MS);
    this.hostPoll();
    /* Idle relay polling (1/s) lets a client that fell back from WebRTC
     * announce itself without waiting for the slower signaling poll. */
    this.ensureRelayPoll(false);
    return Promise.resolve();
  }

  async startClient() {
    this.pollTimer = setInterval(() => this.clientPoll(), CLIENT_POLL_MS);
    this.clientPoll();
    /* If a direct path cannot be established (symmetric NAT, blocked UDP,
     * restrictive firewall), fall back to the app's own HTTP relay. */
    this.relayTimer = setTimeout(() => {
      if (!this.opened) void this.enableRelay('timeout');
    }, RELAY_FALLBACK_MS);
    return Promise.resolve();
  }

  checkWatchdog() {
    if (this.stopped || !this.opened || this.role !== 'client') return;
    /* Background tabs throttle timers; do not turn that into a reconnect loop. */
    if (typeof document !== 'undefined' && document.hidden) return;
    if (nowMs() - this.lastMessageAt <= 45_000) return;
    void this.checkRoomAlive();
  }

  async checkRoomAlive() {
    if (this.roomCheckBusy || this.stopped) return;
    const now = nowMs();
    if (this.lastRoomCheck && now - this.lastRoomCheck < 30_000) return;
    this.lastRoomCheck = now;
    this.roomCheckBusy = true;
    try {
      const status = await roomStatus(this.session.room);
      if (!status || status.hostAlive === false) {
        this.opened = false;
        this.callbacks.onClose?.('host_unavailable');
      } else if (!this.lastStallAt || now - this.lastStallAt > 30_000) {
        this.lastStallAt = now;
        this.callbacks.onStall?.();
      }
    } catch (err) {
      if (err && (err.code === 'room_not_found' || err.code === 'room_expired')) {
        this.opened = false;
        this.callbacks.onClose?.(err.code);
      }
    } finally {
      this.roomCheckBusy = false;
    }
  }

  fireOpen() {
    if (this.opened) return;
    this.opened = true;
    if (this.relayTimer) {
      clearTimeout(this.relayTimer);
      this.relayTimer = null;
    }
    this.callbacks.onOpen?.();
  }

  ensureRelayPoll(active = false) {
    if (this.stopped) return;
    const anyRelay = this.role === 'host' && Array.from(this.peers.values()).some((p) => p.relay);
    const every = active || anyRelay || this.relayMode ? RELAY_POLL_MS : 1000;
    if (this.relayPollTimer && this.relayPollEvery === every) return;
    if (this.relayPollTimer) clearInterval(this.relayPollTimer);
    this.relayPollEvery = every;
    const tick = () => this.relayPoll();
    this.relayPollTimer = setInterval(tick, every);
    if (!this.relaySweepTimer) {
      this.relaySweepTimer = setInterval(() => this.sweepRelayPeers(), 2000);
    }
    tick();
  }

  sweepRelayPeers() {
    if (this.role !== 'host' || this.stopped) return;
    const now = nowMs();
    for (const peer of Array.from(this.peers.values())) {
      if (peer.relay && now - (peer.lastSeen || 0) > 30_000) {
        this.closePeer(peer.id, 'relay_timeout');
      }
    }
  }

  async relayPoll() {
    if (this.stopped || this.relayBusy) return;
    this.relayBusy = true;
    try {
      const messages = await pollRelay(this.session);
      this.relayFailures = 0;
      this.receivedMessages += messages.length;
      if (messages.length && !this.relayAlive) {
        this.relayAlive = true;
        if (this.relayHelloTimer) {
          clearInterval(this.relayHelloTimer);
          this.relayHelloTimer = null;
        }
      }
      for (const entry of messages) {
        if (this.stopped || !entry || !entry.msg) continue;
        const channel = entry.ch === CHANNEL.CTRL ? CHANNEL.CTRL : CHANNEL.STATE;
        if (this.role === 'host') {
          if (entry.msg.t === 'relay-hello') {
            this.addRelayPeer(entry.from, entry.msg.name || 'Player');
            continue;
          }
          this.routePeerMessage(entry.from, channel, entry.msg);
        } else {
          this.routeMessage(channel, entry.msg);
        }
      }
    } catch (err) {
      const code = err && err.code;
      if (this.role === 'host' && (code === 'room_not_found' || code === 'peer_not_found')) {
        return;
      }
      this.relayFailures++;
      if (this.relayFailures === 6) {
        this.callbacks.onClose?.('relay_failed');
        this.stopRelayPolling();
      } else if (this.relayFailures === 1) {
        this.callbacks.onError?.(err);
      }
    } finally {
      this.relayBusy = false;
    }
  }

  relaySend(peerId, channel, msg, dropIfBusy) {
    if (this.stopped || !peerId) return false;
    if (this.pendingRelay > 40) return false;
    /* Stale input/snapshot traffic is expendable, control traffic is not. */
    if (dropIfBusy && this.pendingRelay > 12) return false;
    this.pendingRelay++;
    this.sentMessages++;
    sendRelay(this.session, peerId, channel, msg)
      .catch((err) => {
        const code = err && err.code;
        if (this.role === 'host' && (code === 'room_not_found' || code === 'peer_not_found')) return;
        if (this.relayFailures < 3) this.callbacks.onError?.(err);
      })
      .finally(() => {
        this.pendingRelay = Math.max(0, this.pendingRelay - 1);
      });
    return true;
  }

  async enableRelay(reason) {
    if (this.role !== 'client' || this.relayMode || this.stopped) return;
    this.relayMode = true;
    this.opened = false;
    if (this.relayTimer) {
      clearTimeout(this.relayTimer);
      this.relayTimer = null;
    }
    this.stopPolling();
    if (this.link) {
      try {
        this.link.pc.close();
      } catch {
        // already closed
      }
      this.link = null;
    }
    this.ensureRelayPoll(true);
    this.callbacks.onTransport?.('relay', reason);
    const hello = () =>
      sendSignal(this.session, this.hostPeerId || this.session.hostPeerId, SIGNAL.RELAY, {
        name: this.session.name || 'Player',
      }).catch((err) => this.callbacks.onError?.(err));
    void hello();
    /* Also announce through the fast relay mailbox; this works even if the
     * host's signaling poll is throttled by a background tab. */
    this.relaySend(
      this.hostPeerId || this.session.hostPeerId,
      CHANNEL.CTRL,
      { t: 'relay-hello', name: this.session.name || 'Player' },
      false
    );
    /* Retry the hello in case the host's poll was asleep; stop once any relay
     * traffic comes back. */
    if (!this.relayHelloTimer) {
      this.relayHelloTimer = setInterval(() => {
        if (this.relayAlive || this.stopped) {
          clearInterval(this.relayHelloTimer);
          this.relayHelloTimer = null;
          return;
        }
        void hello();
      }, 3000);
    }
    this.fireOpen();
  }

  routePeerMessage(peerId, channel, msg) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.lastSeen = nowMs();
    this.lastMessageAt = nowMs();
    this.recent.push(msg.t);
    if (this.recent.length > 12) this.recent.shift();
    if (msg.t === MSG.PONG) {
      this.notePong(msg.at, peerId);
      return;
    }
    if (msg.t === MSG.BYE) {
      this.closePeer(peerId, 'peer_bye');
      return;
    }
    this.callbacks.onPeerMessage?.(peerId, channel, msg);
  }

  routeMessage(channel, msg) {
    this.lastMessageAt = nowMs();
    this.recent.push(msg.t);
    if (this.recent.length > 12) this.recent.shift();
    if (msg.t === MSG.PONG) {
      this.notePong(msg.at, null);
      return;
    }
    this.callbacks.onMessage?.(channel, msg);
  }

  notePong(at, peerId) {
    const sent = Number(at);
    if (!Number.isFinite(sent)) return;
    const rtt = Math.max(0, Math.round(nowMs() - sent));
    this.pendingPings.delete(sent);
    this.rtt = this.rtt == null ? rtt : Math.round(this.rtt * 0.7 + rtt * 0.3);
    if (peerId) {
      const peer = this.peers.get(peerId);
      if (peer) peer.rtt = rtt;
    }
    this.callbacks.onPing?.(this.rtt);
  }

  async hostPoll() {
    if (this.stopped || this.pollBusy) return;
    /* Never skip polling entirely while hidden: new players should still be
     * able to join a host that tabbed away. Slow it down instead. */
    const hidden = typeof document !== 'undefined' && document.hidden;
    if (hidden && nowMs() - this.lastPollAt < POLL_HIDDEN_MS) return;
    this.lastPollAt = nowMs();
    this.pollBusy = true;
    try {
      const messages = await pollSignals(this.session);
      for (const msg of messages) await this.onHostSignal(msg);
    } catch (err) {
      this.callbacks.onError?.(err);
    } finally {
      this.pollBusy = false;
    }
  }

  async onHostSignal(msg) {
    if (!msg || !msg.from) return;
    if (msg.type === SIGNAL.JOIN) {
      void this.createHostPeer(msg.from, msg.data?.name || 'Player');
      return;
    }
    if (msg.type === SIGNAL.RELAY) {
      this.addRelayPeer(msg.from, msg.data?.name || 'Player');
      return;
    }
    const peer = this.peers.get(msg.from) || this.pending.get(msg.from);
    if (!peer) return;
    if (msg.type === SIGNAL.ANSWER) {
      try {
        await peer.link.pc.setRemoteDescription(msg.data);
      } catch (err) {
        this.callbacks.onError?.(err);
      }
      return;
    }
    if (msg.type === SIGNAL.ICE && msg.data) {
      try {
        await peer.link.pc.addIceCandidate(msg.data);
      } catch {
        // candidates can arrive after the connection has moved on
      }
      return;
    }
    if (msg.type === SIGNAL.LEAVE) this.closePeer(msg.from, 'peer_left');
  }

  addRelayPeer(peerId, name) {
    let peer = this.peers.get(peerId);
    const fresh = !peer || !peer.relay || !peer.open;
    if (!peer) {
      peer = { id: peerId, name, link: null, open: true, relay: true, rtt: null, lastSeen: nowMs() };
      this.peers.set(peerId, peer);
    } else {
      peer.relay = true;
      peer.open = true;
      peer.name = name || peer.name;
    }
    this.pending.delete(peerId);
    this.ensureRelayPoll(true);
    if (fresh) this.callbacks.onPeerOpen?.(peerId, peer.name, null);
  }

  async createHostPeer(peerId, name) {
    if (this.pending.has(peerId)) return;
    /* A rejoin arrives for a peer whose old data channel may still be lingering.
       Drop the old connection, then build a fresh offer for the new one. */
    const old = this.peers.get(peerId);
    if (old && !old.relay) {
      this.peers.delete(peerId);
      try {
        old.link?.pc?.close();
      } catch {
        // already closed
      }
    }
    this.pending.set(peerId, { id: peerId, name });
    try {
      let linkRef = null;
      const onMessage = (channel, msg) => this.routePeerMessage(peerId, channel, msg);
      const onOpen = () => {
        const peer = this.peers.get(peerId);
        if (!peer || peer.relay) return;
        peer.open = true;
        this.callbacks.onPeerOpen?.(peerId, peer.name, peer.link);
      };
      const onClose = (reason) => this.closePeer(peerId, reason, linkRef);
      const { link, sdp } = await makeHostLink(this.iceServers, onMessage, onOpen, onClose);
      linkRef = link;
      const existing = this.peers.get(peerId);
      if (existing && existing.relay) {
        try {
          link.pc.close();
        } catch {
          // already closed
        }
        this.pending.delete(peerId);
        return;
      }
      const peer = { id: peerId, name, link, open: false, relay: false, rtt: null };
      this.pending.delete(peerId);
      this.peers.set(peerId, peer);
      await sendSignal(this.session, peerId, SIGNAL.OFFER, sdp);
    } catch (err) {
      this.pending.delete(peerId);
      this.callbacks.onError?.(err);
      if (!this.peers.get(peerId)?.relay) {
        this.callbacks.onPeerClose?.(peerId, name, 'offer_failed');
      }
    }
  }

  async clientPoll() {
    if (this.stopped || this.link || this.relayMode) return;
    try {
      const messages = await pollSignals(this.session);
      for (const msg of messages) {
        if (this.stopped) return;
        if (msg.type === SIGNAL.OFFER) {
          await this.acceptOffer(msg);
          return;
        }
        if (msg.type === SIGNAL.ERROR) {
          this.callbacks.onError?.(new Error(msg.data?.message || 'signal_error'));
        }
      }
    } catch (err) {
      this.callbacks.onError?.(err);
    }
  }

  async acceptOffer(msg) {
    if (this.link || this.relayMode) return;
    try {
      const onMessage = (channel, m) => this.routeMessage(channel, m);
      const onOpen = () => {
        this.stopPolling();
        this.fireOpen();
      };
      const onClose = (reason) => {
        /* The relay fallback may already be carrying the session. A late
         * WebRTC failure must not mark that working session as closed. */
        if (this.relayMode) {
          this.link = null;
          return;
        }
        this.opened = false;
        this.stopPolling();
        this.callbacks.onClose?.(reason);
        void this.enableRelay(reason);
      };
      const { link, sdp } = await makeClientLink(this.iceServers, msg.data, onMessage, onOpen, onClose);
      if (this.relayMode || this.stopped) {
        try {
          link.pc.close();
        } catch {
          // already closed
        }
        return;
      }
      this.link = link;
      this.hostPeerId = msg.from;
      await sendSignal(this.session, msg.from, SIGNAL.ANSWER, sdp);
    } catch (err) {
      this.callbacks.onError?.(err);
    }
  }

  send(channel, msg, dropIfBusy = false) {
    if (this.role === 'host') {
      let any = false;
      for (const peer of this.peers.values()) {
        if (!peer.open) continue;
        if (peer.relay) {
          if (this.relaySend(peer.id, channel, msg, dropIfBusy)) any = true;
        } else if (safeSend(peer.link, channel, msg, dropIfBusy)) {
          any = true;
        }
      }
      return any;
    }
    if (this.relayMode) return this.relaySend(this.hostPeerId, channel, msg, dropIfBusy);
    return safeSend(this.link, channel, msg, dropIfBusy);
  }

  sendTo(peerId, channel, msg, dropIfBusy = false) {
    const peer = this.peers.get(peerId);
    if (!peer || !peer.open) return false;
    if (peer.relay) return this.relaySend(peerId, channel, msg, dropIfBusy);
    return safeSend(peer.link, channel, msg, dropIfBusy);
  }

  broadcast(channel, msg, dropIfBusy = false) {
    return this.send(channel, msg, dropIfBusy);
  }

  stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  stopRelayPolling() {
    if (this.relayPollTimer) clearInterval(this.relayPollTimer);
    this.relayPollTimer = null;
    if (this.relaySweepTimer) clearInterval(this.relaySweepTimer);
    this.relaySweepTimer = null;
  }

  closePeer(peerId, reason, expectedLink = null) {
    const peer = this.peers.get(peerId) || this.pending.get(peerId);
    if (!peer) return;
    /* A relay client also had a WebRTC attempt. When that attempt dies, keep
     * the working relay peer instead of dropping the player. */
    if (peer.relay && expectedLink) {
      /* The relay peer is the working session; a WebRTC link failure is just
       * stale bookkeeping. */
      peer.link = null;
      return;
    }
    this.peers.delete(peerId);
    this.pending.delete(peerId);
    try {
      peer.link?.pc?.close();
    } catch {
      // already closed
    }
    this.callbacks.onPeerClose?.(peerId, peer.name || '', reason);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.stopPolling();
    this.stopRelayPolling();
    if (this.relayTimer) clearTimeout(this.relayTimer);
    this.relayTimer = null;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
    if (this.relayHelloTimer) clearInterval(this.relayHelloTimer);
    this.relayHelloTimer = null;
    for (const peerId of Array.from(this.peers.keys())) this.closePeer(peerId, 'session_stopped');
    for (const peerId of Array.from(this.pending.keys())) this.closePeer(peerId, 'session_stopped');
    if (this.link) {
      try {
        this.link.pc.close();
      } catch {
        // already closed
      }
      this.link = null;
    }
  }

  ping() {
    const now = nowMs();
    if (now - this.lastPing < 2000) return;
    this.lastPing = now;
    const at = Math.round(now);
    this.pendingPings.set(at, now);
    this.send(CHANNEL.STATE, { t: MSG.PING, at }, true);
  }
}
