# Deploying Shadow Hunt

There are three parts:

| Part | What it is |
|---|---|
| Web client | Static Vite build (`apps/web`) |
| Game server | Colyseus WebSocket server + REST API (`apps/server`, `@colyseus/core` + ws transport, built by the root `Dockerfile`), served under `/api` |
| Database and auth | **Supabase**: Postgres + Auth (strongly recommended in production) |

Without Supabase the server falls back to a local JSON file. That is fine for one long-lived machine. On hosts whose disk is wiped when an instance stops (including Vercel), progress is lost. Google and email sign-in also stay disabled; guests can still play.

There are two ways to host it:

| | **A. Everything on Vercel (Services)** | **B. Web on Vercel, game server elsewhere** |
|---|---|---|
| Config | Root `vercel.json` (already in the repo) | Web-only Vercel project + Railway / Render / Fly |
| Domain | One URL; `/api/*` goes to the game server | Two URLs; set `VITE_SERVER_URL` and `CORS_ORIGIN` |
| WebSockets | Closed at the Vercel Function max duration (**5 min on Hobby**, 800 s on Pro, up to 30 min in the Pro beta) | No duration limit |
| Rooms | In memory on one instance. **Measured on the live deployment (Hobby):** after the 5-minute cut, the reconnect reached a *different* instance while the original one was still running, so the room was gone. Every player loses their room about 5 minutes after joining it (lobby time included), so full 8–15 minute matches cannot finish. | One always-on process; reconnects return to the same room |
| Idle | Instance stops after 5 idle minutes (fine between sessions) | Always on |
| Best for | Trying the game out, short sessions. **Not suitable for full matches on Hobby.** | Real matches with friends (recommended) |

---

## A. Everything on Vercel (Services)

`vercel.json` at the repository root defines two services:

| Service | Root | Built as | Public path |
|---|---|---|---|
| `web` | `apps/web` | Vite static build | `/(.*)` (everything not matched above) |
| `game` | `.` | Container from the root `Dockerfile` | `/api/(.*)`: REST, matchmaking and WebSockets |

There are no service bindings. The web app is static and talks to the game server from the browser over the public `/api` route. The game server calls no other service; Supabase is external.

### Setup

1. **Import the repository** at vercel.com → *Add New → Project*. Leave the Root Directory as the repository root; Vercel reads `vercel.json` and builds both services.
2. **Environment variables** (Settings → Environment Variables, Production + Preview):

   | Variable | Value |
   |---|---|
   | `GUEST_TOKEN_SECRET` | Random 32+ characters (`openssl rand -hex 32`), marked *Sensitive*. Without it the server still runs, but signs guest tokens with a random key per instance, so guests get a new identity whenever the instance restarts. `/api/health` shows `"guestSecret":"ephemeral"` until it is set. |
   | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Recommended (see section 1). Read only by the game server. |
   | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Optional; enables Google and email sign-in |

   Do **not** set `VITE_SERVER_URL` or `CORS_ORIGIN`: the browser and the game server share one origin.
3. **Deploy.** Check `https://<production-domain>/api/health`. It returns `{"ok":true,…}` once the container is up; the first request after an idle period cold-starts it in about 1–2 s.
   - The production domain is listed under the project's **Domains**. If `<project>.vercel.app` is already taken by someone else, Vercel adds a suffix; this project got `shadow-hunt-theta.vercel.app`.
   - The team-suffixed URLs (`<project>-<team>.vercel.app`, per-deployment URLs) sit behind Vercel Authentication, so share the production domain or a custom domain with players.
4. **Supabase redirect URLs:** add the Vercel URL in Supabase → Authentication → URL Configuration.

### Local check of the same routing

`vercel dev` runs both services together and needs the Docker daemon for the `game` container. Without Docker, `pnpm dev` runs the same code: the game server on `:2567` and Vite on `:5173`.

---

## B. Web on Vercel, game server on Railway / Render / Fly

Use this when you need matches longer than the WebSocket duration limit, or more players than one instance comfortably holds.

1. Deploy the game server with the root `Dockerfile` (section 2 below).
2. In Vercel, delete the `game` service and the `/api/(.*)` rewrite from `vercel.json`, leaving only `web` behind the catch-all rewrite.
3. Set `VITE_SERVER_URL=https://<your-game-server>` in Vercel and `CORS_ORIGIN=https://<your-vercel-domain>` on the game server.

---

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

Use **New → Blueprint** and point it at the repository. `render.yaml` creates the service and generates `GUEST_TOKEN_SECRET`. Fill in `CORS_ORIGIN`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Choose a paid instance: free instances sleep, and a sleeping server drops every live match.

### Fly.io

```bash
fly launch --no-deploy          # accept the existing fly.toml
fly secrets set GUEST_TOKEN_SECRET=$(openssl rand -hex 32) CORS_ORIGIN=https://<your-app>.vercel.app \
  SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=…
fly deploy
```

`fly.toml` keeps one machine always running (`auto_stop_machines = "off"`). Pick a `primary_region` close to your players. It is set to `bom` (Mumbai) by default.

## 3. Web client only (Vercel, option B)

1. **New Project**: import the repository. Keep the root `vercel.json` with only the `web` service; it installs from the monorepo root and outputs `apps/web/dist`.
2. Set the environment variables:
   - `VITE_SERVER_URL` = `https://<your-game-server-domain>`. WebSockets automatically use `wss://`.
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
