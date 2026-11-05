# Deploying Shadow Hunt

There are three parts:

| Part | What it is |
|---|---|
| Web client | Static Vite build (`apps/web`) |
| Game server | Colyseus WebSocket server + REST API (`apps/server`, `@colyseus/core` + ws transport, built by the root `Dockerfile`), served under `/api` |
| Database and auth | **Supabase**: Postgres + Auth (strongly recommended in production) |

Without Supabase the server falls back to a local JSON file. That is fine for one long-lived machine. On hosts whose disk is wiped when an instance stops (including Vercel), progress is lost. Google and email sign-in also stay disabled; guests can still play.

## Current production setup

| Part | Host | URL |
|---|---|---|
| Website (`web` service in `vercel.json`) | Vercel (Hobby) | https://shadow-hunt-theta.vercel.app |
| Game server (root `Dockerfile`, `render.yaml`) | Render (free, Singapore) | https://shadowhunt-server.onrender.com |
| Database | none yet; add Supabase to keep progress | |

The website is built with `VITE_SERVER_URL` from `apps/web/.env.production` (public config, compiled into the bundle). The browser calls the game server directly: REST at `/api/*`, matchmaking at `/api/matchmake/*`, and the WebSocket at `wss://…/api/<process>/<room>`. The game server only accepts browser requests from the Vercel domains listed in `CORS_ORIGIN` (`render.yaml`).

**Free-tier behaviour:**
- Render spins the game server down after 15 minutes with no traffic, and the next visitor waits about a minute while it wakes. The menu shows "The game server is starting up…" during that time.
- WebSocket traffic during a match keeps it awake, and there is no connection time limit.
- Its disk is wiped on spin-down, so profiles and XP reset unless Supabase is configured (section 1). Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the Render dashboard.

### Why the game server is not on Vercel

The first deployment ran everything on Vercel Services (website + game server as a `container` service behind `/api/(.*)`). A live test on Hobby showed:

- Vercel closes each WebSocket about 300 s after it opens (the Function max duration).
- The client reconnects immediately, but the reconnect is routed to a **different instance** while the original one is still running.
- The room lives only in the original instance's memory, so the player is out of the match about 5 minutes after joining. Full 8–15 minute matches cannot finish.

Pro raises the limit (800 s, or 30 min in beta) but the reconnect problem stays. To try that setup anyway, add back to `vercel.json`:

```json
"game": { "root": ".", "framework": "container", "runtime": "container", "entrypoint": "Dockerfile" }
```

Add `{ "source": "/api/(.*)", "destination": { "service": "game" } }` before the catch-all rewrite, delete `apps/web/.env.production`, and leave `CORS_ORIGIN` unset (same origin).

---

## Setting it up from scratch

1. **Game server on Render.** Go to *New → Blueprint* and pick the repository. `render.yaml` creates `shadowhunt-server` (free, Docker, health check `/api/health`), generates `GUEST_TOKEN_SECRET`, and sets `CORS_ORIGIN` to the Vercel domains. Edit `CORS_ORIGIN` if your Vercel domain differs.
2. **Website on Vercel.** Go to *Add New → Project*, import the repository, and keep the Root Directory as `./`. `vercel.json` builds the `web` service. Point `apps/web/.env.production` at your Render URL. You can also set `VITE_SERVER_URL` in Vercel's environment variables, which takes precedence.
3. **Optional:** Supabase (section 1). Add its server variables on Render and `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` on Vercel.
4. **Share the production domain.** The team-suffixed Vercel URLs (`<project>-<team>.vercel.app` and per-deployment URLs) sit behind Vercel Authentication. If `<project>.vercel.app` is taken, Vercel adds a suffix (this project got `shadow-hunt-theta.vercel.app`).

## 1. Supabase

1. Create a project at supabase.com.
2. Apply the schema by running `supabase/migrations/20261104000000_initial_schema.sql`. Either paste it into the **SQL Editor**, or use the CLI:
   ```bash
   supabase link --project-ref <ref>
   supabase db push
   ```
3. **Settings → API** shows three values:
   - Project URL → `SUPABASE_URL` (server) and `VITE_SUPABASE_URL` (web)
   - `anon` public key → `VITE_SUPABASE_ANON_KEY` (web)
   - `service_role` secret → `SUPABASE_SERVICE_ROLE_KEY`. Put this one on the **server only**, never in the web app.
4. Turn on sign-in methods:
   - **Email:** under **Authentication → Providers → Email**, enable it. The magic-link flow uses OTP.
   - **Google:** under **Authentication → Providers → Google**, enable it. Create an OAuth client in Google Cloud Console, add the Supabase callback URL it shows, and paste the client ID and secret.
   - **Redirect URLs:** under **Authentication → URL Configuration**, add your Vercel URL (for example `https://shadow-hunt.vercel.app`) to *Site URL* and *Redirect URLs*.

Row-level security is enabled on every table. Players may only `select` their own rows. Every write goes through the game server using the service role.

## 2. Game server

The Dockerfile at the repository root builds the server image:

```bash
docker build -t shadow-hunt-server .
docker run -p 2567:2567 --env-file apps/server/.env shadow-hunt-server
```

Environment variables (see `apps/server/.env.example`):

| Variable | Required | Notes |
|---|---|---|
| `GUEST_TOKEN_SECRET` | **yes** | Random, 32+ characters. Without it, guest sessions reset whenever the server restarts. Changing it logs out all guests. |
| `CORS_ORIGIN` | **yes** | Your web origin(s), comma separated, e.g. `https://shadow-hunt.vercel.app` |
| `SUPABASE_URL` | recommended | Enables Supabase persistence and account sign-in |
| `SUPABASE_SERVICE_ROLE_KEY` | recommended | Server only |
| `PORT` | no | Defaults to 2567; most hosts inject it |
| `NODE_ENV` | no | Set to `production` for JSON logs and strict secrets |

Generate a secret with `openssl rand -hex 32`.

Health check: `GET /api/health` returns `{"ok":true,"store":"supabase",…}`.

The image listens on port 80 by default (what Vercel expects). Railway, Render and Fly inject their own `PORT`.

### Railway

1. Create a New Project from your GitHub repository. `railway.json` selects the Dockerfile.
2. Add the variables above.
3. Under **Settings → Networking**, generate a domain, for example `shadow-hunt-server.up.railway.app`.
4. Keep the service at **1 replica**. Rooms are in memory, so multiple replicas need Redis (see ARCHITECTURE.md).

### Render

Go to **New → Blueprint** and point it at the repository. `render.yaml` creates `shadowhunt-server` on the free plan, generates `GUEST_TOKEN_SECRET` and sets `CORS_ORIGIN`. Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the dashboard to keep progress.

The free plan sleeps after 15 idle minutes and takes about a minute to wake. If you want it always on with no wake-up wait, switch to a paid instance (*Starter*).

### Fly.io

```bash
fly launch --no-deploy          # accept the existing fly.toml
fly secrets set GUEST_TOKEN_SECRET=$(openssl rand -hex 32) CORS_ORIGIN=https://<your-app>.vercel.app \
  SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=…
fly deploy
```

`fly.toml` keeps one machine always running (`auto_stop_machines = "off"`). Pick a `primary_region` close to your players. It is set to `bom` (Mumbai) by default.

## 3. Web client (Vercel)

1. **New Project**: import the repository. The root `vercel.json` defines the `web` service; it installs from the monorepo root and outputs `apps/web/dist`.
2. Set the environment variables:
   - `VITE_SERVER_URL` = `https://<your-game-server-domain>`. This is already set in `apps/web/.env.production`; a Vercel variable overrides it. WebSockets automatically use `wss://`.
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. These are optional; without them the Profile page shows guest-only play.
3. Deploy. Then put the Vercel URL into the server's `CORS_ORIGIN` and into Supabase's redirect URLs.

## 4. Smoke test in production

1. Open the site and confirm the menu shows your guest profile. That proves the HTTP API and CORS work.
2. **Create Room**, copy the invite link, and open it on a phone. You should see both players in the lobby, which proves WebSockets work.
3. Set **Hunter → Bot** and start a match.
4. After it ends, check **Statistics**. The match should be listed and XP added, which proves persistence works.
5. In Supabase, confirm rows exist in `profiles`, `matches` and `match_players`.

## Operations notes

- **Deploys:** a deploy restarts the server and ends live matches. Deploy between sessions.
- **Logs:** they are JSON lines (`level`, `msg`, …) when `NODE_ENV=production`.
- **Rate limits:**
  - 240 API requests per minute per IP.
  - 20 guest creations per minute per IP.
  - 90 room messages per second per client.
- **Audio:** the 38 WAV files (about 3.8 MB) are generated at build time by `apps/web/scripts/gen-audio.mjs`. Vercel caches them for a week.
