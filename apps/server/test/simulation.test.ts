/**
 * Headless simulation tests: drive the authoritative Game directly (no sockets)
 * at a fixed tick to exercise rules that are slow to reach through real clients.
 */
import { describe, expect, it } from 'vitest';
import { MAPS, NET, OBJECTIVES, type MapId, type MoveInput } from '@shadow-hunt/shared';
import { Game, type RoomApi } from '../src/game/Game.ts';
import { GameState, PlayerState } from '../src/rooms/schema.ts';

interface Sent {
  to: string;
  type: string;
  msg: any;
}

function setup(mapId: MapId, survivors: number, botHunter: boolean) {
  const state = new GameState();
  state.mapId = mapId;
  state.matchMinutes = 12;
  const sent: Sent[] = [];
  const api: RoomApi = {
    send: (to, type, msg) => sent.push({ to, type, msg }),
    broadcast: (type, msg) => sent.push({ to: '*', type, msg }),
  };
  for (let i = 0; i < survivors; i++) {
    const p = new PlayerState();
    p.sessionId = `s${i}`;
    p.name = `S${i}`;
    p.survivorChar = 'alex';
    state.players.set(p.sessionId, p);
  }
  let hunterId: string | null = null;
  let bot: PlayerState | null = null;
  if (botHunter) {
    bot = new PlayerState();
    bot.sessionId = 'bot';
    bot.name = 'Bot';
    bot.isBot = true;
    bot.hunterChar = 'butcher';
  } else {
    const h = new PlayerState();
    h.sessionId = 'h';
    h.name = 'H';
    h.hunterChar = 'wraith';
    state.players.set('h', h);
    hunterId = 'h';
  }
  const game = new Game(api, state, mapId);
  let winner: string | null = null;
  game.onEnd = (w) => (winner = w);
  game.setup(hunterId, bot);
  state.phase = 'playing';
  const dt = NET.tickMs / 1000;
  const run = (seconds: number, each?: () => void) => {
    for (let t = 0; t < seconds; t += dt) {
      each?.();
      game.update(dt);
      if (game.ended) break;
    }
  };
  return { game, state, sent, run, winner: () => winner };
}

describe('server simulation', () => {
  it('bot hunter hunts down idle survivors and wins', () => {
    const { game, state, run, winner } = setup('asylum', 2, true);
    // Put survivors somewhere the bot will find quickly.
    const s0 = state.players.get('s0')!;
    const s1 = state.players.get('s1')!;
    s0.x = 0;
    s0.z = -4;
    s1.x = 2;
    s1.z = -4;
    run(400);
    const bot = state.players.get('bot')!;
    expect(game.runtime('bot')!.stats.hits).toBeGreaterThan(0);
    expect(game.runtime('bot')!.stats.captures).toBeGreaterThan(0);
    expect(['downed', 'captured', 'eliminated']).toContain(s0.condition);
    expect(bot.role).toBe('hunter');
    if (game.ended) expect(winner()).toBe('hunter');
  }, 60000);

  it('rejects inputs that claim more time than has passed', () => {
    const { game, state } = setup('blackwood', 1, false);
    const s = state.players.get('s0')!;
    const start = { x: s.x, z: s.z };
    const flood: MoveInput[] = Array.from({ length: 12 }, (_, i) => ({
      seq: i + 1,
      dt: 0.1,
      mx: 0,
      mz: 1,
      yaw: s.yaw,
      pitch: 0,
      sprint: false,
      crouch: false,
    }));
    game.queueInputs('s0', flood);
    game.update(NET.tickMs / 1000);
    // Only the first tick's worth of budget can be spent.
    expect(Math.hypot(s.x - start.x, s.z - start.z)).toBeLessThan(0.4);
  });

  it('hiding has a time limit and breathing gives you away', () => {
    const { game, state, sent, run } = setup('asylum', 1, false);
    const s = state.players.get('s0')!;
    const h = state.players.get('h')!;
    const locker = MAPS.asylum.lockers[0]!;
    s.x = locker.x + Math.sin(locker.rot) * 1.0;
    s.z = locker.z + Math.cos(locker.rot) * 1.0;
    s.yaw = locker.rot; // facing back at the locker
    h.x = locker.x + 4;
    h.z = locker.z; // within breathing earshot
    game.requestInteract('s0', 'hide', locker.id);
    run(1);
    expect(s.hiddenIn).toBe(locker.id);
    run(OBJECTIVES.hideQuietSeconds + 3);
    expect(sent.some((m) => m.to === 'h' && m.type === 'noise' && m.msg.kind === 'breath')).toBe(true);
    run(OBJECTIVES.hideMaxSeconds);
    expect(s.hiddenIn).toBe('');
  });

  it('dropping a pallet on the hunter stuns them', () => {
    const { game, state, run } = setup('asylum', 1, false);
    const pal = MAPS.asylum.pallets.find((p) => p.id === 'pal2')!; // central corridor, axis z
    const s = state.players.get('s0')!;
    const h = state.players.get('h')!;
    s.x = pal.x + 1.2;
    s.z = pal.z;
    s.yaw = Math.PI / 2; // facing -x towards the pallet
    h.x = pal.x - 0.2;
    h.z = pal.z;
    game.requestInteract('s0', 'pallet', pal.id);
    run(0.6);
    expect(state.pallets.get(pal.id)).toBe('down');
    expect(h.action === 'stunned' || game.runtime('h')!.stunUntil > game.time).toBe(true);
    expect(game.runtime('s0')!.stats.palletsStunned).toBe(1);
  });

  it('timer expiry ends the match for the hunter', () => {
    const { state, run, winner } = setup('blackwood', 2, false);
    state.timeLeft = 1;
    run(2);
    expect(winner()).toBe('hunter');
    for (const p of state.players.values()) if (p.role === 'survivor') expect(p.condition).toBe('eliminated');
  });

  it('a hunter who disconnects is replaced by a bot', () => {
    const { game, state, run } = setup('blackwood', 1, false);
    game.abandon('h');
    const h = state.players.get('h')!;
    expect(h.isBot).toBe(true);
    const before = { x: h.x, z: h.z };
    run(6);
    expect(Math.hypot(h.x - before.x, h.z - before.z)).toBeGreaterThan(2);
  });
});
