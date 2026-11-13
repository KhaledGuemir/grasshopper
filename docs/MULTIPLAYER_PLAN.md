# Multiplayer Plan — Grasshopper Pasture (Vercel Edition)

**Baseline:** `nextversion` @ `6079e27` (pulled 2026-11-13)
**Deployment target:** the existing Next.js app on **Vercel** — no custom Node server, no second
long-lived game server
**Scope:** 2–8 player private co-op, shared world, PvE
**Status:** working Vercel co-op vertical slice implemented; carry/ride/loot ownership and host migration remain

### Implementation status (2026-11-13)

- [x] Deterministic seeded world + `worldChecksum`.
- [x] Vercel API routes for create/join/heartbeat/signal/TURN/health.
- [x] Redis store with a local in-memory fallback; HMAC room tokens.
- [x] WebRTC host/client transport with `ctrl` and `state` data channels.
- [x] Lobby UI, room codes, session persistence, auto-connect after reload.
- [x] Remote player avatars, input relay, host simulation, player snapshots.
- [x] Entity IDs and host snapshots for cows, bulls, hoppers, pets, people, props, meat, chests.
- [x] Client-side punch/shoot commands with host range validation and death replication.
- [x] Room code, invite link, QR code and invite-link auto-fill.
- [x] Host polling backoff, hidden-tab pause, 2-hour room expiry and close-room flow.
- [x] STUN-only default; no paid TURN service configured.
- [x] Two-tab headless Chrome WebRTC smoke test: invite/QR, checksum, channels, movement, rejoin.
- [x] Client reload rejoin/reconnect while the host room is alive.
- [ ] Shared chest looting, carry, ride, HP/hunger ownership, host migration.
- [x] Zero-config production hardening: in-process store with TTLs, no known dev signing key,
      request-size/rate limits, atomic mailbox drain, presence cleanup, reconnect with backoff.
- [x] Free HTTP relay fallback (`/api/relay`) used automatically when WebRTC cannot connect,
      so restrictive NAT/firewalls still work without TURN or any external key.
- [x] Self-host packaging (Docker/compose, optional coturn) and zero-config docs.
- [ ] Real-device/internet playtest and free-tier usage check.

`npm test` covers the RNG/world checksum and the room/signal API flow. `npm run test:browser`
launches two Chrome tabs against the dev server and verifies the WebRTC connection, matching world
checksums and remote movement. `next build` passes end-to-end (the Next page-data workers need full
process access; the restricted sandbox reports `spawn EPERM`). The dev server was smoke-tested
against `GET /api/health`, room create/join, signaling, TURN and leave.

---

## 1. The Vercel constraint

The project is deployed as a standard Next.js app on Vercel. That rules out the usual
"WebSocket relay server" design unless we add infrastructure outside Vercel.

What Vercel gives us today:

- Standard `next build` / Vercel Functions, with request-scoped execution.
- Native WebSocket support in Vercel Functions (GA October 20, 2026), but each connection is a
  Function invocation pinned to **one instance**. New connections are not guaranteed to land on the
  same instance, there is no built-in fan-out, presence, or cross-instance ordering, and the
  connection closes when the Function hits its maximum duration. Vercel's own guidance is to keep
  rooms, presence and pub/sub state in an external store.
- Vercel Marketplace Redis (Upstash) for small, short-lived state.

That means a 30–60 minute game room cannot rely on a Vercel Function as its relay:

- A room's players may be connected to different Function instances, so a simple in-memory
  broadcast loop does not work.
- Every connection dies at the Function duration limit and must reconnect.
- A game sends 10–30 messages per second per player; keeping that inside Function invocations is
  expensive and fragile compared with a direct connection.

**So this plan moves gameplay traffic off Vercel and keeps Vercel for what it is good at:
serving the app, creating/joining rooms, and WebRTC signaling.**

### The resulting shape

```
        Host browser (authoritative game simulation)
          /                 |                 \
   WebRTC data         WebRTC data        WebRTC data
   channel             channel            channel
      /                   |                   \
 Client A              Client B             Client C

        HTTPS only while joining / reconnecting:
 Host ──► Vercel Function ──► Redis mailbox ◄── Vercel Function ◄── Client
```

- **Gameplay:** direct WebRTC data channels between the host and each client. Vercel is not in the
  snapshot/input path.
- **Lobby and signaling:** Vercel API routes + Redis. Small JSON messages, only during join and
  reconnect.
- **NAT traversal:** public STUN only in the free-tier profile. There is **no paid TURN service**.
  Same-Wi-Fi and many home networks connect directly; symmetric NAT, corporate/school firewalls and
  some mobile carriers can fail. That is an accepted limitation, with same-Wi-Fi/Tailscale fallback.

This is the design that best fits Vercel **and** the no-paid-service constraint.

Vercel cannot host TURN, and this project deliberately does not configure one. Redis is used only
for room/signaling state; gameplay is direct WebRTC. A future optional free, hard-capped TURN tier
could be added later, but it is not part of this plan.

### What "Vercel-compliant" means here

| Requirement | How this plan meets it |
| --- | --- |
| No custom server | Standard `next build`; no `server.mjs`, no `next start` sidecar |
| No long-lived Vercel Function | WebRTC carries gameplay; API routes are short request/response |
| No server-side game loop | Host browser owns the simulation (same as the previous listen-server plan) |
| Persistent room metadata | Redis with TTL, accessed through short API calls |
| Works on Preview and Production | Same-origin API routes; environment-specific Redis config; STUN-only |
| HTTPS / secure context | Vercel provides HTTPS; WebRTC requires it |

The trade-off is explicit: **the host's browser is the server.** If the host closes the tab, the
room ends in v1. That is acceptable for private co-op; a dedicated authoritative server is the
upgrade path if that becomes unacceptable.

---

## 2. Baseline after the pull

What changed:

- Fast-forwarded `5af4af1..6079e27` (merge of PR #1, "expand admin sandbox and secure F2 code entry").
- `lib/game.js` grew by ~854 lines and `components/Game.js` changed its admin/cheat UI.
- `package.json` asks for **Next.js `^16.4.6`**, and the README has been updated to match.
- Lockfile resolves **Next 16.4.6 / React 19.3.1 / three 0.128.0**. `node_modules` was synced.
- `npm run build` compiles with Next 16 (Turbopack); it then stops at "Collecting page data" with
  `spawn EPERM` because this session's Windows sandbox blocks the child process Next uses there.
  That is an environment restriction, not a compile error; re-run the build outside the sandbox
  before calling the baseline green.

The working tree is clean apart from this document.

---

## 3. Why multiplayer is not a small add-on

The game is a single-player prototype built around one global player and one render/simulation loop:

| Area | Current implementation | Consequence |
| --- | --- | --- |
| Entry point | One `start()` closure in `lib/game.js` (~4,600 lines) | No boundary between simulation, rendering and UI |
| Player | Global `P`, referenced ~549 times; global `yaw` / `pitch` | Every action assumes exactly one player |
| World generation | Runs at boot with `Math.random` (64 uses) | Two browsers generate different worlds |
| Simulation | `update()` moves the local player **and** all NPCs | A network client cannot run "only my player" |
| Entities | Untyped objects in arrays, no IDs | Cannot reference the same cow across peers |
| Interactions | Direct calls (`punch()`, `shoot()`, `openChest()`) | No command/validation boundary |
| Admin | F2 code hashes live in the client bundle | Not a multiplayer permission system |
| Deployment | Next.js on Vercel | No always-on process for a relay or game loop |

The plan fixes four root problems first: **deterministic world**, **actor model**, **stable IDs +
snapshots**, and **an authority model**. The Vercel work then replaces "relay server" with
"WebRTC signaling only".

---

## 4. Goal and non-goals

### Goal (v1)

- Two to eight players join a private room by code.
- Everyone sees the same static world and the same moving creatures.
- Players see each other as third-person avatars with name tags and carry/ride poses.
- Shared actions work: punch/shoot, kill, meat, open a chest once, mount, carry, get hurt,
  die/respawn.
- Day/night and tornadoes are shared.
- A client can reconnect within a short grace period by re-signaling.
- Solo mode keeps working exactly as it does today.
- The whole thing deploys with the existing Vercel project; no separate game server to operate.

### Non-goals (v1)

- PvP and friendly fire.
- Public matchmaking / MMO-scale sharding.
- Persistent accounts, inventories, or cross-session progression.
- Host migration. If the host leaves, the room ends cleanly.
- Voice chat (use Discord); text chat is enough.
- Anti-cheat against a determined attacker.

---

## 5. Recommended architecture: WebRTC star, host-authoritative

One player is the **host**. Their browser runs the authoritative simulation. Every other player is
a **client** connected to the host by a WebRTC data channel. Clients send inputs and commands
directly to the host; the host sends each client the entities that client should see.

The host makes one `RTCPeerConnection` per client. This is a **star**, not a mesh: clients never talk
to each other, which keeps authority simple and bandwidth predictable.

### Authority split

| State | Authority | Transport |
| --- | --- | --- |
| Own player position / look | Client prediction, host sanity-checks bounds | `input` over WebRTC, 20–30 Hz |
| Other players | Host (applies their inputs) | snapshots over WebRTC |
| NPC position / state / death | Host | snapshots over WebRTC |
| Chest opened, meat, loot | Host | events + snapshots |
| Held / ridden entity | Host | snapshot fields |
| Player HP / hunger / inventory | Host for damage and pickups; client displays | events + own-state messages |
| Day/night, tornado | Host | snapshot/event |
| Room create/join, presence in lobby | Vercel API + Redis | HTTPS |
| WebRTC handshake | Vercel API + Redis mailboxes | HTTPS polling |
| Admin powers | Vercel-issued role token; host enforces it, never the client hash | Token at join + host validation |

### Why this fits Vercel

- No Vercel Function stays open during gameplay.
- Snapshots and inputs never consume Function invocations or egress through Vercel.
- Redis only holds tiny room and signaling records with TTL; it is not a game-state database.
- The Next.js app remains a normal Vercel deployment, including Preview deployments.
- The host is already the authoritative simulation in the listen-server design, so the netcode work
  from the previous plan is unchanged; only the transport changes.

### Alternatives considered

| Option | Vercel-only? | Verdict |
| --- | --- | --- |
| **WebRTC star + Vercel signaling** | Vercel app + free Redis + public STUN | **Recommended.** Direct gameplay, no paid relay, lowest latency. |
| Vercel native WebSockets + Redis pub/sub relay | Vercel app + Marketplace Redis | Possible, but sockets are pinned to instances, close at Function duration, need external fan-out and reconnect every few minutes. Too much machinery for a game room. |
| Managed realtime relay (Ably, Pusher, Supabase Realtime, PartyKit) | Vercel app + external service | Good fallback if WebRTC/TURN proves unreliable. Host authority and snapshots still apply. |
| Dedicated WebSocket server on Fly/Railway/VPS | No | Best for public/PvP and host migration, but violates the "Vercel only" requirement. |

---

## 6. Networking model and budgets

### Data channels

Create two channels per peer:

| Channel | Settings | Carries |
| --- | --- | --- |
| `ctrl` | ordered, reliable | join/welcome, commands, chat, events, respawn |
| `state` | unordered, `maxRetransmits: 0` | inputs, snapshots, pings |

`state` is allowed to drop old packets; a newer snapshot supersedes an older one. `ctrl` carries
anything that must not be lost (chest opened, kill, chat).

### Rates and budgets

| Item | Target |
| --- | --- |
| Host simulation tick | 20–30 Hz fixed step |
| Client input send rate | 20–30 Hz |
| Snapshot rate | 12–15 Hz per client |
| Interpolation buffer | 100–150 ms |
| Interest radius | ~220 m (matches the current AI sleep gate) |
| Entities per snapshot | 40–80 typical, hard cap 150 |
| Snapshot payload | ~1–5 KB JSON with interest management |
| Host upload | ~30–60 KB/s per client; 8 players ≈ 2–4 Mbps total |
| Client upload | < 5 KB/s (inputs/commands) |
| Playable latency | < 150 ms; host advantage acceptable |
| Room size | 8 default, 4 recommended on low-end mobile |

Practical rules:

- Start with JSON over data channels; move to binary (`ArrayBuffer` + `DataView`) only if profiling
  shows a problem.
- Round positions to centimetres and angles to 1e-3 before serializing.
- Drop snapshots older than the last applied tick.
- Check `dataChannel.bufferedAmount`; if it is above ~256 KB, skip a snapshot instead of queueing.
- Keep the WebRTC message under ~16 KB to stay well inside SCTP limits. If a full snapshot exceeds
  that, split it into chunks with a snapshot ID.

### Signaling is not gameplay

Signaling only runs while a peer is joining or reconnecting. After both data channels open, clients
stop polling. A reconnect requires a new `RTCPeerConnection` and a new exchange, but the host keeps
the player's state for a grace period.

---

## 7. Work plan

Estimates assume one developer familiar with the codebase, full-time. Phases 0–4 produce a playable
two-player vertical slice.

### Phase 0 — Baseline and Vercel guardrails (0.5–1 day)

- Create `feat/multiplayer` from `nextversion`.
- Sync dependencies and confirm a production build outside the sandbox.
- ~~Fix the README's Next.js version (15 → 16).~~ Done in the implementation pass.
- Add `@upstash/redis` (Vercel Marketplace Redis/Upstash).
- Add a feature flag: `NEXT_PUBLIC_MULTIPLAYER=1` (solo remains the default path).
- Add a `GET /api/health` route that reports `{ ok, redis, version }` without exposing secrets.
- Confirm the existing app deploys unchanged to a Vercel Preview.

**Acceptance:** solo game boots and plays exactly as before; Preview deployment is green; no custom
server or `server/` folder is introduced.

### Phase 1 — Deterministic shared world (2–3 days)

This is the foundation. Without it, peers stand in different worlds.

- Add `lib/world/rng.js`:
  - `mulberry32(seed)`.
  - `hashString(text)` for deriving a numeric seed from a room code.
  - Helpers: `rndRange`, `rndInt`, `pick`.
- Introduce two RNG streams:
  - **`worldRng`** — static generation only, consumed in a fixed order.
  - **runtime RNG** — particles/AI variation; may stay non-deterministic.
- Read the seed from the room record. For solo, use a random seed or `?seed=`.
- A seed is fixed for the page session: joining a different room reloads the page in v1 (the static
  scene is built once at boot).
- Replace `Math.random` / top-level `rnd` in every **static generation** path:
  - `grassTex()`, `biomeTex()`
  - `buildWorldGeometry()` (trees, colliders)
  - `buildWater()`
  - `buildBiomeProps()` (cacti, pines, drifts)
  - `buildMountains()`
  - `buildBuildings()` (houses, skyscrapers, villages, `solids`)
  - `buildHills()`
  - `scatterChests()` / `villageChestSpot()`
  - initial `spawnProp`, `spawnPet`, `spawnCow`, `spawnBull`, `spawnHopper`, `spawnPerson` calls
    made during the four `initWorldAsync` steps
- Add `worldChecksum()`: record a manifest of `(kind, x, z, rotation)` during generation, quantize
  positions to centimetres, sort, and hash it. Show it on the loading screen.
- Keep the `initWorldAsync` step order fixed; do not parallelize generation.

**Acceptance:** two tabs with the same seed print the same checksum; changing the seed changes it;
solo still works. Add a unit test for the RNG and checksum.

### Phase 2 — Vercel signaling, WebRTC handshake, lobby, presence (4–5 days)

This replaces the relay-server approach from the earlier draft.

**Vercel API routes**

- `POST /api/rooms` — create a room.
  - body: `{ name, maxPlayers }`
  - generates a unique 6-character code (retry on collision) and a `crypto.randomInt` seed
  - stores the room in Redis with a TTL (2 hours)
  - returns `{ code, seed, peerId, token }`
- `POST /api/rooms/join` — join a room.
  - body: `{ code, name }`
  - validates room exists, has space, and version matches
  - reserves a peer ID and pushes a `join` signal into the host's Redis mailbox
  - returns `{ peerId, token, seed, hostPeerId, players }`
- `GET /api/rooms/[code]` — lobby status (optional, for "room full / not found" UX).
- `POST /api/rooms/heartbeat` — host refreshes the room TTL every 30 s.
- `POST /api/rooms/leave` — remove a peer; a host leaving deletes the room.
- `POST /api/signal` — post an offer/answer/ICE/leave message to a peer mailbox.
- `GET /api/signal?room&peer&after` — drain messages for a peer using a cursor.
- `POST /api/turn` — return STUN servers for a valid room token. The default deployment has no TURN;
  leave `TURN_*` unset so no paid relay can be introduced by accident.

All routes:

- `export const dynamic = 'force-dynamic'`
- `Cache-Control: no-store`
- Node.js runtime (Redis REST client works on Edge too, but Node keeps crypto/validation simple)
- request size limits and per-IP rate limits

**Redis layout**

| Key | Type | TTL | Contents |
| --- | --- | --- | --- |
| `room:{CODE}` | hash | 2 h | `seed`, `hostPeerId`, `hostName`, `maxPlayers`, `createdAt`, `version`, `status` |
| `room:{CODE}:peers` | hash | 2 h | `peerId -> { name, role, joinedAt }` |
| `room:{CODE}:hostAlive` | string | 60 s | host heartbeat timestamp |
| `signal:{CODE}:{peerId}` | stream/list | 2 min | `{ id, from, type, data, ts }` |

A Redis stream is preferred for `after`-cursor reads; a list with an incrementing ID is acceptable
for v1. Each peer only reads its own mailbox.

**WebRTC handshake**

1. Host polls `GET /api/signal` and sees a `join` from a client.
2. Host creates an `RTCPeerConnection`, adds `ctrl` and `state` data channels, creates an offer, and
   posts it to the client's mailbox.
3. Client polls, applies the offer, creates an answer, and posts it back. ICE candidates trickle both
   ways through the same mailboxes. Queue remote ICE candidates until the remote description is set;
   do not drop them on early arrival.
4. When both channels open, host sends `welcome` with the room/player state. The client generates the
   world from the seed, then sends `ready`; the host waits for every peer to be ready before the
   countdown. Signaling polling stops once the channels are open.

**Lobby UI in `components/Game.js`**

- Name field, "Host room", "Join room" (code), player list.
- Connection status, ping, host badge, "copy code".
- Room full / wrong version / host left errors.
- Browser support check: `RTCPeerConnection`, `createDataChannel`, secure context.
- A "Connecting…" state with a cancel button; do not lock the pointer until the data channel is open.
- Text chat: `T` or `Enter` opens, releases pointer lock, suppresses game keys, `Esc` closes.

**Remote avatar**

- Reuse the person body proportions or a simple humanoid builder.
- Name tag as a `THREE.Sprite` with a canvas texture.
- Walk animation driven by speed; later add held/ride poses.

**Acceptance:** two browsers join the same code through a Vercel Preview, see each other move, chat,
and leave cleanly. Works on a normal home NAT with STUN; restrictive NATs fail and are reported.

### Phase 3 — Player movement netcode (3–4 days)

- Extract the local-movement block from `update()` (the `state === 'play'` section around `P.lift` /
  `P.ride` / `flying` / walking) into `stepActor(actor, input, dt)`.
- Run the host simulation on a fixed-step accumulator (30 Hz) and render at the browser's rate.
  Keep a monotonically increasing `simTime` for AI/animations instead of the render `clock`.
- Actor shape:

  ```js
  {
    id, name, isHost, isLocal,
    x, z, baseY, jy, jv, kx, kz, fl, bump,
    yaw, pitch, walkT, inW, sw, floor, tower, lift,
    holdingId, rideId, hp, hunger, found,
    guns: { armed, weapon, ammo, cooldown, infAmmo },
    sword, dead
  }
  ```

- Local player becomes `actors.local`, with `P` kept as an alias during the migration.
- Assign staggered spawn points around `(0, 6)` by join slot, then resolve overlaps with
  `pushFrom` / `pushOut`.
- Input packet: `{ seq, ax, ay, yaw, pitch, btn }` where `btn` is a bitmask
  (`JUMP=1, SPRINT=2, FIRE=4, USE=8`).
- Client prediction:
  - Apply local input immediately against static collision.
  - Host applies the same input to the remote proxy actor and includes the last processed `seq` in
    snapshots.
  - Soft-correct if the client drifts more than ~0.75 m over ~150 ms.
  - Hard-snap only on teleport/respawn.
- Reuse `pushOut`, `pushFrom`, `boundPlayer`, tower/lift logic. Pass the actor instead of reading
  globals.
- Remote proxies on the host need no rendering; they need position, collision and action state.

**Acceptance:** two players move at 100 ms simulated latency without visible rubber-banding; both
see correct collisions at buildings, lakes and tower lifts; host and client agree within 0.5 m
while walking.

### Phase 4 — Host-authoritative world snapshots (5–7 days)

This is the bulk of the work.

- **Stable IDs.** Add `nextEntityId` and attach `id` in every spawn path:
  `spawnCow`, `spawnBull`, `spawnHopper`, `spawnPet`, `spawnProp`, `spawnPerson`, `spawnChest`,
  `dropMeat`, `spawnFish`, `spawnBee`, `spawnBird`, `spawnAnt`, `spawnTornado`. Use prefixes
  (`e_`, `p_`, `c_`) for readability.
- **Registry.** `entitiesById`, plus a `netType` on each entity (`cow`, `bull`, `pet`, `person`,
  `prop`, `meat`, `chest`, `fish`, `bee`, `bird`, `ant`).
- **Serializers.** One function per type:
  - common: `i` id, `k` kind, `x`, `y`, `z`, `r` yaw, `s` state, flags
  - flags: `heldBy`, `rider`, `dead`, `opened`
  - extras only when needed for animation (`bull.state`, `pet.state`, `person.role`, …)
- **Host snapshot loop.** Every 66–80 ms:
  - gather entities within `INTEREST_R` of each client (grid buckets of 50 m)
  - include players and world time / chest-opened set
  - send per-client snapshots over that client's `state` channel
- **Client world mode.**
  - `NET.role === 'client'`: skip `updateCow`, `updateBull`, `updatePet`, `updatePerson`,
    `updateTornado`, `updateFish`, `updateBee`, `updateBird`, `updateAnt`, spawn timers,
    `despawnFarWildlife`, `overpopulationCull`, and weather timers.
  - Split `updateSky(dt)` into `advanceSky(dt)` (host only) and `applySky(dayT)` (both), so a client
    does not double-advance the clock.
  - Render the static world from the seeded generator; never run local world spawns.
  - Create missing entities, update transforms, remove entities missing for N snapshots.
  - Interpolate remote players and NPCs; snap on teleport/respawn.
- **Entity lifecycle edge cases:**
  - held entity: hide from the world; attach it to the holder's carry position (or show a small
    "carrying" attachment on the remote avatar)
  - ridden entity: set rider, align player to mount, animate locally
  - dead/removed: short death effect on clients, then remove
  - opened chest: keep the mesh, set `opened` and lid rotation

**Acceptance:** host kills a cow; every client sees the death and meat at the same position (pickup
is Phase 5); host opens a chest once; every client sees it open and cannot open it again; host
changes the time of day; clients follow within a second.

### Phase 5 — Interactions, combat, and shared survival (4–6 days)

- Add command messages from clients:
  `punch`, `shoot`, `use`, `lift`, `drop`, `feed`, `eat`, `mount`, `dismount`, `openChest`,
  `selectWeapon`.
- Host validates:
  - actor alive and not mounted/carrying when required
  - target exists, in range (melee ≤ ~4 m, guns ≤ weapon range), line of sight where feasible
  - cooldowns and fire rate
  - chest not opened, item not already claimed
- Refactor the action helpers to take an actor:
  `punch`, `shoot`, `gunRay`, `edibleNear`, `useGrab`, `lift`, `release`, `mountRide`,
  `dismountRide`, `targetChest`, `openChest`, `targetMeat`, `eatMeat`, `findFeedTarget`,
  `feedHeld`, `hurt`, `killEdible`, `killPerson`.
- Move the global `guns` / `GUN_DEFS.owned` / ammo state onto each actor. `gunRay` must use the
  actor's eye position and look vector, not the local `camera`. The host owns ammo/cooldowns;
  clients only display them.
- AI targeting:
  - `nearestActor(x, z)` replaces direct `P` reads in `updatePet`, `updateBull`, `updatePerson`,
    `updateBird`/wildlife and `awake()`.
  - `awake(e)` uses the nearest player, not the host only.
  - Attack effects (`bonk`, `maul`, `bite`, `venom`, `hurt`) apply to the attacked actor.
- Player death:
  - Host sets `dead`, broadcasts `death` + respawn point.
  - Client shows the flash/toast; host respawns after 2–3 s with full HP/hunger at `(0, 6)`.
  - Drop held item / dismount before respawn.
- Events for effects and audio:
  `playerJoined`, `playerLeft`, `shot`, `hit`, `kill`, `meatDrop`, `chestOpen`, `lift`, `drop`,
  `mount`, `dismount`, `hurt`, `death`, `respawn`, `sfx`, `toast`.
- Personal vs shared:
  - personal: `hp`, `hunger`, `found`, `sword`, `guns` (armed/weapon/ammo/cooldowns)
  - shared: NPCs, meat, chests, day/night, tornado
- Friendly fire stays off in v1. Punch/shoot target filters exclude players.

**Acceptance:** two players hunt the same bull; damage and death are consistent; a client can mount
a horse and the host sees the rider; a client can lift a sheep; hunger/HP are personal and survive
reconnect.

### Phase 6 — Resilience, security, and operations (3–5 days)

- Reconnect:
  - client re-joins through `/api/rooms/join` with a session token
  - host keeps the actor for 30 s and creates a new `RTCPeerConnection`
  - host sends a full snapshot after `welcome`
- Host leave:
  - data channels close; clients show "Host ended the room"
  - no host migration in v1. A new host would need to rebuild all peer connections and transfer
    authoritative state; that is a separate project.
- Host tab visibility:
  - listen to `document.visibilitychange`; show "Keep this tab active — the world is running here"
  - if the host is hidden too long, clients show "Host paused"; the room is effectively frozen
- Validation and rate limits:
  - input ≤ 60/s, commands ≤ 20/s, chat ≤ 1/s
  - names ≤ 20 chars, chat ≤ 200 chars, strip control characters
  - reject commands from unknown peers, unknown entity IDs, out-of-range interactions
  - API rate limits per IP and per room (join/create/signal)
- Admin:
  - Vercel-issued allowlist/role token; F2 is a local solo sandbox only
  - disable F2/admin panel for clients while a room is active
  - a host may only use network-affecting admin powers if Vercel granted them
  - do not use the current `CODE_HASHES` as a multiplayer gate
- Backpressure:
  - drop old snapshots per peer; cap `bufferedAmount`; close slow peers
- Observability:
  - Vercel logs for room/signal API errors
  - client debug overlay: connection state, ICE state, ping, snapshot rate, entity count,
    prediction error
- Redis hygiene:
  - TTLs on every key; heartbeat; cleanup stale peers on join
  - no game state in Redis

**Acceptance:** kill a client's network for 10 s and reconnect; a malicious peer cannot spawn items
or open chests from across the map; names/chat cannot inject HTML; expired rooms disappear.

### Phase 7 — Vercel deployment and playtest (2–3 days)

- Deploy the existing Next.js app to Vercel Preview and Production.
- Configure env vars in Vercel (see §8).
- Provision Vercel Marketplace Redis (Upstash) in the same region as the Functions.
- Configure a TURN provider and issue short-lived credentials from `/api/turn`.
- Add a deployment checklist to the README:
  - `/api/health` returns `{ ok: true, redis: true }`
  - room create/join works on the Preview URL
  - Vercel Deployment Protection is disabled (or testers are authenticated) on the URL you share
  - two peers connect on home Wi-Fi, corporate Wi-Fi, and phone hotspot
  - a forced TURN-only test connects
- Playtest:
  - 2 players on LAN
  - 4 players over the internet at ~100 ms
  - 1-hour soak with join/leave/reconnect
  - simulated 150 ms + 2% loss
  - mobile touch controls on one phone
  - Safari/iOS and Firefox
- Roll out behind `NEXT_PUBLIC_MULTIPLAYER=1`; keep solo as the default.

**Acceptance:** four players complete a 30-minute session on the Production URL without a
reload-causing desync; host stays above 45 FPS on a mid-range laptop; clients report < 60 KB/s down;
a TURN-only peer can join.

### Effort summary

| Phase | Effort |
| --- | --- |
| 0 — Baseline + Vercel guardrails | 0.5–1 day |
| 1 — Deterministic world | 2–3 days |
| 2 — Vercel signaling + WebRTC + lobby | 4–5 days |
| 3 — Player movement netcode | 3–4 days |
| 4 — World snapshots | 5–7 days |
| 5 — Interactions / combat | 4–6 days |
| 6 — Resilience / security | 3–5 days |
| 7 — Vercel deploy / playtest | 2–3 days |
| **Total** | **~24–34 working days (5–7 weeks solo)** |

A playable two-player vertical slice is Phases 0–4: roughly **3–4 weeks**.

---

## 8. Vercel implementation details

### API routes

```
app/api/rooms/route.js              POST create room
app/api/rooms/join/route.js         POST join room
app/api/rooms/rejoin/route.js       POST reconnect a client session
app/api/rooms/[code]/route.js       GET room status (optional)
app/api/rooms/heartbeat/route.js    POST host heartbeat
app/api/rooms/leave/route.js        POST leave / delete room
app/api/signal/route.js             POST send / GET drain signaling mailbox
app/api/turn/route.js               POST short-lived ICE servers
app/api/health/route.js             GET health
```

Use the Node.js runtime for routes that need HMAC/crypto. All routes must be dynamic and uncached.

### Redis client

Use `@upstash/redis` with the Vercel Marketplace Redis integration. Support both env names so the
project works with either the Vercel KV-compatible integration or a direct Upstash database:

```js
const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
```

Keep Redis access in one module (`lib/server/redis.js`) so it is easy to swap or mock.

Never keep rooms, peers, or signaling queues in module-level memory. Vercel may route each request
to a different Function instance; Redis is the only shared source of truth.

### Environment variables

| Variable | Scope | Purpose |
| --- | --- | --- |
| `KV_REST_API_URL` / `UPSTASH_REDIS_REST_URL` | Server | Redis REST endpoint |
| `KV_REST_API_TOKEN` / `UPSTASH_REDIS_REST_TOKEN` | Server | Redis token |
| `ROOM_SECRET` | Server | HMAC key for room/session tokens (32+ random bytes) |
| `TURN_URL` | Server | TURN URI (`turns:...`) |
| `TURN_USERNAME` / `TURN_CREDENTIAL` | Server | TURN credentials used only by `/api/turn` |
| `NEXT_PUBLIC_MULTIPLAYER` | Client | Feature flag |
| `NEXT_PUBLIC_APP_VERSION` | Client | Protocol/version guard (optional) |

Never expose `ROOM_SECRET`, Redis credentials, or permanent TURN credentials with
`NEXT_PUBLIC_*`. `/api/turn` returns time-limited ICE servers to the browser.

### Tokens

- On create/join, issue `{ room, peerId, role, exp }` signed with HMAC-SHA256 (`ROOM_SECRET`).
- Store only the token hash/ID if you need revocation; for v1, a short expiry (2 h) is enough.
- Every `/api/signal` and `/api/rooms/heartbeat` request verifies the token's room and role.
- Send the token in an `Authorization: Bearer` header, not in a query string that Vercel may log.
- Do not trust a peer ID supplied by the client without the token.

### TURN

- Default `iceServers`: Google STUN (`stun:stun.l.google.com:19302`) plus the `/api/turn` result.
- TURN is required for symmetric NAT and some corporate networks. Without it, a noticeable share of
  players will fail to connect.
- Use a provider with data-relay support (Cloudflare Calls TURN, Twilio Network Traversal, Metered,
  or similar). Budget for relay bandwidth; it is only used when a direct path fails.
- Prefer `turns:` (TLS) on port 443 for restrictive networks.
- Test a TURN-only peer by blocking UDP or using a network that forces relay.

### Caching, regions, limits

- `dynamic = 'force-dynamic'`, `Cache-Control: no-store` on all room/signal routes.
- Put Redis in the same region as the Functions to keep signaling latency low.
- Vercel API request bodies are small; signal messages are tiny. No streaming needed.
- Function cold starts only affect the first join/signal request; keep routes small.
- Preview deployments use their own URL but the same API routes; use separate Redis databases or
  key prefixes per environment if needed.

### Cost profile

- **Vercel:** static app + a few short API calls per join/reconnect. No Function invocation per
  snapshot, so gameplay duration and player count do not drive Vercel compute.
- **Redis:** a handful of tiny keys per room, all with TTL; a small managed Redis plan is plenty for
  private rooms.
- **TURN:** only connections that cannot go peer-to-peer use it. Budget per GB and measure the
  relayed share during playtests; most home networks should connect directly via STUN.

### Why not Vercel native WebSockets?

They are a real feature now, but not a good fit for this room model:

- Each connection is pinned to one Function instance; there is no built-in fan-out to the other
  players in the room.
- The connection closes at the Function duration limit, so a long session needs reconnect logic
  anyway.
- Vercel recommends external state for rooms/presence/pub-sub; at that point a WebRTC data channel
  is simpler and removes Vercel from the per-frame path.
- Native WebSockets could still be used for **signaling** instead of polling, but polling is easier
  to reason about and only runs during join. Do not use them for gameplay.

---

## 9. Protocol draft

### HTTP signaling

```http
POST /api/rooms
{ "name": "Khaled", "maxPlayers": 8 }
-> { "code": "ABC123", "seed": 148291, "peerId": "p_1", "token": "..." }

POST /api/rooms/join
{ "code": "ABC123", "name": "Tahar" }
-> { "peerId": "p_2", "token": "...", "seed": 148291, "hostPeerId": "p_1",
     "players": [{ "id": "p_1", "name": "Khaled", "host": true }] }

POST /api/signal
{ "room": "ABC123", "to": "p_2", "type": "offer", "data": { "sdp": "..." } }
-> { "ok": true }

GET /api/signal?room=ABC123&peer=p_1&after=17
-> { "messages": [
     { "id": "18", "from": "p_2", "type": "join", "data": { "name": "Tahar" } },
     { "id": "19", "from": "p_2", "type": "answer", "data": { "sdp": "..." } }
   ] }
```

Signal types: `join`, `offer`, `answer`, `ice`, `ready`, `leave`, `error`.

### WebRTC handshake

1. Host polls its mailbox and receives `join`.
2. Host creates `RTCPeerConnection` + `ctrl` + `state` channels + offer.
3. Host posts `offer` to the client's mailbox.
4. Client applies the offer, creates an answer, posts `answer`.
5. Both post `ice` candidates as they are gathered.
6. On `ctrl.onopen`, host sends `welcome`. The client generates the world, sends `ready`, and starts
   inputs only after the host starts the round.

### Data channel messages

Envelope: `{ "t": "...", ... }`.

```json
{"t":"welcome","self":"p_2","room":"ABC123","host":"p_1","seed":148291,"tickRate":15,
 "players":[{"id":"p_1","name":"Khaled","host":true}]}

{"t":"input","seq":42,"ax":0.4,"ay":1.0,"yaw":1.23,"pitch":-0.11,"btn":2}

{"t":"cmd","cid":7,"type":"punch","target":"e_88"}

{"t":"snap","tick":900,"ack":42,"day":0.31,
 "players":[{"i":"p_2","x":12.31,"y":0,"z":-4.22,"r":1.57,"p":-0.1,
              "hp":8,"hunger":4,"held":null,"ride":"e_41","w":2}],
 "ents":[{"i":"e_88","k":"cow","x":18.2,"y":0,"z":5.1,"r":-0.4,"s":"graze","f":0}],
 "chests":["c_12"],
 "tornado":[{"x":30,"z":-10,"r":24}]}

{"t":"ev","type":"kill","actor":"p_1","target":"e_88","kind":"cow","x":18.2,"z":5.1}
{"t":"ev","type":"chat","from":"p_2","name":"Tahar","text":"over here"}
{"t":"ping","at":1760000000000}
```

Rules:

- Clients send `input`/`cmd` only to the host; they never talk to each other.
- Host validates commands and sends per-client snapshots.
- Host broadcasts `ev` to all clients; chat goes client → host → all.
- `ack` is the last input sequence the host applied for that client.
- Flags `f`: bit 1 held, bit 2 ridden, bit 4 dead, bit 8 opened.
- `btn`: `1` jump, `2` sprint, `4` fire/use held, `8` interact.

---

## 10. Data model

```js
// Redis room hash
{
  code: "ABC123",
  seed: 148291,
  hostPeerId: "p_1",
  hostName: "Khaled",
  maxPlayers: 8,
  createdAt: 1760000000000,
  version: 1,
  status: "lobby"
}

// Redis peer hash entry
{ id: "p_2", name: "Tahar", role: "client", joinedAt: 1760000000000 }

// Signaling message
{ id: "18", from: "p_2", type: "answer", data: { sdp: "..." }, ts: 1760000000000 }

// Actor (host-side; remote proxies on host)
{
  id, name, isHost, isLocal,
  x, z, baseY, jy, jv, kx, kz, fl, bump,
  yaw, pitch, walkT, inW, sw, floor, tower, lift,
  holdingId, rideId, hp, hunger, found,
  guns: { armed, weapon, ammo, cooldown, infAmmo },
  sword, dead, seq, lastAck
}

// Networked entity
{
  id, netType, kind,
  x, y, z, yaw, state,
  heldBy, rider, dead, opened
}
```

Type mapping:

| World object | `netType` | Notes |
| --- | --- | --- |
| Cow / bull / hopper | `cow` / `bull` / `hopper` | state machine fields |
| Pet (sheep, horse, lion, …) | `pet` | `kind` distinguishes species |
| Person / villager / farmer | `person` | role + dead |
| Prop (bale/rock/barrel) | `prop` | kind |
| Meat | `meat` | removable after eat |
| Chest | `chest` | opened flag |
| Fish / bee / bird / ant | `fish` / `bee` / `bird` / `ant` | optional low-priority sync |
| Tornado | `tornado` | event + snapshot |

---

## 11. Determinism checklist

Static world generation must match on every peer:

- [ ] One seed per room, stored in Redis and sent on join.
- [ ] `worldRng` separate from runtime RNG; only `worldRng` in static builders.
- [ ] No `Math.random`, `Date.now`, `performance.now`, or network callbacks in static generation.
- [ ] Fixed generation order (`initWorldAsync` steps run sequentially).
- [ ] No object-key iteration where order could differ; sort where needed.
- [ ] Three.js pinned at `0.128.0`.
- [ ] Round serialized positions to 3 decimals; quantize before hashing.
- [ ] `worldChecksum()` covers trees, solids, buildings, props, chests, initial spawns.
- [ ] Two-tab check: same seed → same checksum.

If a mismatch is found, refuse to join and print both checksums. A desynced peer is worse than a
disconnected one.

---

## 12. Security notes

- **Never trust the client** for damage, loot, teleport, spawn, or admin powers. The host validates;
  Vercel validates room membership and tokens.
- The current F2 `CODE_HASHES` are in the browser bundle. They are a solo sandbox Easter egg, not a
  multiplayer permission system.
- Disable F2/admin for clients while a room is active. A host may only use network-affecting admin
  powers if Vercel granted them.
- Sign room/session tokens with `ROOM_SECRET`; verify room and role on every signal/heartbeat call.
- Rate-limit room create/join and signal endpoints per IP and per room.
- Cap room size, name length, chat length, and signal mailbox size.
- Sanitize names/chat; render as text, never `innerHTML`.
- TURN credentials must be short-lived and issued by `/api/turn`; do not put permanent credentials
  in `NEXT_PUBLIC_*`.
- WebRTC data channels are encrypted (DTLS); still validate every command as if the peer were
  hostile.
- WebRTC reveals peer IP addresses to the other room members. For private friend rooms that is
  usually acceptable; do not expose public rooms without considering that privacy trade-off.
- Do not log tokens, SDP blobs, or Redis credentials.
- Use `wss`/`https` only; Vercel provides TLS.

---

## 13. Testing plan

### Automated

- Unit: RNG determinism, `worldChecksum`, snapshot encode/decode, command validation, token verify,
  rate limiter.
- Integration with two headless browser contexts:
  - create room / join room through API routes with a mocked or test Redis
  - establish a WebRTC connection locally (Playwright supports WebRTC in Chromium)
  - both see each other
  - move and compare positions
  - host punches a cow; client sees it die
  - client opens a chest; host sees it opened; second open rejected
  - reconnect after closing the data channel
- API tests: expired room, full room, bad token, rate limit, malformed SDP.
- CI: `npm run build` and the unit/integration suites.

### Manual matrix

| Scenario | Expected |
| --- | --- |
| 2 players, LAN | direct connection, smooth |
| 2 players, home NAT | STUN succeeds |
| 2 players, symmetric NAT | TURN succeeds |
| 4 players, 100 ms RTT | playable, host 45+ FPS |
| 150 ms + 2% loss | no crash; movement recovers |
| Host leaves | clients see "host ended" |
| Client leaves mid-carry | entity drops on host, removed on clients |
| Two players punch same animal | one death, correct loot |
| Two players open same chest | one loot roll, second rejected |
| Ride + carry + tower lift | remote avatar and mount align |
| Night/tornado | all clients agree |
| Safari/iOS + Firefox | data channels open; touch controls work |
| Vercel Preview deployment | same-origin API + WebRTC work |

### Acceptance for the vertical slice (Phases 0–4)

- [ ] Two players join by code and see each other.
- [ ] Same world checksum.
- [ ] Walk/jump/sprint/collide correctly on both.
- [ ] Host kills an animal; client sees death and meat at the same position.
- [ ] Host opens a chest; client sees it opened and cannot duplicate loot.
- [ ] Day/night matches.
- [ ] No duplicate AI or duplicate chests on the client.
- [ ] Solo mode unchanged.
- [ ] Works on a Vercel Preview URL.

---

## 14. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| NAT traversal fails without TURN | High | Configure TURN; issue short-lived credentials; show a clear "could not connect" message; test TURN-only |
| Host tab backgrounded or laptop sleeps | High | Browser throttles rAF; show "keep this tab active", use Page Visibility API, treat a stalled host as a disconnect. Only a dedicated server removes this. |
| Host leaves and room dies | Medium | Clear UX; reconnect for clients; no host migration in v1 |
| Host client can cheat (it owns the simulation) | Medium | Co-op only, no PvP; later dedicated server if competitive play matters |
| Host CPU with players spread out | High | Host must simulate AI around each player; cap active AI bubbles, reuse the 220 m gate, reduce caps for low-end hosts |
| Refactoring 549 `P` references | High | Keep `P` as an alias, extract one function at a time, keep the game runnable after each commit |
| Determinism drift | High | Seeded stream, checksum, two-tab test, refuse join on mismatch |
| Many entity types need serializers | Medium | Ship cows/pets/chests/meat/persons first; wildlife can be event-only or local-cosmetic |
| WebRTC message size / backpressure | Medium | Keep < 16 KB, chunk large snapshots, drop when `bufferedAmount` is high |
| Vercel Function/Redis cold starts | Low | Signaling only; small routes; same-region Redis; retries |
| Redis outage | Medium | Existing data channels keep playing; new joins/reconnects fail gracefully |
| Vercel native WebSocket temptation | Medium | Do not use it for gameplay; use WebRTC. Document the pinned-instance/duration limits. |
| Mobile performance with 8 players | Medium | Cap 4 on touch devices; reduce snapshot rate/interest radius |
| Scope creep into PvP/accounts | High | Keep v1 non-goals explicit; ship co-op first |

---

## 15. Open decisions (defaults recommended)

1. **Transport:** WebRTC star + Vercel signaling — *recommended*.
2. **Mode:** private co-op PvE — *recommended*.
3. **Room size:** 8 — *recommended*; 4 for mobile-heavy groups.
4. **Discovery:** invite codes only — *recommended* for v1.
5. **PvP:** off — *recommended*.
6. **Accounts/persistence:** none in v1 — *recommended*.
7. **TURN provider:** Cloudflare Calls TURN, Twilio, or Metered — *pick one before Phase 7*.
8. **Host migration:** no in v1 — *recommended*.
9. **Redis:** Vercel Marketplace Redis/Upstash — *recommended*.
10. **Fallback if WebRTC proves unreliable:** managed realtime relay (Ably/Pusher/Supabase) while
    keeping Vercel for the app. Decide only after the TURN test.

---

## 16. Suggested PR sequence

| PR | Contents | Reviewable outcome |
| --- | --- | --- |
| 1 | `lib/world/rng.js`, seeded generation, checksum, tests | Same seed → same world; solo unchanged |
| 2 | `lib/server/redis.js`, room/signal/turn/health API routes, token helpers | Rooms exist and can be joined; signaling mailbox works |
| 3 | `lib/net/signaling.js`, `lib/net/webrtc.js`, lobby UI, remote avatars | Two peers connect and see each other |
| 4 | `stepActor`, actor shape, input packets, remote proxies, interpolation | Players move together |
| 5 | IDs, registry, serializers, host snapshots, client world mode | Shared NPCs and chests |
| 6 | Commands, actor-parameterized actions, events, combat, death | Shared hunting/riding/carrying |
| 7 | Reconnect, validation, admin allowlist, rate limits, debug overlay | Robust session |
| 8 | Vercel env/TURN/deploy, playtest fixes | Invite a friend to the Production URL |

Keep each PR shippable in solo mode. The feature flag should make multiplayer code inert when
`NEXT_PUBLIC_MULTIPLAYER` is not set.

---

## 17. Definition of done (v1)

- A host can create a room on the Vercel URL and share a code; 2–8 players join.
- Everyone sees the same world and each other; movement is smooth at 100 ms.
- NPCs, chests, loot, damage, day/night, and tornadoes are shared and host-authoritative.
- Carry, ride, feed, eat, punch, shoot, and death/respawn work across clients.
- Reconnect works by re-signaling; host leave is handled cleanly.
- Admin is server-gated and cannot be unlocked by the client bundle.
- Solo mode is unchanged and remains the default.
- No custom server, no long-lived Vercel Function, no gameplay traffic through Vercel.
- A 4-player, 30-minute playtest on the Production URL passes without a reload-causing desync.

---

## References

- [Vercel WebSockets documentation](https://vercel.com/docs/functions/websockets)
- [Vercel KB: Do Vercel Functions support WebSocket connections?](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections)
- [Vercel changelog: WebSocket support is now generally available](https://vercel.com/changelog/websocket-support-is-now-generally-available)
- [Ably: WebSockets on Vercel — native support, limits, and options](https://ably.com/vercel/websockets-on-vercel)
