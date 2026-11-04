# Deploying Shadow Hunt

There are three parts:

| Part | What it is | Where it goes |
|---|---|---|
| Web client | Static site | **Vercel** |
| Game server | Persistent WebSocket Node process | **Railway**, **Render** or **Fly.io**. Not Vercel functions: rooms live in server memory and need long-lived sockets. |
| Database and auth | Postgres and Auth | **Supabase** (optional but recommended) |

Without Supabase the server falls back to a local JSON file. That works on a single machine with a persistent disk, but progress is lost on hosts with ephemeral filesystems. Google and email sign-in also stay disabled; guests can still play.

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
| `GUEST_TOKEN_SECRET` | **yes** | Random, 32+ characters. The server refuses to start in production without it. Changing it logs out all guests. |
| `CORS_ORIGIN` | **yes** | Your web origin(s), comma separated, e.g. `https://shadow-hunt.vercel.app` |
| `SUPABASE_URL` | recommended | Enables Supabase persistence and account sign-in |
| `SUPABASE_SERVICE_ROLE_KEY` | recommended | Server only |
| `PORT` | no | Defaults to 2567; most hosts inject it |
| `NODE_ENV` | no | Set to `production` for JSON logs and strict secrets |

Generate a secret with `openssl rand -hex 32`.

Health check: `GET /api/health` returns `{"ok":true,"store":"supabase",…}`.

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

## 3. Web client (Vercel)

1. **New Project**: import the repository and set **Root Directory** to `apps/web`. `apps/web/vercel.json` installs from the monorepo root and outputs `dist`.
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
