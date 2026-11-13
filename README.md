# 🐄 Grasshopper Pasture

A first-person pastoral sandbox built with three.js and Next.js. Roam an open
pasture, lift and carry creatures, mount the beasts, hunt when you get hungry,
collect loot, explore the cities and islands, and survive the night when the
wolves come out.

![stack](https://img.shields.io/badge/Next.js-16-000)
![stack](https://img.shields.io/badge/React-19-61DAFB)
![stack](https://img.shields.io/badge/three.js-0.128-000)
![stack](https://img.shields.io/badge/multiplayer-zero--config-brightgreen)

## Features

- **First-person 3D world** — pointer-locked mouse look, WASD movement, sprinting.
- **Lift & carry** — grab creatures and haul them around (progress toward all 13).
- **Mount & ride** the beasts, and travel tower floors.
- **Day / night cycle** (a full day ≈ 300s) with night wolves.
- **Survival** — 10 hearts, a hunger meter that drains over time, and dropped
  meat you can eat to refill it.
- **Loot chests** scattered across the map.
- **Cities & islands** to explore.
- **Weapons** — pistol, shotgun, rifle, and AK-47.
- **Admin & cheat console** for powers and fun.
- **Mobile touch controls** — virtual stick plus LIFT / JUMP / PUNCH buttons.
- **Distance-based culling** so large scenes stay smooth.
- **Avatar picker and third-person view** — press <kbd>F3</kbd> to see your avatar.
- **Death and respawn screen** — collapse from damage or starvation, then respawn.
- **Private co-op rooms** — host a room, share a 6-character code, invite link or
  QR code, and play with up to 5 friends (6 players total). No account, API key, Redis or TURN
  service is required.

## Tech stack

- **Next.js** `^16.4.6` (App Router), **React** `^19.1.0`, **three.js** `0.128.0`
- **WebRTC data channels** for direct gameplay traffic
- **HTTP relay fallback** through the app's own API when WebRTC cannot connect
- **In-process room store** by default; optional Redis for multi-instance hosting

## Getting started

> Requires Node.js 20.9+ (Next.js 16).

```bash
npm ci
npm run dev        # http://localhost:3000
```

### Production

```bash
npm run build
npm start
npm test              # deterministic world, room API, relay, store and security tests
npm run test:browser  # two-tab co-op smoke test (needs `npm run dev` + Chrome)
```

`test:browser` uses `playwright-core` with an installed Chrome. Set
`CHROME_PATH` if Chrome is in a non-standard location.

## Multiplayer

### The short version

1. Click **Host room**, then press <kbd>I</kbd> or tap **INVITE**.
2. Share the code, invite link or QR code.
3. Friends open the link (the code is prefilled) or enter the code, then click
   **Join room**.
4. The host's browser runs the world. Keep that tab open.

Everything runs from this one app. There is no signup, no dashboard to
configure and no external API key.

### How the connection is made

The host is authoritative. Its browser simulates the world; clients send inputs
and receive snapshots. Two transports carry the same protocol:

| Transport | When it is used | Notes |
| --- | --- | --- |
| **WebRTC data channels** | Default | Direct host↔client; public STUN needs no key. Lowest latency. |
| **HTTP relay** | Automatic after ~9s if WebRTC fails, or if the direct link drops | Uses `/api/relay` mailboxes in this same server. Works through symmetric NAT, blocked UDP and restrictive firewalls. Slightly higher latency. |

That fallback is what makes the free setup usable on real networks without a
paid TURN provider. If you want UDP latency for restrictive peers, you can
optionally self-host `coturn` (still no account/key); see
[deploy/coturn](deploy/coturn) and [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

The server also handles room creation, join/rejoin, presence heartbeats,
WebRTC signaling, the relay mailboxes and short-lived ICE credentials. Room
state defaults to an in-process store with TTLs. That is the correct choice for
one `npm start`/Docker container.

### Hosting for free

- **Same Wi-Fi** is the simplest: run `npm start`, open the **Network** URL
  printed by Next, allow port 3000 through the firewall. No external service.
- **Docker:** `docker compose up -d --build` serves the same zero-config stack.
- **Internet play:** put the container behind any HTTPS reverse proxy or tunnel
  you already have. See [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) for a
  Caddy example and hosting options.
- **Vercel + Redis** still works if you prefer a permanent serverless URL, but
  it needs a free Upstash/Vercel Redis database. It is optional, not required.
  See [docs/VERCEL_DEPLOY.md](docs/VERCEL_DEPLOY.md).

The host's machine must stay awake while a room is open, and the host's browser
tab must stay open. There is no host migration yet; if the host leaves, the
room ends.

### Optional environment variables

Every variable is optional. The defaults are the zero-config setup.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ROOM_SECRET` | random per process | Stable HMAC key for room tokens |
| `STUN_URLS` | public list | Comma-separated STUN URIs |
| `TURN_URL` / `TURN_SECRET` | unset | Optional self-hosted coturn |
| `TURN_USERNAME` / `TURN_CREDENTIAL` | unset | Static TURN credentials |
| `KV_REST_API_*` / `UPSTASH_REDIS_REST_*` | unset | Shared store for multiple instances |
| `NEXT_PUBLIC_MULTIPLAYER` | enabled | Set `0` to hide the lobby |
| `NEXT_PUBLIC_SIGNAL_URL` | same origin | Split UI/API deployment |
| `CORS_ORIGIN` | `*` | Restrict cross-origin API calls |

`GET /api/health` reports the active store, deployment mode, token-secret
source, TURN status and protocol version.

### Current co-op limitations

- Host-authoritative with **no host migration**; the host tab must stay open.
- Rooms are capped at 6 players in the lobby (8 max server-side), expire after
  2 hours, and are kept alive by the host heartbeat.
- Clients automatically reconnect with backoff while the host room is alive;
  reloading a client rejoins through `/api/rooms/rejoin`.
- Punch/shoot, chest opening and player movement are replicated. Carrying,
  riding, feeding and full loot/inventory ownership are still partly host-side.
- NPC animation state is only partially replicated; clients interpolate positions
  and basic states.
- The HTTP relay is intended for self-hosting. On a serverless plan it still
  works, but every relayed message consumes a function invocation.

### Free-tier notes (Vercel + Redis only)

The default self-hosted setup has no metered dependency. If you choose Vercel:

- **Vercel Hobby** includes a generous function allowance; direct WebRTC
  gameplay does not pass through Vercel.
- **Upstash Free** (no card) is enough for many private rooms; signaling polling
  uses a few thousand commands per 2-hour room. Close idle rooms.
- Prefer the self-hosted relay/TURN setup if you expect restrictive networks;
  relay traffic is intentionally not routed through Vercel in the default
  deployment.

No paid service or payment method is required for the default setup.

## Controls

| Key | Action |
| --- | --- |
| **W A S D** / **Arrows** | Move (forward / left / back / right) |
| **Mouse** | Look and aim (click the canvas to lock the pointer) |
| **Shift** | Sprint / faster fly |
| **Space** | Jump (or climb while flying) |
| **F3** | Toggle first-person / third-person avatar view |
| **Enter / Space** | Respawn after collapsing |
| **E** | Punch — or shoot when a gun is armed |
| **F** | Interact: lift & carry, mount, feed, eat dropped meat, open a chest, or dismount |
| **G** | Descend a tower floor (or mount a target while in admin) |
| **1 – 4** | Select weapon (pistol / shotgun / rifle / AK-47) |
| **P** | Open the admin panel |
| **V** | Toggle fly mode |
| **I** | Open the multiplayer invite panel (code, link, QR) |
| **M** | Mute / unmute sound |
| **F2** | Toggle the cheat console |
| **Enter** | Submit a cheat (in the console) |
| **Esc** | Close the cheat console |

> **Cheat console (F2):** type `admin` to unlock powers, or enter a gun code to
> grab a weapon. The console hints you in — try `admin` for powers, or `guns`
> for weapons.

## Project layout

```
grasshopper/
├── app/
│   ├── api/
│   │   ├── rooms/         # create/join/rejoin/leave/status/heartbeat
│   │   ├── signal/        # WebRTC offer/answer/ICE mailbox
│   │   ├── relay/         # HTTP gameplay relay fallback
│   │   ├── turn/          # STUN (+ optional TURN) ICE servers
│   │   └── health/        # deployment health check
│   ├── layout.js          # Root layout, metadata, fonts
│   ├── page.js            # Renders <Game/>
│   └── globals.css        # Global styles
├── components/Game.js     # Canvas, HUD, menu, lobby, overlays
├── lib/
│   ├── game.js            # World, entities, loop, HUD, net hooks
│   ├── net/               # protocol, session, signaling, WebRTC + relay
│   ├── server/            # room store, tokens, HTTP helpers
│   └── world/             # deterministic RNG + world checksum
├── tests/                 # world, protocol, store, API, relay, security, browser
├── deploy/coturn/         # optional self-hosted TURN
├── docs/                  # self-hosting and deployment guides
├── Dockerfile
├── docker-compose.yml
├── next.config.mjs
└── package.json
```

## License

Private project.
