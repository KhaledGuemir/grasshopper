import { CHANNEL, MSG, SIGNAL, decode, encode } from './protocol.js';
import { heartbeat, pollSignals, sendSignal } from './signaling.js';

function waitForIce(pc, timeoutMs = 4500) {
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
        disconnectTimer = setTimeout(() => onClose('pc_disconnected'), 10_000);
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
  const pc = new RTCPeerConnection({ iceServers });
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
  const pc = new RTCPeerConnection({ iceServers });
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
  const ch = link.channels[channel];
  if (!ch || ch.readyState !== 'open') return false;
  if (dropIfBusy && ch.bufferedAmount > 256 * 1024) return false;
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
    this.iceServers = iceServers || [{ urls: 'stun:stun.l.google.com:19302' }];
    this.peers = new Map();
    this.pending = new Map();
    this.pollTimer = null;
    this.heartbeatTimer = null;
    this.pollBusy = false;
    this.stopped = false;
    this.startedAt = performance.now();
    this.lastPing = 0;
  }

  async start() {
    if (typeof RTCPeerConnection === 'undefined') {
      throw new Error('webrtc_unsupported');
    }
    if (this.role === 'host') return this.startHost();
    return this.startClient();
  }

  startHost() {
    const poll = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      this.hostPoll();
    };
    /* Slower than the client poll: the host is the long-lived room listener and
       Upstash Free has a monthly command quota. */
    this.pollTimer = setInterval(poll, 1500);
    const beat = () => heartbeat(this.session).catch((err) => this.callbacks.onError?.(err));
    this.heartbeatTimer = setInterval(beat, 30_000);
    beat();
    poll();
    return Promise.resolve();
  }

  async startClient() {
    const poll = () => this.clientPoll();
    this.pollTimer = setInterval(poll, 800);
    poll();
    return Promise.resolve();
  }

  async hostPoll() {
    if (this.stopped || this.pollBusy) return;
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

  async createHostPeer(peerId, name) {
    if (this.pending.has(peerId)) return;
    /* A rejoin arrives for a peer whose old data channel may still be lingering.
       Drop the old connection, then build a fresh offer for the new one. */
    const old = this.peers.get(peerId);
    if (old) {
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
      const onMessage = (channel, msg) => {
        this.callbacks.onPeerMessage?.(peerId, channel, msg);
      };
      const onOpen = () => {
        const peer = this.peers.get(peerId);
        if (!peer) return;
        peer.open = true;
        this.callbacks.onPeerOpen?.(peerId, peer.name, peer.link);
      };
      const onClose = (reason) => this.closePeer(peerId, reason, linkRef);
      const { link, sdp } = await makeHostLink(this.iceServers, onMessage, onOpen, onClose);
      linkRef = link;
      const peer = { id: peerId, name, link, open: false };
      this.pending.delete(peerId);
      this.peers.set(peerId, peer);
      await sendSignal(this.session, peerId, SIGNAL.OFFER, sdp);
    } catch (err) {
      this.pending.delete(peerId);
      this.callbacks.onError?.(err);
      this.callbacks.onPeerClose?.(peerId, name, 'offer_failed');
    }
  }

  async clientPoll() {
    if (this.stopped) return;
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
    if (this.link) return;
    try {
      const onMessage = (channel, m) => this.callbacks.onMessage?.(channel, m);
      const onOpen = () => {
        this.stopPolling();
        this.callbacks.onOpen?.();
      };
      const onClose = (reason) => {
        this.callbacks.onClose?.(reason);
      };
      const { link, sdp } = await makeClientLink(
        this.iceServers,
        msg.data,
        onMessage,
        onOpen,
        onClose
      );
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
        if (peer.open && safeSend(peer.link, channel, msg, dropIfBusy)) any = true;
      }
      return any;
    }
    if (!this.link) return false;
    return safeSend(this.link, channel, msg, dropIfBusy);
  }

  sendTo(peerId, channel, msg, dropIfBusy = false) {
    const peer = this.peers.get(peerId);
    if (!peer || !peer.open) return false;
    return safeSend(peer.link, channel, msg, dropIfBusy);
  }

  broadcast(channel, msg, dropIfBusy = false) {
    return this.send(channel, msg, dropIfBusy);
  }

  stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  closePeer(peerId, reason, expectedLink = null) {
    const peer = this.peers.get(peerId) || this.pending.get(peerId);
    if (expectedLink && peer && peer.link && peer.link !== expectedLink) return;
    this.peers.delete(peerId);
    this.pending.delete(peerId);
    if (peer) {
      try {
        peer.link?.pc?.close();
      } catch {
        // already closed
      }
    }
    this.callbacks.onPeerClose?.(peerId, peer?.name || '', reason);
  }

  stop() {
    this.stopped = true;
    this.stopPolling();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    for (const peerId of Array.from(this.peers.keys())) this.closePeer(peerId, 'session_stopped');
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
    const now = performance.now();
    if (now - this.lastPing < 2000) return;
    this.lastPing = now;
    this.send(CHANNEL.STATE, { t: MSG.PING, at: Math.round(now) }, true);
  }
}
