# Deploying the multiplayer game to Vercel (free tier)

This project is already Vercel-compatible. The game simulation runs in the host player's browser;
Vercel only hosts the Next.js UI and the small room/signaling API. WebRTC gameplay does not pass
through Vercel.

## What you need

- A Vercel **Hobby** account (no payment method).
- A GitHub account with this repository.
- One **Upstash Redis Free** database (no credit card, no paid plan).
- Node.js 20+ and the Vercel CLI.

No TURN service is used. No paid resource is required.

## 1. Log in to Vercel

```bash
npx vercel login
npx vercel whoami
```

`whoami` must print your account name. If it says `Logged out`, finish the login first.

## 2. Create the free Upstash database

Create it **directly at upstash.com**:

1. Sign in.
2. Create a Redis database.
3. Choose the **Free** plan. Do not add a card and do not select a paid plan.
4. Copy the REST URL and REST token.

Use the REST values, not the `redis://` connection string.

## 3. Link the project

From the repository root:

```bash
npx vercel link
```

Choose the existing project or create a new one. Keep the default Next.js settings.

## 4. Add environment variables

Use the Vercel dashboard: Project → Settings → Environment Variables. Add these to
**Production** (and Preview if you want preview deployments):

| Name | Value |
| --- | --- |
| `UPSTASH_REDIS_REST_URL` | Your Upstash REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Your Upstash REST token |
| `ROOM_SECRET` | Optional but recommended: a long random string |

If `ROOM_SECRET` is omitted, the app derives a shared signing key from the Redis
credentials, so all Function instances still accept each other's tokens.

Generate `ROOM_SECRET`:

```bash
openssl rand -hex 32
```

or in PowerShell:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Leave `TURN_URL`, `TURN_SECRET`, `TURN_USERNAME`, `TURN_CREDENTIAL` unset for the free setup.
Public STUN needs no key, and the app automatically falls back to its own HTTP relay when
WebRTC cannot connect. A TURN server is optional.

Optional: `NEXT_PUBLIC_MULTIPLAYER=1`. Leave it unset to keep the panel visible.

## 5. Deploy

```bash
git switch feat/multiplayer
npx vercel --prod
```

The CLI prints the production URL.

## 6. Verify

Open:

```text
https://YOUR-PROJECT.vercel.app/api/health
```

Expected (the exact secret source may differ):

```json
{ "ok": true, "store": { "kind": "redis" }, "mode": "serverless", "redis": true, "turn": false }
```

Then:

1. Open the Vercel URL on the host PC.
2. Click **Host room**.
3. Press <kbd>I</kbd> (or tap **INVITE**).
4. Copy the invite link or scan the QR on a phone.
5. Join on the second device.
6. Confirm the host sees the remote player move.

## Free-tier guardrails

- Upstash Free: ~250 MB, 500,000 commands/month, 10 GB bandwidth, 1 database, no card.
- Vercel Hobby: 1,000,000 function invocations and 4 CPU-hours/month.
- Rooms are capped at 6 players and expire after 2 hours.
- Close rooms when finished instead of leaving the host tab open all day.
- The host tab must remain open and visible; it runs the world.
- No TURN: same-Wi-Fi and many home networks connect directly. If WebRTC fails, the client
  falls back to the app's HTTP relay, which works through NAT but consumes Function invocations
  and adds latency. For heavy use, self-host the app instead (see docs/SELF_HOSTING.md).

## If you cannot deploy from the CLI

You can import the GitHub repository into Vercel from the dashboard:

1. Vercel → Add New → Project.
2. Import `KhaledGuemir/grasshopper`.
3. Select the branch you deployed (for example `nextversion`).
4. Add the three environment variables.
5. Deploy.

## Important

The current CLI session on this machine reported **Logged out**. Run `npx vercel login` before
deploying. Do not add a payment method to Vercel or Upstash for this personal project.
