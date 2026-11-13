# Self-hosting Grasshopper Pasture

This is the **zero-config, no-API-key** deployment. One Node process serves the
game, the room API, WebRTC signaling and the HTTP relay fallback. You do not
need Vercel, Redis, Upstash, Twilio, Cloudflare Calls or a TURN account.

The only thing you need is a machine that can run Node.js 20.9+ (or Docker) and,
for internet play, a way to reach it over HTTPS.

## Why this works without external services

Multiplayer is host-authoritative: the host's browser simulates the world and
everyone else is a client. Two transports carry the same messages:

1. **WebRTC data channels** — direct browser-to-browser, lowest latency. Public
   STUN servers (no key, no quota) are enough on most home networks.
2. **HTTP relay** — automatically used when WebRTC cannot connect within about
   9 seconds (symmetric NAT, blocked UDP, corporate firewall). The client and
   host exchange the same `input`/`snap`/`cmd`/`ev` messages through
   `/api/relay`, which is just short-lived mailboxes in the app's own process.
   It needs no TURN server and works wherever HTTPS works, at the cost of a
   little extra latency.

Rooms, peers, signaling mailboxes and relay mailboxes live in an in-process
store with TTLs. That is correct for one Node process. If you run more than one
instance, set Redis credentials (see *Scaling out*).

## Quick start — Node

```bash
npm ci
npm run build
npm start
# open http://localhost:3000
```

Use the **Network** URL printed by Next (for example
`http://192.168.0.66:3000`) when another device on the same Wi-Fi will join.
`localhost` only works on the machine that runs the server.

## Quick start — Docker

```bash
docker compose up -d --build
# open http://localhost:3000
```

The image is a normal multi-stage Next.js build. The container runs as a
non-root user and has a `/api/health` healthcheck.

Data is intentionally ephemeral: all rooms are gone when the process/container
restarts. Nothing is written to disk.

## Play on the same Wi-Fi (easiest, free)

1. Start the app on the host machine.
2. Open the **Network** URL on the host (not `localhost` if phones will join).
3. **Host room** → press <kbd>I</kbd> → share the code, invite link or QR.
4. Allow TCP port 3000 through the host firewall.

WebRTC usually connects directly here; the relay is the fallback.

## Play over the internet

You need HTTPS for the public URL (WebRTC requires a secure context outside
`localhost`, and it protects the room tokens). Put the app behind any reverse
proxy you already run. A minimal Caddy example:

```caddyfile
pasture.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Then:

```bash
npm run build
PORT=3000 HOSTNAME=127.0.0.1 npm start
```

The host machine must stay awake while a room is open. The host's browser is
the game server; if that tab closes, the room ends.

Ways to get a public, HTTPS-reachable server without buying a paid service:

- a small free-tier VM you already have (for example an Oracle Cloud always-free
  instance),
- a home server/NAS plus your own domain,
- a private network such as Tailscale and its HTTPS serve/funnel feature,
- a Cloudflare Tunnel or similar tunnel in front of the local process.

Tunnels and free tiers have their own limits and terms; this project does not
depend on any particular one.

## Optional: self-hosted TURN (lower latency, still free)

The HTTP relay already makes restrictive networks work. A TURN server is only
worth adding when you want UDP latency instead of HTTP polling for those peers.
`coturn` is open source and needs no account or key.

On a Linux host with a public IP:

1. Edit `deploy/coturn/turnserver.conf`:
   - `external-ip=` → your public IP,
   - `static-auth-secret=` → a long random string.
2. Open TCP/UDP 3478 and UDP 49160–49200.
3. Start it:
   ```bash
   docker compose -f deploy/coturn/docker-compose.yml up -d
   ```
4. Give the app the same secret:
   ```bash
   TURN_URL=turn:YOUR_PUBLIC_IP:3478
   TURN_SECRET=<the same secret>
   ```

`/api/turn` will then return short-lived TURN credentials alongside the public
STUN servers. Leave `TURN_*` unset and the app stays STUN + HTTP relay only.

## Optional: Redis for multiple instances

The in-process store is single-process only. If you run two or more app
instances behind a load balancer (or deploy to a serverless platform), set one
of:

```bash
KV_REST_API_URL=...        # Vercel Marketplace Redis
KV_REST_API_TOKEN=...
# or
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

The room store switches to Redis automatically and the token secret is derived
from the Redis credentials, so all instances sign compatible tokens without an
extra `ROOM_SECRET`. Set `ROOM_SECRET` yourself if you prefer an independent
key.

## Recommended environment

Every variable is optional.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOSTNAME` | `0.0.0.0` | Bind address (`next start`) |
| `ROOM_SECRET` | random per process | Stable HMAC key for room tokens |
| `STUN_URLS` | public list | Comma-separated extra STUN URIs |
| `TURN_URL` / `TURN_SECRET` | unset | Optional coturn |
| `TURN_USERNAME` / `TURN_CREDENTIAL` | unset | Static TURN creds (if not using `TURN_SECRET`) |
| `KV_REST_API_*` / `UPSTASH_REDIS_REST_*` | unset | Shared store for multi-instance |
| `NEXT_PUBLIC_MULTIPLAYER` | enabled | Set `0` to hide the lobby |
| `NEXT_PUBLIC_SIGNAL_URL` | same origin | Split UI/API deployment |
| `CORS_ORIGIN` | `*` | Restrict cross-origin API calls |

Set `ROOM_SECRET` (for example `openssl rand -hex 32`) on a public server so
tokens survive a restart. Without it, a restart invalidates existing sessions
anyway because the in-memory rooms are gone.

## Operations

- **Health:** `GET /api/health` → `{ ok, store, mode, redis, roomSecret,
  turn, protocol, uptime }`.
- **Logs:** stdout/stderr; room and signal errors are logged by the API routes.
- **Rooms:** 6-character code, 8 players max, expire after 2 hours. The host
  heartbeat keeps a room alive.
- **Tokens:** HMAC-SHA256, 2-hour expiry, scoped to one room/peer/role.
- **Limits:** request-size limits and per-IP/per-peer rate limits are built in.
  Terminate TLS at your reverse proxy and keep the app port private if you can.

## What is still host-authoritative

There is no host migration. If the host reloads or closes the tab, the room
ends; clients show a connection-lost panel and can retry while the host room is
alive. Carrying, riding, feeding and inventory ownership are still partly
host-side, so those interactions are not fully replicated yet. See the project
README for the current co-op limitations.
