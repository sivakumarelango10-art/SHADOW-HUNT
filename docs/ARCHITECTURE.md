# Architecture

```
 Browser (React + R3F)                    Game server (Node + Colyseus)              Supabase
 ┌───────────────────────┐   WebSocket    ┌──────────────────────────────┐  service   ┌──────────┐
 │ input → prediction    │ ── inputs ───▶ │ ShadowHuntRoom (lobby, life) │ ── role ──▶│ Postgres │
 │ interpolation ← state │ ◀── patches ── │ Game (30 Hz authoritative)   │            │ Auth     │
 │ HUD / audio ← events  │ ◀── messages ─ │ Bot hunter, results, XP      │            └──────────┘
 │ REST (profile, …)     │ ── HTTPS ────▶ │ Express routes + rate limits │
 └───────────────────────┘                └──────────────────────────────┘
          ▲                                        ▲
          └────────── packages/shared ─────────────┘
             maps · collision · movement · interactions · rules · types
```

## Authority

The server owns every rule that matters. The client never declares an outcome. It sends:

| Message | Meaning |
|---|---|
| `input` | Batches of `{seq, dt, mx, mz, yaw, pitch, sprint, crouch}` |
| `interact` / `interactStop` | Start or stop an interaction with `{kind, id}` |
| `attack` | Hunter swing, with the attacker's view delay used for lag compensation |
| `ability` / `roar` | Hunter powers |
| `flashlight` / `useItem` | Survivor tools |
| `skillCheck` | `{id, ratio}`: where the needle was when the player pressed |

For each message the server does the following:

- **Movement.** It simulates movement with the same `stepMovement` the client predicts with (`packages/shared/src/sim`). Each player has a *time budget*: it grows with real elapsed time (capped at 350 ms), and every input spends its `dt`. Input that claims more time than has passed is dropped. That defeats speed hacks. Positions are never accepted from clients, so teleporting is impossible by construction.
- **Interactions.** It re-runs the shared `getInteractions()` rules with a small range tolerance before starting an action. It then re-validates every tick, which cancels the action if the target, range or state stops being valid. Durations, cooldowns and timers are server clocks.
- **Combat.** Hunter attacks check the cooldown, action state, a 55° cone, the range and line of sight against walls and furniture. They use **server-side rewind**: survivor positions are kept for about 1.5 s and tested at `now − min(viewDelay, 250 ms)`. That is fair to the attacker without letting them reach far into the past.
- **Condition changes.** Every change goes through the state machine (`stateMachine.ts`). Illegal transitions are rejected and logged.
- **Skill checks.** The server issues them and decides the result. A reported needle ratio is accepted only if the needle could actually have reached it, given the time since the check was sent.
- **Match end.** Results, XP and achievements are computed on the server from its own per-player stats and persisted there. The result is broadcast once, so every client sees identical results.
- **Rate limits.** Colyseus `maxMessagesPerSecond` limits room messages, a per-IP fixed window limits HTTP requests, and lobby chat is throttled and sanitized.

## Replication and networking

- **State patches.** Colyseus schema (`apps/server/src/rooms/schema.ts`) sends *delta patches* at 20 Hz (`patchRate` 50 ms), never full snapshots. The simulation ticks at 30 Hz.
- **Client-side prediction.** The local player moves instantly. On each patch the client rewinds to the authoritative position, drops acknowledged inputs (`lastSeq`) and replays the rest. Any remaining error is blended out over about 80 ms so corrections never snap the camera. Frames slower than 100 ms are split into several inputs so low-FPS devices still move at full speed.
- **Interpolation.** Remote players are rendered about 110 ms in the past, between buffered snapshots. Teleports (cages, hatches, Shadow Step) clear the buffer instead of smearing across the map.
- **Events.** One-shot events go through a small typed bus to the 3D effects, the audio and the HUD:
  - `fx` is broadcast.
  - `noise`, `track` and `reveal` go only to the Hunter, jittered.
  - `skillCheck` goes only to the repairer.

## Rooms and lobbies

- **Room codes.** Codes are 6 characters from a 30-letter alphabet with no confusable glyphs (about 729 M combinations). They are generated with `crypto.randomInt` and used as the Colyseus `roomId`. Invite links are `/?room=CODE`.
- **Private rooms and Quick Match.** Private rooms call `setPrivate(true)`. Quick Match uses `joinOrCreate` with `filterBy(['mode'])`, so it can never land in a private room. Rooms are locked during matches and unlocked when they return to the lobby.
- **Reconnection.**
  - The server's `onDrop` calls `allowReconnection(client, 45 s)` in a match or 15 s in the lobby. The seat, character and position are kept.
  - The SDK reconnects automatically after a network blip.
  - After a full page reload, the reconnection token in `sessionStorage` restores the same seat.
- **Leaving.** A survivor who leaves for good is eliminated. A Hunter who leaves is replaced by the bot so the match can finish. The host role transfers automatically.

## Identity and persistence

- **Guests.** `POST /api/auth/guest` creates a profile and returns `g1.<payload>.<HMAC>`. The token is HMAC-signed with `GUEST_TOKEN_SECRET`, so one guest cannot impersonate another.
- **Accounts.** These use Supabase Auth (Google OAuth or an email magic link). The client sends `sb.<access token>`, and the server verifies it with `auth.getUser()`, with a 60 s cache.
- **Storage.** The `Store` interface has two implementations:
  - `SupabaseStore` uses the service-role key, on the server only.
  - `FileStore` uses a local JSON file for development.

  The schema and RLS live in `supabase/migrations`. Browsers never touch the database directly.

## Rendering

- **Static map geometry** is merged per material. Trees, rocks, pillars and grass are `InstancedMesh`es, so about 470 trees cost a few draw calls. Textures are procedural canvases, with roughness maps for wet patches. No external assets are downloaded.
- **Practical lights** use a fixed-size pool of 3, 5 or 8 point lights depending on quality. The pool is reassigned to the nearest fixtures, so the number of lights in the shaders never changes and nothing recompiles mid-game.
- **Characters** are procedural articulated rigs (`game/characters/rig.ts`). The `Rig` interface (`root`, `hand`, `arm`, `update(pose, dt)`) is where a skinned glTF character with an `AnimationMixer` can replace them without touching gameplay code.
- **Post-processing** (bloom, chromatic aberration that scales with terror, grain, vignette) is enabled only on the high preset.

## Bot hunter

The bot (`apps/server/src/game/Bot.ts`) builds a 1 m navigation grid with A* pathfinding and hatch links. It plays by human rules:

- It sends inputs through the same validation as a player.
- It hears only the jittered noise a human Hunter would.
- It sees survivors only when it has line of sight within a field of view.

It chases, attacks, captures, investigates noises, searches lockers, kicks generators, breaks pallets and opens doors when stuck. It uses its character's power.

## Known limits of the design

- **Positions are visible in the data.** All player positions are replicated to every client, and the Hunter's client hides survivors only through fog and occlusion. A modified client could read survivor positions. The fix is interest management with Colyseus `StateView` (send survivor positions to the Hunter only within range or line of sight). It is not implemented yet.
- **Single process.** Rooms and presence live in memory in one process. To scale horizontally, add `RedisPresence` and the Redis driver (both ship with Colyseus) and a sticky load balancer.
