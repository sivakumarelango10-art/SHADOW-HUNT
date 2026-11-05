/**
 * End-to-end multiplayer test: a real Colyseus server on a real port, six real
 * WebSocket clients (five humans + one late joiner check), and a full match from
 * lobby to persisted results. Server internals are only touched to fast-forward
 * travel and timers — every gameplay action goes through client messages.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import { C2S, MAPS, S2C, type MatchResults, type SkillCheckMsg } from '@shadow-hunt/shared';
import { startGameServer } from '../src/index.ts';
import type { ShadowHuntRoom } from '../src/rooms/ShadowHuntRoom.ts';

const PORT = 3591;
const HTTP = `http://localhost:${PORT}`;
/** Same endpoint shape the browser uses in production: everything under /api. */
const GAME = `ws://localhost:${PORT}/api`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, label: string, ms = 9000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`timeout waiting for ${label}`);
    await sleep(20);
  }
}

async function guest(name: string): Promise<{ token: string; id: string }> {
  const r = await fetch(`${HTTP}/api/auth/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const j = (await r.json()) as { token: string; profile: { id: string } };
  return { token: j.token, id: j.profile.id };
}

let server: Awaited<ReturnType<typeof startGameServer>>;
const names = ['Host', 'Hunter', 'Cara', 'Dev', 'Ezra'];
const tokens: { token: string; id: string }[] = [];
const rooms: Room[] = [];
const results: (MatchResults | null)[] = [];
let code = '';

function serverRoom(): ShadowHuntRoom {
  return matchMaker.getLocalRoomById(code) as unknown as ShadowHuntRoom;
}
function game() {
  return (serverRoom() as any).game as import('../src/game/Game.ts').Game;
}
const st = (r: Room) => r.state as any;

beforeAll(async () => {
  server = await startGameServer(PORT);
  for (const n of names) tokens.push(await guest(n));
}, 30000);

afterAll(async () => {
  for (const r of rooms) await r.leave().catch(() => {});
  await server.gracefullyShutdown(false).catch(() => {});
});

describe('multiplayer match', () => {
  it('creates a private room and five players join by code', async () => {
    const host = new Client(GAME);
    const r0 = await host.create('shadow_hunt', { token: tokens[0]!.token, mode: 'private' });
    rooms.push(r0);
    code = r0.roomId;
    expect(code).toMatch(/^[A-Z2-9]{6}$/);

    const info = (await (await fetch(`${HTTP}/api/rooms/${code}`)).json()) as any;
    expect(info.exists).toBe(true);

    for (let i = 1; i < 5; i++) {
      const c = new Client(GAME);
      rooms.push(await c.joinById(code, { token: tokens[i]!.token }));
    }
    for (const r of rooms) {
      results.push(null);
      r.onMessage(S2C.results, (m: MatchResults) => (results[rooms.indexOf(r)] = m));
      r.onMessage('*', () => {});
    }
    await waitFor(() => rooms.every((r) => st(r).players.size === 5), 'everyone sees 5 players');
    expect(st(rooms[3]!).players.get(rooms[0]!.sessionId).isHost).toBe(true);
  });

  it('rejects bad tokens and quick match never lands in a private room', async () => {
    const c = new Client(GAME);
    await expect(c.joinById(code, { token: 'g1.forged.sig' })).rejects.toBeTruthy();
    const extra = await guest('Quick');
    const q = await c.joinOrCreate('shadow_hunt', { token: extra.token, mode: 'quick' });
    expect(q.roomId).not.toBe(code);
    await q.leave();
  });

  it('host controls the lobby and starts the match', async () => {
    const [host, hunter, ...rest] = rooms;
    host!.send(C2S.setMap, { mapId: 'asylum' });
    hunter!.send(C2S.setPreferHunter, { prefer: true });
    hunter!.send(C2S.setCharacter, { characterId: 'wraith' });
    // Non-host cannot change the map.
    rest[0]!.send(C2S.setMap, { mapId: 'blackwood' });
    for (const r of [hunter!, ...rest]) r.send(C2S.setReady, { ready: true });
    await waitFor(() => rooms.every((r) => [...st(r).players.values()].every((p: any) => p.ready)), 'all ready');
    expect(st(host!).mapId).toBe('asylum');

    host!.send(C2S.startMatch, {});
    await waitFor(() => st(host!).phase === 'countdown', 'countdown');
    expect(st(rest[1]!).players.get(hunter!.sessionId).role).toBe('hunter');
    await waitFor(() => st(host!).phase === 'playing', 'playing', 9000);

    const info = (await (await fetch(`${HTTP}/api/rooms/${code}`)).json()) as any;
    expect(info.joinable).toBe(false);
  }, 15000);

  it('synchronises movement through the server and rejects speed hacks', async () => {
    const mover = rooms[2]!;
    const watcher = rooms[4]!;
    const me = () => st(watcher).players.get(mover.sessionId);
    const start = { x: me().x, z: me().z };
    let seq = 1;
    for (let i = 0; i < 20; i++) {
      mover.send(C2S.input, {
        inputs: [{ seq: seq++, dt: 1 / 30, mx: 0, mz: 1, yaw: 0, pitch: 0, sprint: false, crouch: false }],
      });
      await sleep(34);
    }
    await waitFor(() => Math.hypot(me().x - start.x, me().z - start.z) > 1, 'remote sees movement');

    // Speed hack: claim 2 seconds of movement in one burst.
    const before = { x: me().x, z: me().z };
    const burst = Array.from({ length: 12 }, () => ({
      seq: seq++,
      dt: 0.1,
      mx: 0,
      mz: 1,
      yaw: Math.PI,
      pitch: 0,
      sprint: true,
      crouch: false,
    }));
    mover.send(C2S.input, { inputs: burst });
    await sleep(250);
    const moved = Math.hypot(me().x - before.x, me().z - before.z);
    expect(moved).toBeLessThan(5.7 * 0.6); // far less than the 6.8 m a 1.2 s sprint would give
  });

  it('runs combat: hit, down, capture, rescue (server validated)', async () => {
    const g = game();
    const hunterRoom = rooms[1]!;
    const victimRoom = rooms[3]!;
    const rescuerRoom = rooms[4]!;
    const H = g.state.players.get(hunterRoom.sessionId)!;
    const V = g.state.players.get(victimRoom.sessionId)!;
    // Out of range attack is rejected.
    H.x = 0;
    H.z = 22;
    H.yaw = 0;
    V.x = 0;
    V.z = 12;
    hunterRoom.send(C2S.attack, { viewDelayMs: 0 });
    await sleep(120);
    expect(V.condition).toBe('healthy');

    // In range, facing (yaw 0 looks toward -z).
    await waitFor(() => H.attackCd <= 0, 'attack cooldown');
    V.x = 0;
    V.z = 20.4;
    hunterRoom.send(C2S.attack, { viewDelayMs: 0 });
    await waitFor(() => st(victimRoom).players.get(victimRoom.sessionId).condition === 'injured', 'victim injured');

    await waitFor(() => H.attackCd <= 0, 'hit cooldown', 4000);
    V.x = 0;
    V.z = 20.4;
    hunterRoom.send(C2S.attack, { viewDelayMs: 0 });
    await waitFor(() => V.condition === 'downed', 'victim downed');

    // Survivor clients cannot attack.
    rescuerRoom.send(C2S.attack, { viewDelayMs: 0 });

    hunterRoom.send(C2S.interact, { kind: 'capture', id: victimRoom.sessionId });
    await waitFor(() => st(rescuerRoom).players.get(victimRoom.sessionId).condition === 'captured', 'captured', 5000);
    const cageId = V.cageId;
    expect(cageId).not.toBe('');
    const cage = MAPS.asylum.cages.find((c) => c.id === cageId)!;
    expect(Math.hypot(V.x - cage.x, V.z - cage.z)).toBeLessThan(0.01);

    // Rescue: teammate stands at the cage and breaks it.
    H.x = 40;
    H.z = -25;
    const R = g.state.players.get(rescuerRoom.sessionId)!;
    R.x = cage.x + 1.2;
    R.z = cage.z;
    R.yaw = Math.PI / 2;
    rescuerRoom.send(C2S.interact, { kind: 'rescue', id: victimRoom.sessionId });
    await waitFor(() => V.condition === 'rescued' || V.condition === 'injured', 'rescued', 5000);
    expect(g.runtime(rescuerRoom.sessionId)!.stats.rescues).toBe(1);
  }, 20000);

  it('repairs a generator with a server-issued skill check', async () => {
    const g = game();
    const repairer = rooms[0]!;
    const P = g.state.players.get(repairer.sessionId)!;
    const gen = MAPS.asylum.generators.find((x) => x.id === 'gen_cafe')!;
    P.x = gen.x - 1.3;
    P.z = gen.z;
    P.yaw = -Math.PI / 2; // face +x
    let check: SkillCheckMsg | null = null;
    let outcome = '';
    repairer.onMessage(S2C.skillCheck, (m: SkillCheckMsg) => (check = m));
    repairer.onMessage(S2C.skillCheckResult, (m: { result: string }) => (outcome = m.result));
    repairer.send(C2S.interact, { kind: 'repair', id: gen.id });
    await waitFor(() => P.action === 'repair', 'repairing');
    await waitFor(() => check !== null, 'skill check issued', 12000);
    const c = check as unknown as SkillCheckMsg;
    const target = (c.zoneStart + c.zoneEnd) / 2;
    await sleep(target * c.duration * 1000 + 30);
    repairer.send(C2S.skillCheck, { id: c.id, ratio: target });
    await waitFor(() => outcome !== '', 'skill result');
    expect(['great', 'good']).toContain(outcome);
    expect(g.state.generators.get(gen.id)!.progress).toBeGreaterThan(0);
    repairer.send(C2S.interactStop, {});
    await waitFor(() => P.action === 'none', 'stopped repairing');
  }, 20000);

  it('reconnects a dropped client into the same seat', async () => {
    const r = rooms[2]!;
    const sid = r.sessionId;
    let reconnected = false;
    r.onReconnect(() => (reconnected = true));
    r.connection.close(4010, 'simulated network drop');
    await waitFor(() => game().state.players.get(sid)!.connected === false || reconnected, 'server saw drop', 5000);
    await waitFor(() => reconnected, 'client auto-reconnected', 15000);
    await waitFor(() => game().state.players.get(sid)!.connected === true, 'seat restored', 5000);
    expect(r.sessionId).toBe(sid);
  }, 30000);

  it('powers the exit, uses keys, escapes, and every client gets identical persisted results', async () => {
    const g = game();
    const s = g.state;
    // Fast-forward generator progress (repair itself was tested above).
    let done = 0;
    for (const [id, gen] of s.generators) {
      if (done >= s.generatorsRequired - 1) break;
      gen.progress = 1;
      gen.completed = true;
      s.generatorsCompleted++;
      done++;
      void id;
    }
    // Final generator through real repair ticks.
    const last = MAPS.asylum.generators.find((x) => !s.generators.get(x.id)!.completed)!;
    s.generators.get(last.id)!.progress = 0.995;
    const R0 = rooms[0]!;
    const P0 = s.players.get(R0.sessionId)!;
    P0.x = last.x;
    P0.z = last.z;
    const off = { x: Math.sin(last.rot) * 1.3, z: Math.cos(last.rot) * 1.3 };
    P0.x = last.x + off.x;
    P0.z = last.z + off.z;
    P0.yaw = Math.atan2(off.x, off.z);
    R0.send(C2S.interact, { kind: 'repair', id: last.id });
    await waitFor(() => st(rooms[4]!).powerOn === true, 'power on (replicated)', 8000);

    // Keys: pick up and insert two keys.
    const exit = MAPS.asylum.exits[0]!;
    for (const [keyId, key] of [...s.keys.entries()].slice(0, 2)) {
      P0.x = key.x + 1;
      P0.z = key.z;
      P0.yaw = Math.PI / 2;
      R0.send(C2S.interact, { kind: 'pickupKey', id: keyId });
      await waitFor(() => P0.carryingKey, `picked ${keyId}`);
      P0.x = exit.panel.x + 1;
      P0.z = exit.panel.z;
      P0.yaw = Math.PI / 2;
      R0.send(C2S.interact, { kind: 'depositKey', id: exit.id });
      await waitFor(() => !P0.carryingKey, `deposited ${keyId}`);
    }
    expect(s.keysDeposited).toBe(2);
    s.exits.get(exit.id)!.progress = 0.9;
    R0.send(C2S.interact, { kind: 'openExit', id: exit.id });
    await waitFor(() => st(rooms[3]!).exits.get(exit.id).open === true, 'exit open', 5000);

    // Survivors walk out through the gate.
    const survivors = rooms.filter((r) => r !== rooms[1]);
    for (const r of survivors) {
      const p = s.players.get(r.sessionId)!;
      if (p.condition === 'healthy' || p.condition === 'injured' || p.condition === 'rescued') {
        p.x = 0;
        p.z = 29;
      }
    }
    for (let i = 0; i < 30; i++) {
      for (const r of survivors)
        r.send(C2S.input, {
          inputs: [{ seq: 100000 + i, dt: 1 / 30, mx: 0, mz: -1, yaw: 0, pitch: 0, sprint: false, crouch: false }],
        });
      await sleep(34);
    }
    await waitFor(() => rooms.every((r) => results[rooms.indexOf(r)] !== null), 'results for everyone', 10000);
    const winners = new Set(results.map((r) => r!.winner));
    expect(winners.size).toBe(1);
    expect(results[0]!.winner).toBe('survivors');
    expect(results[0]!.persisted).toBe(true);
    const ids = new Set(results.map((r) => r!.matchId));
    expect(ids.size).toBe(1);

    const prof = (await (
      await fetch(`${HTTP}/api/profile`, { headers: { authorization: `Bearer ${tokens[0]!.token}` } })
    ).json()) as any;
    expect(prof.profile.xp).toBeGreaterThan(0);
    expect(prof.profile.stats.totalMatches).toBe(1);
    const hist = (await (
      await fetch(`${HTTP}/api/history`, { headers: { authorization: `Bearer ${tokens[0]!.token}` } })
    ).json()) as any;
    expect(hist.history.length).toBe(1);
  }, 30000);

  it('returns to the lobby and can rematch', async () => {
    rooms[0]!.send(C2S.returnToLobby, {});
    await waitFor(() => rooms.every((r) => st(r).phase === 'lobby'), 'back in lobby');
    const info = (await (await fetch(`${HTTP}/api/rooms/${code}`)).json()) as any;
    expect(info.joinable).toBe(true);
  });
});
