# PNI

A first-person pastoral sandbox built with three.js and Next.js. Roam an open
pasture, lift and carry creatures, mount the beasts, hunt when you get hungry,
collect loot, explore the cities and islands, and survive the night when the
wolves come out.

![stack](https://img.shields.io/badge/Next.js-16-000)
![stack](https://img.shields.io/badge/React-19-61DAFB)
![stack](https://img.shields.io/badge/three.js-0.128-000)
![stack](https://img.shields.io/badge/multiplayer-zero--config-brightgreen)

**Live:** <https://grasshopper-chi.vercel.app>  
**Vercel project:** `electromobil/grasshopper` (Hobby, free Upstash Redis connected)

## Features

- **First-person 3D world** — pointer-locked mouse look, WASD movement, sprinting.
- **Lift & carry** — grab creatures and haul them around. Small pickups rest in
  your hand instead of floating in front of the camera (progress toward all 27).
- **Mount & ride** the beasts, and travel tower floors.
- **Day / night cycle** (a full day ≈ 300s) with night wolves.
- **Survival** — 10 hearts with a health bar, a hunger bar that drains over time,
  dropped meat, and wild fruit (apples, blueberries, strawberries, berries and
  blackberries) you can eat with <kbd>F</kbd> to refill hunger and sometimes HP.
- **HUD & minimap** — health and hunger fills, an 8-point compass
  (N/NE/E/SE/S/SW/W/NW) and a live local map that reveals dungeon lairs as you
  approach and marks the relic portal.
- **Loot chests** scattered across the map, plus biome armories and boss-sealed
  vaults with endgame gear.
- **Cities & islands** to explore.
- **Weapons** — pistol, shotgun, rifle, AK-47, Big Game Rifle, Frostbite Rifle,
  Sandstorm LMG and the rocket-firing Pni's Bane RPG (700 damage).
- **30 swords and armor tiers** — swap between every blade you own with
  <kbd>Q</kbd>; armor reduces incoming damage from bosses and beasts.
- **Three bosses and a real ending** — Raoar the Frost Warden, Lala the Dune
  Sovereign and Pni, the 2000 HP final boss in a sky-parkour realm.
- **Living towns and wilds** — villagers swat ants, grasshoppers, bees and
  butterflies; hunters carry rifles and bring down game animals. A hunter needs
  two clean shots to drop a bear or a bull, then walks over to carry and eat the
  meat. Punch a hunter and he turns on you, chasing and firing back.
- **Colourful bugs** — grasshoppers come in green, brown, orange, yellow and the
  occasional pink; desert locusts share the same body with long swept-back wings
  and lean yellow, orange, brown, green or, rarely, pink.
- **Admin & cheat console** for powers and fun.
- **Mobile touch controls** — virtual stick plus LIFT / JUMP / PUNCH buttons.
- **Distance-based culling** so large scenes stay smooth.
- **Clean play view** — hearts, hunger and the rest of the HUD sit in the top
  row; gameplay notes sit low, and only face-to-face NPC dialogue uses the top
  toast slot.
- **Avatar picker and third-person view** — press <kbd>F3</kbd> to see your avatar.
- **Death and respawn screen** — collapse from damage or starvation, then respawn.
- **Private co-op rooms** — host a room, share a 6-character code, invite link or
  QR code, and play with up to 5 friends (6 players total). No account, API key, Redis or TURN
  service is required.

## Endgame

The snowfield and desert each hide a boss lair at the centre of the biome. The
progression is deliberately ordered:

1. **Raoar — Frost Warden (1005 HP, snowfield).** Open the armory chest by the
   lair entrance for **Frostguard Armor** (50% damage reduction) and the
   **Frostbite Rifle**. Defeat Raoar, then loot the vault behind him for
   **Raoar's Warden Plate** (62%) and the **Winter's End** sword.
2. **Lala — Dune Sovereign (1000 HP, desert).** The desert armory holds the
   **Sunforged Aegis** (70%) and **Sandstorm LMG**. Lala's vault unlocks after
   her defeat with **Pni's Skyguard** (78%), **Pharaoh's Wrath** and
   **Pni's Bane**, a 700-damage RPG with five rockets.
3. **The relic portal.** Each fallen warden drops a gold relic. With both relics,
   the sealed portal near spawn wakes up: press <kbd>F</kbd> once to open it and
   again to step through.
4. **Pni's sky path.** Cross the floating platform course (falling returns you to
   the last checkpoint), then land on the final arena to drop Pni's shield and
   start the 2000 HP fight. Pni enrages below half health. Winning shows the
   **Pasture Champion** screen; **Keep exploring** returns you to the pasture.

Each warden drops a gold relic when defeated, and each vault stays sealed until
that specific boss is down. Armory and vault chests do not restock, so their loot
is a one-time upgrade path. Regular chests can also roll swords, armor and ammo.

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
  The current deployment is `electromobil/grasshopper` on the Vercel Hobby plan
  with the free Upstash Redis integration. Vercel Authentication is disabled so
  the production URL is public. Deploy updates with:
  ```bash
  npx vercel --prod
  ```
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
| **E** | Punch — or shoot when a gun is armed (punching a hunter provokes him) |
| **F** | Interact: lift & carry, mount, feed, eat fruit or dropped meat even with a gun drawn, open a chest or vault, pick up a relic, use the portal, or dismount |
| **G** | Descend a tower floor (or mount a target while in admin) |
| **1 – 8** | Select weapon (pistol / shotgun / rifle / AK-47 / Big Game Rifle / Frostbite Rifle / Sandstorm LMG / Pni's Bane RPG) |
| **Q** | Cycle through the swords you own |
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
