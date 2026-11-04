import { MapBuilder, mulberry32, type Gap } from './builder.ts';
import type { CircleObstacle, DecorDef, LightDef, LockerDef, MapDef, PalletDef, PickupDef } from './types.ts';
import type { Vec2 } from '../types.ts';

/**
 * BLACKWOOD FOREST
 * Fenced woodland x/z -50..50 (north is -z). Two exit gates (south road, west road),
 * three cabins, a tool shed, broken vehicles and a concrete hatch leading to an
 * underground bunker region at x 70..100.
 */
const D = (at: number): Gap => ({ at, width: 1.6, door: 'door' });
const OPEN = (at: number, width = 1.4): Gap => ({ at, width });

function build(): MapDef {
  const b = new MapBuilder({ thickness: 0.25, height: 3.0, kind: 'cabin', lintel: true });
  const fence = { kind: 'fence' as const, height: 2.6, thickness: 0.3, lintel: false };

  // Perimeter fence with gate openings
  b.wallX(-50, -50, 50, [], fence);
  b.wallX(50, -50, 50, [{ at: 0, width: 6 }], fence);
  b.wallZ(-50, -50, 50, [{ at: 10, width: 6 }], fence);
  b.wallZ(50, -50, 50, [], fence);
  // Exit vestibules
  b.wallZ(-3.2, 50, 56, [], fence);
  b.wallZ(3.2, 50, 56, [], fence);
  b.wallX(56, -3.2, 3.2, [], fence);
  b.wallX(6.8, -56, -50, [], fence);
  b.wallX(13.2, -56, -50, [], fence);
  b.wallZ(-56, 6.8, 13.2, [], fence);

  // Cabin A (x -31..-21, z -26..-18): door south, window north
  b.room(-31, -26, -21, -18, { s: [D(-26)], n: [OPEN(-23)] });
  b.box(-26, -22.5, 1.8, 1.0, 0.75, 'table');
  // Cabin B (x 19..29, z 16..24): door west, window east
  b.room(19, 16, 29, 24, { w: [D(20)], e: [OPEN(18)] });
  b.box(22, 23.2, 2.2, 0.8, 1.6, 'shelf');
  // Ranger station C (x -34..-26, z 26..34): door east, window north
  b.room(-34, 26, -26, 34, { e: [D(30)], n: [OPEN(-30)] });
  // Tool shed (x 28..32, z -14..-10): door north
  b.room(28, -14, 32, -10, { n: [D(30)] }, { height: 2.6 });
  // Bunker entrance hut (open to the south)
  b.wallX(-42.2, 36, 40, [], { kind: 'bunker', height: 2.4, thickness: 0.4, lintel: false });
  b.wallZ(36, -42.2, -38, [], { kind: 'bunker', height: 2.4, thickness: 0.4, lintel: false });
  b.wallZ(40, -42.2, -38, [], { kind: 'bunker', height: 2.4, thickness: 0.4, lintel: false });

  // Underground bunker (x 70..100, z -14..14)
  const bk = { kind: 'bunker' as const, height: 3.0, thickness: 0.4 };
  b.wallX(-14, 70, 100, [], bk);
  b.wallX(14, 70, 100, [], bk);
  b.wallZ(70, -14, 14, [], bk);
  b.wallZ(100, -14, 14, [], bk);
  b.wallX(-4, 70, 78, [], bk);
  b.wallX(4, 70, 78, [], bk);
  b.wallZ(78, -14, 14, [{ at: 0, width: 2.4 }], bk);
  b.wallX(-2, 78, 100, [D(86), D(95)], bk);
  b.wallX(2, 78, 100, [D(84), D(94)], bk);
  b.wallZ(90, -14, -2, [D(-8)], bk);
  b.wallZ(90, 2, 14, [], bk);
  b.box(80, -12.8, 3, 1.2, 2.0, 'shelf');
  b.box(96, -13, 5, 1.0, 1.2, 'crate');
  b.box(88, 12.8, 2, 1.0, 1.0, 'crate');

  // Vehicles, logs, crates
  b.box(6, 4, 2.4, 6.4, 2.6, 'vehicle_truck');
  b.box(-8, 36, 4.6, 2.0, 1.5, 'vehicle_car', Math.PI / 2);
  b.box(34, -30, 2.8, 11, 3.2, 'vehicle_bus');
  b.box(-40, -6, 2.0, 4.6, 1.5, 'vehicle_car');
  b.box(18, -4, 4.6, 2.0, 1.5, 'vehicle_car', Math.PI / 2);
  b.box(-12, -12, 6, 0.9, 0.9, 'log');
  b.box(14, 32, 0.9, 5, 0.9, 'log', Math.PI / 2);
  b.box(-20, 8, 5, 0.9, 0.9, 'log');
  b.box(2, -36, 1.4, 1.4, 1.2, 'crate');
  b.box(-44, 22, 1.6, 1.6, 1.3, 'crate');
  b.box(44, 12, 1.4, 1.4, 1.2, 'crate');

  const circles: CircleObstacle[] = [];
  const rock = (x: number, z: number, r: number) => circles.push({ x, z, r, kind: 'rock', h: r * 1.3 });
  for (const [x, z, r] of [
    [-14, -2, 1.8], [12, -18, 2.0], [-36, 14, 1.6], [26, 40, 2.2], [42, -18, 1.5], [-22, 42, 1.4], [8, 24, 1.3], [-44, -28, 1.7],
  ] as const) rock(x, z, r);

  // Pallets flanked by rocks so each one is a real chokepoint.
  const pallets: PalletDef[] = [];
  const palletSpots: [number, number, 'x' | 'z'][] = [
    [-12, -20, 'x'], [16, -12, 'z'], [-30, -4, 'z'], [24, 8, 'x'], [-14, 28, 'z'], [6, 32, 'x'], [-38, 22, 'x'], [38, -22, 'z'],
    [-4, -38, 'x'], [40, 22, 'z'],
  ];
  palletSpots.forEach(([x, z, axis], i) => {
    const len = 2.6;
    pallets.push({ id: `pal${i}`, x, z, axis, length: len });
    const off = len / 2 + 0.85;
    if (axis === 'x') {
      rock(x - off, z, 0.9);
      rock(x + off, z, 0.9);
    } else {
      rock(x, z - off, 0.9);
      rock(x, z + off, 0.9);
    }
  });
  pallets.push({ id: 'pal_bunker', x: 82, z: 0, axis: 'z', length: 3.6 });

  const generators = [
    { id: 'gen_north', x: -38, z: -36, rot: 0 },
    { id: 'gen_clearing', x: 2, z: -28, rot: 0 },
    { id: 'gen_east', x: 40, z: 6, rot: -Math.PI / 2 },
    { id: 'gen_stump', x: -6, z: 16, rot: Math.PI / 2 },
    { id: 'gen_ranger', x: -31.5, z: 31.2, rot: Math.PI / 2 },
    { id: 'gen_south', x: 18, z: 42, rot: Math.PI },
    { id: 'gen_bunker', x: 86, z: 10, rot: Math.PI },
  ];

  const lockers: LockerDef[] = (
    [
      [-30.4, -22, Math.PI / 2], [28.4, 22.6, -Math.PI / 2], [-33.4, 27.6, Math.PI / 2], [31.4, -12.4, -Math.PI / 2],
      [99.3, -6, -Math.PI / 2], [79, 12.4, Math.PI], [-44, 34, 0], [44, -6, -Math.PI / 2], [8, -44, 0], [-2, 28, Math.PI],
    ] as const
  ).map(([x, z, rot], i) => ({ id: `locker${i}`, x, z, rot }));

  const pickups: PickupDef[] = [
    ...([[-29, -19.6], [24, 17.6], [29, -13], [81, -10], [-45, -20], [45, 30], [-10, 45], [20, -40]] as const).map(
      ([x, z], i) => ({ id: `battery${i}`, kind: 'battery' as const, x, z }),
    ),
    ...([[26, 18], [-46, 45], [92, -12]] as const).map(([x, z], i) => ({ id: `medkit${i}`, kind: 'medkit' as const, x, z })),
    ...([[-23, -19.5], [97, 12], [-28.5, 28]] as const).map(([x, z], i) => ({ id: `fire${i}`, kind: 'firecracker' as const, x, z })),
  ];

  const keySpawns: Vec2[] = (
    [[-23, -24], [24, 22.2], [-44, -44], [44, 44], [-14, -44], [96, -10], [-18, 24], [30, 0]] as const
  ).map(([x, z]) => ({ x, z }));

  const cages = ([[-14, -30], [20, -20], [-24, 4], [12, 12], [-6, 44], [34, 30], [95, 8]] as const).map(([x, z], i) => ({
    id: `cage${i}`,
    x,
    z,
  }));

  const survivorSpawns: Vec2[] = ([[-4, -44], [0, -45], [4, -44], [-2, -42], [2, -42], [-6, -42], [6, -42], [0, -40]] as const).map(
    ([x, z]) => ({ x, z }),
  );
  const hunterSpawn = { x: 0, z: 42 };

  const exits = [
    {
      id: 'exit_south',
      name: 'South Road Gate',
      gate: { x: 0, z: 50, w: 6, d: 0.4, h: 2.8, kind: 'fence' as const },
      panel: { x: 5, z: 48, rot: Math.PI },
      zone: { minX: -3, maxX: 3, minZ: 51, maxZ: 56 },
    },
    {
      id: 'exit_west',
      name: 'Logging Road Gate',
      gate: { x: -50, z: 10, w: 0.4, d: 6, h: 2.8, kind: 'fence' as const },
      panel: { x: -48, z: 15, rot: Math.PI / 2 },
      zone: { minX: -56, maxX: -51, minZ: 7, maxZ: 13 },
    },
  ];

  // ---------------- Procedural tree scatter (deterministic) ----------------
  const rng = mulberry32(1337);
  const keepOut: { x: number; z: number; r: number }[] = [];
  const keep = (x: number, z: number, r: number) => keepOut.push({ x, z, r });
  for (const bx of b.boxes) keep(bx.x, bx.z, Math.hypot(bx.w, bx.d) / 2 + 1.6);
  for (const c of circles) keep(c.x, c.z, c.r + 1.4);
  for (const g of generators) keep(g.x, g.z, 4);
  for (const c of cages) keep(c.x, c.z, 3);
  for (const l of lockers) keep(l.x, l.z, 2.4);
  for (const p of pallets) keep(p.x, p.z, 3.2);
  for (const k of keySpawns) keep(k.x, k.z, 2);
  for (const p of pickups) keep(p.x, p.z, 1.6);
  for (const s of survivorSpawns) keep(s.x, s.z, 3);
  keep(hunterSpawn.x, hunterSpawn.z, 5);
  for (const e of exits) {
    keep(e.panel.x, e.panel.z, 4);
    keep(e.gate.x, e.gate.z, 7);
  }
  keep(38, -40, 5);
  keep(0, 0, 7);
  const onRoad = (x: number, z: number) => (Math.abs(x) < 4.5 && z > -20) || (Math.abs(z - 10) < 3.6 && x < 0);
  const trees: CircleObstacle[] = [];
  for (let i = 0; i < 2600 && trees.length < 470; i++) {
    const x = -48 + rng() * 96;
    const z = -48 + rng() * 96;
    if (onRoad(x, z)) continue;
    if (keepOut.some((k) => (k.x - x) ** 2 + (k.z - z) ** 2 < k.r * k.r)) continue;
    if (trees.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < 2.7 * 2.7)) continue;
    const dead = rng() < 0.18;
    trees.push({ x, z, r: 0.28 + rng() * 0.22, kind: dead ? 'deadtree' : 'tree', h: 9 + rng() * 9 });
  }
  circles.push(...trees);

  const decor: DecorDef[] = [];
  for (let i = 0; i < 900; i++) {
    const x = -49 + rng() * 98;
    const z = -49 + rng() * 98;
    decor.push({ kind: rng() < 0.7 ? 'grass' : 'fern', x, z, rot: rng() * Math.PI * 2, scale: 0.6 + rng() * 0.9 });
  }
  const add = (kind: DecorDef['kind'], x: number, z: number, rot = 0, scale = 1) => decor.push({ kind, x, z, rot, scale });
  add('barrel', 1.5, 1.5); add('barrel', -1.5, -1.2, 1); add('tire', 9, 0, 0.4); add('tire', -37, -3, 2);
  add('skull_pile', -14, -33); add('bones', 22, -22); add('bones', -24, 6); add('blood', 12, 14, 0, 1.2); add('blood', -6, 46, 1, 1);
  add('sign', 5.5, 46, Math.PI); add('sign', -46, 16, Math.PI / 2); add('lamp_post', 4.5, 49); add('lamp_post', -49, 14.5);
  add('barrel', 74, 10); add('barrel', 98, 2.5);

  const lights: LightDef[] = [
    { x: 0, y: 1.4, z: 0, color: '#ff7a30', intensity: 9, distance: 16, flicker: 0.7 },
    { x: -26, y: 2.6, z: -22, color: '#ffb060', intensity: 4, distance: 9, flicker: 0.4 },
    { x: 24, y: 2.6, z: 20, color: '#ffb060', intensity: 3, distance: 9, flicker: 0.8 },
    { x: -30, y: 2.6, z: 30, color: '#d8e8ff', intensity: 4, distance: 9, flicker: 0.9 },
    { x: 4.5, y: 4.6, z: 49, color: '#ffe0b0', intensity: 14, distance: 22, flicker: 0.05, powered: true },
    { x: -49, y: 4.6, z: 14.5, color: '#ffe0b0', intensity: 14, distance: 22, flicker: 0.05, powered: true },
    { x: 84, y: 2.7, z: 0, color: '#ff4a3a', intensity: 4, distance: 14, flicker: 0.5 },
    { x: 95, y: 2.7, z: -8, color: '#9fc0ff', intensity: 3, distance: 10, flicker: 0.9 },
  ];

  const shadowPoints: Vec2[] = (
    [
      [-40, -44], [-20, -44], [14, -44], [36, -46], [-46, -30], [-24, -32], [-4, -24], [22, -30], [44, -34], [-34, -16],
      [-16, -8], [6, -14], [30, -18], [46, -8], [-44, 0], [-26, 0], [10, -4], [34, -2], [-34, 18], [-12, 20], [14, 18],
      [36, 14], [-42, 40], [-26, 46], [8, 40], [30, 46], [46, 36], [-24, -21], [26, 21], [76, -10], [96, -6], [84, 8], [76, 10],
    ] as const
  ).map(([x, z]) => ({ x, z }));

  return {
    id: 'blackwood',
    name: 'Blackwood Forest',
    subtitle: 'Mile marker 41, Route 9',
    description:
      'Dense pines, abandoned cabins and the wrecks of everyone who tried to drive through. Power the floodlights, find the gate keys and run for the road.',
    bounds: { minX: -60, maxX: 104, minZ: -54, maxZ: 60 },
    regions: [
      { id: 'forest', name: 'Blackwood Forest', minX: -50, maxX: 50, minZ: -50, maxZ: 50, indoor: false, ceiling: 0, floor: 'forest' },
      { id: 'vest_s', name: 'South Road', minX: -3.2, maxX: 3.2, minZ: 50, maxZ: 56, indoor: false, ceiling: 0, floor: 'gravel' },
      { id: 'vest_w', name: 'Logging Road', minX: -56, maxX: -50, minZ: 6.8, maxZ: 13.2, indoor: false, ceiling: 0, floor: 'gravel' },
      { id: 'cabinA', name: 'Hunter Cabin', minX: -31, maxX: -21, minZ: -26, maxZ: -18, indoor: true, ceiling: 3.0, floor: 'wood' },
      { id: 'cabinB', name: 'Lake Cabin', minX: 19, maxX: 29, minZ: 16, maxZ: 24, indoor: true, ceiling: 3.0, floor: 'wood' },
      { id: 'cabinC', name: 'Ranger Station', minX: -34, maxX: -26, minZ: 26, maxZ: 34, indoor: true, ceiling: 3.0, floor: 'wood' },
      { id: 'shed', name: 'Tool Shed', minX: 28, maxX: 32, minZ: -14, maxZ: -10, indoor: true, ceiling: 2.6, floor: 'wood' },
      { id: 'hut', name: 'Bunker Hatch', minX: 36, maxX: 40, minZ: -42.2, maxZ: -38, indoor: true, ceiling: 2.4, floor: 'concrete' },
      { id: 'bunker', name: 'Underground Bunker', minX: 70, maxX: 100, minZ: -14, maxZ: 14, indoor: true, ceiling: 3.0, floor: 'concrete' },
    ],
    boxes: b.boxes,
    circles,
    generators,
    generatorsRequired: 5,
    keySpawns,
    keysRequired: 2,
    keysSpawned: 4,
    exits,
    cages,
    lockers,
    pallets,
    doors: b.doors,
    hatches: [
      { id: 'hatch_surface', x: 38, z: -40.6, to: 'hatch_bunker', label: 'Descend into bunker' },
      { id: 'hatch_bunker', x: 73, z: 0, to: 'hatch_surface', label: 'Climb to surface' },
    ],
    pickups,
    shadowPoints,
    survivorSpawns,
    hunterSpawn,
    lights,
    decor,
    atmosphere: {
      fogColor: '#121a24',
      fogDensity: 0.04,
      indoorFogDensity: 0.05,
      ambientColor: '#3a4a66',
      ambientIntensity: 0.7,
      moonColor: '#b4c6e2',
      moonIntensity: 1.25,
      moonDir: [-0.45, -1, -0.35],
      sky: 'night',
      hunterTint: '#2a0a0a',
    },
  };
}

export const BLACKWOOD: MapDef = build();
