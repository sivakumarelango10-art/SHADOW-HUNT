import { describe, expect, it } from 'vitest';
import {
  MAPS,
  MAP_IDS,
  PLAYER,
  buildDynamicBlockers,
  buildNavGraph,
  buildStaticWorld,
  canTransition,
  computeXp,
  emptyMatchStats,
  evaluateAchievements,
  emptyStats,
  findPath,
  getInteractions,
  hasLineOfSight,
  isFree,
  levelFromXp,
  nearestNode,
  stepMovement,
  validateMap,
  xpForLevel,
  type InteractWorld,
  type MoverState,
} from '../src/index.ts';

const noDyn = { boxes: [] };

describe('maps', () => {
  for (const id of MAP_IDS) {
    const map = MAPS[id];
    const world = buildStaticWorld(map);
    const graph = buildNavGraph(world);

    it(`${id}: structurally valid`, () => {
      expect(validateMap(map)).toEqual([]);
    });

    it(`${id}: spawns are free of obstacles`, () => {
      for (const s of map.survivorSpawns)
        expect(isFree(world, noDyn, s.x, s.z, PLAYER.survivorRadius), `${s.x},${s.z}`).toBe(true);
      expect(isFree(world, noDyn, map.hunterSpawn.x, map.hunterSpawn.z, PLAYER.hunterRadius)).toBe(true);
    });

    it(`${id}: every objective is reachable from the survivor spawn`, () => {
      const start = nearestNode(graph, map.survivorSpawns[0]!.x, map.survivorSpawns[0]!.z);
      const targets = [
        ...map.generators.map((g) => ({ name: g.id, ...g })),
        ...map.keySpawns.map((k, i) => ({ name: `key${i}`, ...k })),
        ...map.exits.map((e) => ({ name: e.id, ...e.panel })),
        ...map.cages.map((c) => ({ name: c.id, ...c })),
        ...map.pickups.map((p) => ({ name: p.id, ...p })),
        { name: 'hunter', ...map.hunterSpawn },
      ];
      for (const t of targets) {
        const goal = nearestNode(graph, t.x, t.z);
        expect(goal, `${t.name} has a nav node`).toBeGreaterThanOrEqual(0);
        const node = graph.nodes[goal]!;
        expect(Math.hypot(node.x - t.x, node.z - t.z), `${t.name} node distance`).toBeLessThan(2.6);
        expect(findPath(graph, start, goal, 200000), `${t.name} reachable`).not.toBeNull();
      }
    });

    it(`${id}: closed gates block the exit zones`, () => {
      const dyn = buildDynamicBlockers(map, { doorOpen: () => true, palletDown: () => false, exitOpen: () => false });
      for (const e of map.exits) {
        const zx = (e.zone.minX + e.zone.maxX) / 2;
        const zz = (e.zone.minZ + e.zone.maxZ) / 2;
        expect(hasLineOfSight(world, dyn, e.panel.x, e.panel.z, zx, zz, { minHeight: 0 })).toBe(false);
      }
    });
  }
});

function mover(x: number, z: number): MoverState {
  return { x, z, yaw: 0, pitch: 0, stamina: 100, exhausted: false, staminaDelay: 0, crouching: false, sprinting: false };
}

describe('movement', () => {
  const world = buildStaticWorld(MAPS.asylum);
  const params = {
    role: 'survivor' as const,
    condition: 'healthy' as const,
    characterId: 'alex' as const,
    speedMul: 1,
    locked: false,
  };

  it('walks forward (-z at yaw 0) at walk speed', () => {
    const s = mover(0, 16);
    for (let i = 0; i < 30; i++)
      stepMovement(world, noDyn, s, { seq: i, dt: 1 / 30, mx: 0, mz: 1, yaw: 0, pitch: 0, sprint: false, crouch: false }, params);
    expect(s.z).toBeCloseTo(16 - PLAYER.walkSpeed, 1);
    expect(s.x).toBeCloseTo(0, 5);
  });

  it('cannot pass through the outer wall', () => {
    const s = mover(-42, 8);
    for (let i = 0; i < 120; i++)
      stepMovement(world, noDyn, s, { seq: i, dt: 1 / 30, mx: -1, mz: 0, yaw: 0, pitch: 0, sprint: true, crouch: false }, params);
    expect(s.x).toBeGreaterThan(-44);
  });

  it('sprinting drains stamina until exhausted', () => {
    const s = mover(0, 20);
    for (let i = 0; i < 300; i++)
      stepMovement(
        world,
        noDyn,
        s,
        { seq: i, dt: 1 / 30, mx: 0, mz: i % 60 < 30 ? 1 : -1, yaw: 0, pitch: 0, sprint: true, crouch: false },
        params,
      );
    expect(s.stamina).toBeLessThan(100);
    expect(s.exhausted || s.stamina < 50).toBe(true);
  });

  it('locked players do not move', () => {
    const s = mover(0, 16);
    stepMovement(
      world,
      noDyn,
      s,
      { seq: 1, dt: 0.1, mx: 0, mz: 1, yaw: 0, pitch: 0, sprint: false, crouch: false },
      { ...params, locked: true },
    );
    expect(s.z).toBe(16);
  });
});

describe('state machine', () => {
  it('allows the capture chain and blocks shortcuts', () => {
    expect(canTransition('healthy', 'injured')).toBe(true);
    expect(canTransition('injured', 'downed')).toBe(true);
    expect(canTransition('downed', 'captured')).toBe(true);
    expect(canTransition('captured', 'rescued')).toBe(true);
    expect(canTransition('captured', 'healthy')).toBe(false);
    expect(canTransition('escaped', 'injured')).toBe(false);
    expect(canTransition('eliminated', 'healthy')).toBe(false);
  });
});

describe('progression', () => {
  it('levels are monotonic', () => {
    for (let l = 1; l < 30; l++) expect(xpForLevel(l + 1)).toBeGreaterThan(xpForLevel(l));
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(xpForLevel(5))).toBe(5);
  });

  it('awards escape XP and achievements', () => {
    const stats = { ...emptyMatchStats(), generatorProgress: 1 };
    const xp = computeXp({ role: 'survivor', outcome: 'escaped', won: true, stats });
    expect(xp.total).toBeGreaterThan(200);
    const ach = evaluateAchievements(
      { role: 'survivor', outcome: 'escaped', stats, survivorsTotal: 4, survivorsEscaped: 1, lifetime: emptyStats() },
      [],
    );
    expect(ach).toEqual(expect.arrayContaining(['first_escape', 'silent_survivor', 'last_one_standing', 'grease_monkey']));
  });
});

describe('interactions', () => {
  const map = MAPS.asylum;
  const gen = map.generators[0]!;
  const world: InteractWorld = {
    map,
    powerOn: false,
    keysDeposited: 0,
    keysRequired: 2,
    generator: () => ({ progress: 0, completed: false, kicked: false }),
    exit: () => ({ progress: 0, open: false }),
    keys: [],
    pallet: () => 'up',
    door: () => ({ open: true, locked: false }),
    pickupTaken: () => false,
    players: [],
    lockerOccupied: () => false,
  };
  const me = {
    id: 'a',
    role: 'survivor' as const,
    characterId: 'alex' as const,
    condition: 'healthy' as const,
    x: gen.x + 1.2,
    z: gen.z,
    yaw: Math.PI / 2,
    hiddenIn: '',
    carryingKey: false,
    item: '',
    cageId: '',
    busy: false,
  };
  it('offers generator repair when close and facing', () => {
    const opts = getInteractions(world, me);
    expect(opts.find((o) => o.kind === 'repair' && o.id === gen.id)).toBeTruthy();
  });
  it('hunters cannot repair', () => {
    const opts = getInteractions(world, { ...me, role: 'hunter', characterId: 'wraith' });
    expect(opts.find((o) => o.kind === 'repair')).toBeFalsy();
  });
});
