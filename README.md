# 🐄 Grasshopper Pasture

A first-person pastoral sandbox built with three.js and Next.js. Roam an open
pasture, lift and carry creatures, mount the beasts, hunt when you get hungry,
collect loot, explore the cities and islands, and survive the night when the
wolves come out.

![stack](https://img.shields.io/badge/Next.js-16-000)
![stack](https://img.shields.io/badge/React-19-61DAFB)
![stack](https://img.shields.io/badge/three.js-0.128-000)
![stack](https://img.shields.io/badge/Vercel-ready-000)

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
- **Private co-op rooms** — host a room and share a 6-character code, invite link or QR code; play
  together through WebRTC data channels. Vercel only handles the room/signaling API; gameplay
  traffic is peer-to-peer.

## Tech stack

- **Next.js** `^16.4.6` (App Router)
- **React** `^19.1.0`
- **three.js** `0.128.0`
- **Vercel Functions + Redis** for room/signaling metadata
- **WebRTC** for gameplay transport

## Getting started

> Requires Node.js 20+ (Next.js 16).

```bash
# 1. Install dependencies
npm install

# 2. Run the dev server (hot reload)
npm run dev

# 3. Open http://localhost:3000
```

### Production

```bash
npm run build   # build for production
npm start       # serve the production build
npm test        # deterministic-world + room/signal API tests
npm run test:browser  # two-tab WebRTC smoke test (needs `npm run dev` + Chrome)
```

`test:browser` launches the installed Chrome through `playwright-core`. Set `CHROME_PATH` if
Chrome is installed somewhere else.

## Hosting locally (recommended for a small kids game)

You do **not** need Vercel or Redis for a LAN game. The room store falls back to memory in a single
local server process.

```bash
npm install
npm run build
npm start
```

Then open the **Network URL** printed by Next (for example `http://192.168.0.66:3000`) on the host
machine, especially if phones will scan the QR. `http://localhost:3000` works for tabs on the same
PC, but a phone cannot use a `localhost` invite link. The host clicks **Host room**, then presses
<kbd>I</kbd> (or **INVITE** on touch) and shares the code, link or QR. The kids scan/open it and
click **Join room**. Rooms are capped at 6 players by default.

- The host tab must stay open and active; the host browser runs the world.
- No `ROOM_SECRET`, Redis or TURN is required on the same LAN.
- If other devices cannot connect, allow Node/port 3000 through the host's firewall.
- `npm run dev` works the same way for development.
- A local `npm start` uses the in-memory room store. That is fine for one process; only Vercel needs
  Redis because its Functions are multi-instance.

### Playing with friends elsewhere

| Option | What it costs | What to know |
| --- | --- | --- |
| **Same Wi-Fi** | Free | Simplest; no TURN, no Redis, no accounts |
| **Tailscale / private VPN** | Free for personal use | Put host and kids' devices on the same private network; no public URL |
| **Cloudflare Tunnel or ngrok** | Free quick tunnels | Exposes the local server on an HTTPS URL; the host machine must stay on |
| **Vercel + Upstash Redis** | Free/Hobby tiers | Always-on URL; needs the env vars; STUN-only, so some restrictive NATs will fail |

For a non-commercial kids game, start with **same Wi-Fi** or **Tailscale**. Use a public tunnel only
if you are comfortable with the URL being reachable; the room code is the only access gate. The
host's machine must stay awake while the room is open.

### Split option: Vercel UI + local signaling server

You can keep the game UI on Vercel and run the room/signaling API on the local PC. This is useful if
you want a nice permanent URL but do not want Redis or a paid server:

1. On the local PC run `npm run build && npm start` (port `3000`).
2. Expose that port with a tunnel, for example:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
   Copy the HTTPS URL it prints.
3. In Vercel add `NEXT_PUBLIC_SIGNAL_URL=https://your-tunnel-url` and redeploy (this value is baked
   in at build time).
4. Players open the Vercel URL. The host creates a room; clients join; gameplay still travels
   directly over WebRTC.

Important: the local process is **signaling only**. The host browser still runs the world; the
local server does not simulate the game. The tunnel and local server must stay up, and a quick
Cloudflare tunnel gets a new URL each restart (use a named tunnel for a stable URL). If the local
process restarts, in-memory rooms are lost.

The signal URL must be HTTPS when the Vercel app is HTTPS (Cloudflare Tunnel and Tailscale Serve
provide this). The signaling server allows cross-origin calls by default; set
`CORS_ORIGIN=https://your-app.vercel.app` on the local server to restrict it.

## Multiplayer (Vercel-compatible)

The app deploys to Vercel with no custom server. Vercel API routes + Redis handle room creation,
joining and WebRTC signaling; gameplay travels directly between the host and each client over
WebRTC data channels.

1. Click **Host room** on the start menu, then press <kbd>I</kbd> / **INVITE** to share the code,
   link or QR. Guests can enter the code, or open the invite link to prefill it, then click
   **Join room**.
2. The browser reloads into the room, generates the shared seeded world and connects.
3. The host's browser is authoritative. If the host closes the tab, the room ends.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `ROOM_SECRET` | Production | HMAC key for room/session tokens |
| `KV_REST_API_URL` / `UPSTASH_REDIS_REST_URL` | Production | Redis REST endpoint |
| `KV_REST_API_TOKEN` / `UPSTASH_REDIS_REST_TOKEN` | Production | Redis token |
| `TURN_URL` | Leave blank | Optional TURN URI; **do not set** for the no-paid-service setup |
| `TURN_SECRET` | Leave blank | Only if you later choose a free, hard-capped TURN provider |
| `TURN_USERNAME` / `TURN_CREDENTIAL` | Leave blank | Only if you later choose a free, hard-capped TURN provider |
| `NEXT_PUBLIC_MULTIPLAYER` | Optional | Set to `0` to hide the multiplayer panel |
| `NEXT_PUBLIC_SIGNAL_URL` | Optional | Absolute URL of a separate signaling server; empty means same-origin |
| `CORS_ORIGIN` | Optional | Allowed origin for cross-origin signaling; defaults to `*` |

Local development falls back to an in-process room store when Redis is absent, so the lobby works
without extra setup. Production requires Redis and `ROOM_SECRET`; `/api/health` reports missing
configuration.

Direct WebRTC with public STUN works on most home networks but fails for some symmetric NAT,
corporate and school networks. Vercel cannot host TURN. **This project deliberately ships STUN-only
and does not configure a paid TURN service.** If a player cannot connect, use the same Wi-Fi, a
private Tailscale network, or a different network. `/api/turn` returns only STUN unless you
explicitly fill the `TURN_*` variables with a free, hard-capped service you have accepted.

### Current co-op limitations

- The host is authoritative and there is no host migration; if the host leaves, the room ends.
- Rooms are capped at 6 players and expire after 2 hours to keep free-tier usage bounded.
- The host tab must stay open and visible; hidden/background tabs pause the host loop and polling.
- Remote players can move, punch/shoot animals and open chests. Carrying, riding, feeding, eating
  and full loot ownership are still host-side; the next iteration moves those commands onto the
  host actor model.
- Reloading a client re-registers through `/api/rooms/rejoin` and reconnects while the host room is
  alive. Reloading the host still ends the room; there is no host migration.
- The client renders synced NPC positions without local AI, so animations are basic until the
  snapshot state machine is filled out.

### Deployment notes

See [docs/VERCEL_DEPLOY.md](docs/VERCEL_DEPLOY.md) for the exact free-tier Vercel commands and
environment setup.

- Deploy the Next.js app to Vercel Hobby as usual. No `vercel.json` or custom server is required.
- Create one **free Upstash Redis database directly on Upstash**, with no credit card and no paid
  plan. Set `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` in Vercel. Do not attach a card or
  upgrade to a paid plan.
- Add the environment variables to Preview and Production.
- If you share a Preview URL, disable Vercel Deployment Protection or authenticate your testers.
- `GET /api/health` should return `{ "ok": true, "redis": "redis" }` in production.

### Free-tier budget (approx.)

- **Upstash Free:** ~250 MB, 500,000 commands/month, 10 GB bandwidth, 1 database, no credit card.
  The host polls signaling every 1.5 s, so a 2-hour room uses roughly 5,000 commands; that is about
  100 two-hour rooms/month before the command quota. Leaving a room open 24/7 would use it in days,
  so close rooms after playing.
- **Vercel Hobby:** 1,000,000 function invocations and 4 CPU-hours/month; these small signaling
  checks are far below that for a family game. WebRTC gameplay does not pass through Vercel.
- **TURN:** not used. If a player cannot connect directly, use same Wi-Fi/Tailscale rather than
  adding a paid relay.

No paid service or payment method is required for this setup.

## Controls

| Key | Action |
| --- | --- |
| **W A S D** / **Arrows** | Move (forward / left / back / right) |
| **Mouse** | Look and aim (click the canvas to lock the pointer) |
| **Shift** | Sprint / faster fly |
| **Space** | Jump (or climb while flying) |
| **E** | Punch — or shoot when a gun is armed |
| **F** | Interact: lift & carry, mount, feed, eat dropped meat, open a chest, or dismount (context-sensitive) |
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
│   │   ├── turn/          # short-lived ICE servers
│   │   └── health/        # deployment health check
│   ├── layout.js          # Root layout, metadata, fonts (Nunito + Titan One)
│   ├── page.js            # Renders <Game/>
│   └── globals.css        # Global styles (extracted from the original HTML)
├── components/
│   └── Game.js            # Client component: canvas, HUD, menu, cheat box, touch, lobby
├── lib/
│   ├── game.js            # The game engine (world, entities, loop, culling, HUD, net hooks)
│   ├── net/               # session, signaling, protocol, WebRTC transport
│   ├── server/            # Redis, room store, tokens, API helpers
│   └── world/             # deterministic RNG + world checksum
├── tools/
│   ├── extract.js         # One-shot extractor from the original single-file HTML
│   └── esm-loader.mjs     # Test-only loader for lib/ ESM modules
├── tests/                 # Node API, deterministic-world and browser co-op tests
├── docs/
│   └── MULTIPLAYER_PLAN.md
├── jsconfig.json          # Path alias @/* -> ./*
├── next.config.mjs        # reactStrictMode: false (single WebGL context boot)
├── package.json
└── .gitignore
```

## About the extraction

This project began as a single self-contained HTML file. `tools/extract.js`
splits that file into a Next.js project:

```bash
node tools/extract.js <source.html>
#   <style>  ->  app/globals.css
#   <body>   ->  tools/body.html
#   <script> IIFE  ->  the game module (lib/game.js)
```

`next.config.mjs` keeps `reactStrictMode: false` on purpose — the game boots a
single WebGL context and registers global listeners once, and `components/Game.js`
also guards against a double boot, so the world starts exactly once.

## License

Private project.
