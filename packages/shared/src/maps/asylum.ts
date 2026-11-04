import { MapBuilder, type Gap } from './builder.ts';
import type { CircleObstacle, DecorDef, LightDef, LockerDef, MapDef, PickupDef } from './types.ts';
import type { Vec2 } from '../types.ts';

/**
 * THE ABANDONED ASYLUM
 * Main building spans x -44..44, z -30..30 (north is -z). A separate basement
 * region (x 96..144) is reached by two stairwells — Electrical room and Kitchen.
 *
 *   North row : Operating room | 6 patient rooms | Electrical | Storage (locked)
 *   North corridor (z -18..-14)
 *   Middle row: Ward A | passage | Records | Showers | Day room | passage | Pharmacy | Staff
 *   Central corridor (z -2..2)
 *   South     : Security | Therapy | LOBBY (main exit) | Cafeteria
 *               SW corridor / Isolation cells | LOBBY | SE corridor / Laundry | Kitchen (loading dock exit)
 */
const R = (at: number, width = 4): Gap => ({ at, width });
const D = (at: number): Gap => ({ at, width: 1.8, door: 'door' });
const LOCK = (at: number): Gap => ({ at, width: 1.8, door: 'locked' });
const SHUT = (at: number): Gap => ({ at, width: 1.8, door: 'closed' });

function build(): MapDef {
  const b = new MapBuilder();

  // ---------------- Main building shell ----------------
  b.wallX(-30, -44, 44);
  b.wallX(30, -44, 44, [{ at: 0, width: 4 }], { lintel: false });
  b.wallZ(-44, -30, 30);
  b.wallZ(44, -30, 30, [{ at: 24, width: 4 }], { lintel: false });

  // North row / north corridor
  b.wallX(-18, -44, 44, [D(-36), D(-24), D(-16), SHUT(-8), D(0), D(8), SHUT(16), D(26), LOCK(38)]);
  for (const x of [-28, -20, -12, -4, 4, 12, 20, 32]) b.wallZ(x, -30, -18, [], { kind: 'wallInterior' });

  // Middle row
  b.wallX(-14, -44, 44, [D(-33), R(-20), D(-12), D(-1), D(11), R(20), D(27), D(38)]);
  b.wallX(-2, -44, 44, [D(-33), R(-20), LOCK(-12), D(8), D(14), R(20), D(27), SHUT(38)]);
  b.wallZ(-22, -14, -2, [], { kind: 'wallInterior' });
  b.wallZ(-18, -14, -2, [], { kind: 'wallInterior' });
  b.wallZ(-6, -14, -2, [D(-8)], { kind: 'wallInterior' });
  b.wallZ(4, -14, -2, [], { kind: 'wallInterior' });
  b.wallZ(18, -14, -2, [], { kind: 'wallInterior' });
  b.wallZ(22, -14, -2, [], { kind: 'wallInterior' });
  b.wallZ(32, -14, -2, [D(-8)], { kind: 'wallInterior' });

  // South wing
  b.wallX(2, -44, 44, [D(-37), D(-20), R(0, 12), D(18), D(36)]);
  b.wallX(14, -44, -10, [D(-37), D(-20)]);
  b.wallX(14, 10, 44, [D(18), D(36)]);
  b.wallX(18, -44, -10, [D(-40)]);
  b.wallX(18, 10, 44, [D(18), D(35)]);
  b.wallX(22, -44, -10, [SHUT(-40), SHUT(-32), D(-24), SHUT(-15)]);
  b.wallZ(-30, 2, 14, [D(8)], { kind: 'wallInterior' });
  b.wallZ(-10, 2, 30, [D(8), R(16), D(20)]);
  b.wallZ(10, 2, 30, [D(8), R(16), D(24)]);
  b.wallZ(26, 18, 30, [D(24)], { kind: 'wallInterior' });
  for (const x of [-36, -28, -20]) b.wallZ(x, 22, 30, [], { kind: 'wallInterior' });

  // Exit vestibules
  b.wallZ(-2.2, 30, 35, [], { height: 3 });
  b.wallZ(2.2, 30, 35, [], { height: 3 });
  b.wallX(35, -2.2, 2.2, [], { height: 3 });
  b.wallX(21.8, 44, 49, [], { height: 3 });
  b.wallX(26.2, 44, 49, [], { height: 3 });
  b.wallZ(49, 21.8, 26.2, [], { height: 3 });

  // ---------------- Basement (x 96..144) ----------------
  const bh = { height: 3.2 };
  b.wallX(-16, 96, 144, [], bh);
  b.wallX(16, 96, 144, [], bh);
  b.wallZ(96, -16, 16, [], bh);
  b.wallZ(144, -16, 16, [], bh);
  b.wallX(-6, 96, 106, [], bh);
  b.wallX(6, 96, 106, [], bh);
  b.wallZ(106, -16, 16, [{ at: 0, width: 3 }], bh);
  b.wallX(-6, 136, 144, [], bh);
  b.wallX(6, 136, 144, [], bh);
  b.wallZ(136, -16, 16, [{ at: 0, width: 3 }], bh);
  b.wallX(-3, 106, 136, [D(117), D(131)], bh);
  b.wallX(3, 106, 136, [D(117), D(131)], bh);
  b.wallZ(124, -16, -3, [D(-10)], { ...bh, kind: 'wallInterior' });
  b.wallZ(128, 3, 16, [D(10)], { ...bh, kind: 'wallInterior' });

  // ---------------- Furniture ----------------
  // Operating room
  b.box(-36, -24, 1.1, 2.3, 0.95, 'optable');
  b.box(-43.3, -25, 0.9, 3, 2.0, 'cabinet');
  b.box(-31, -29.3, 3, 0.8, 1.6, 'cabinet');
  // Patient rooms
  for (const cx of [-24, -16, -8, 0, 8, 16]) {
    b.box(cx - 1.8, -27.4, 1.1, 2.2, 0.7, 'bed');
    b.box(cx + 2.6, -29.3, 1.4, 0.7, 1.2, 'cabinet');
  }
  // Electrical
  b.box(21, -27, 1, 4, 2.2, 'shelf');
  b.box(25, -29.4, 4, 0.6, 2.4, 'cabinet');
  // Storage
  b.box(35.5, -25, 0.8, 7, 2.2, 'shelf');
  b.box(40.5, -25, 0.8, 7, 2.2, 'shelf');
  // Ward A beds
  for (const x of [-41, -35, -29]) {
    b.box(x, -11.6, 2.2, 1.1, 0.7, 'bed');
    b.box(x, -4.4, 2.2, 1.1, 0.7, 'bed');
  }
  // Records
  b.box(-15, -8, 0.8, 7, 2.3, 'shelf');
  b.box(-10.5, -8, 0.8, 7, 2.3, 'shelf');
  // Showers stalls
  b.box(-2.5, -12.8, 0.15, 2.2, 2.2, 'wallInterior');
  b.box(0.5, -12.8, 0.15, 2.2, 2.2, 'wallInterior');
  b.box(-2.5, -3.2, 0.15, 2.2, 2.2, 'wallInterior');
  b.box(0.5, -3.2, 0.15, 2.2, 2.2, 'wallInterior');
  // Day room
  b.box(7.5, -6, 2.2, 2.2, 0.75, 'table');
  b.box(15, -6, 2.2, 2.2, 0.75, 'table');
  // Pharmacy
  b.box(27, -9.5, 6, 0.9, 1.1, 'counter');
  b.box(31.3, -7, 0.7, 6, 2.2, 'shelf');
  // Staff
  b.box(37, -8, 2.4, 1.4, 0.75, 'table');
  // Security
  b.box(-37, 6.2, 5, 1.1, 1.1, 'counter');
  b.box(-43.3, 6, 0.8, 3, 1.8, 'cabinet');
  // Lobby
  b.box(0, 10.5, 7, 1.3, 1.1, 'counter');
  // Cafeteria tables
  for (const [x, z] of [
    [16, 6],
    [16, 10.5],
    [24, 6],
    [24, 10.5],
    [32, 10.5],
  ] as const)
    b.box(x, z, 3, 1.3, 0.75, 'table');
  // Laundry machines
  for (const z of [20.5, 23, 27.5]) b.box(11.1, z, 1.5, 1.5, 1.2, 'cabinet');
  // Kitchen counters
  b.box(34, 21.5, 8, 1.2, 1.0, 'counter');
  b.box(34, 26.5, 8, 1.2, 1.0, 'counter');
  // Isolation cell beds
  for (const cx of [-40, -32, -24, -15]) b.box(cx, 28.6, 2.2, 1.0, 0.6, 'bed');
  // Basement boilers & racks
  b.box(111, 11, 3.2, 3.2, 3.0, 'boiler');
  b.box(121, 12, 2.6, 2.6, 3.0, 'boiler');
  b.box(113, -12, 6, 0.8, 2.2, 'shelf');
  b.box(113, -7.5, 6, 0.8, 2.2, 'shelf');
  b.box(130, -14.5, 2.2, 1.0, 0.9, 'optable');
  b.box(134, -14.5, 2.2, 1.0, 0.9, 'optable');
  b.box(132, 13, 6, 1.2, 1.8, 'cabinet');

  const circles: CircleObstacle[] = [
    { x: -5, z: 7, r: 0.45, kind: 'pillar', h: 3.6 },
    { x: 5, z: 7, r: 0.45, kind: 'pillar', h: 3.6 },
    { x: -5, z: 21, r: 0.45, kind: 'pillar', h: 3.6 },
    { x: 5, z: 21, r: 0.45, kind: 'pillar', h: 3.6 },
    { x: 115, z: 0, r: 0.4, kind: 'pillar', h: 3.2 },
    { x: 127, z: 0, r: 0.4, kind: 'pillar', h: 3.2 },
  ];

  const lockers: LockerDef[] = (
    [
      [-20.7, -25, -Math.PI / 2],
      [-4.7, -25, -Math.PI / 2],
      [11.3, -25, -Math.PI / 2],
      [-43.3, -8, Math.PI / 2],
      [3.3, -11.5, -Math.PI / 2],
      [3.3, -5.5, -Math.PI / 2],
      [43.3, -11, -Math.PI / 2],
      [43.3, -6, -Math.PI / 2],
      [-43.3, 11.5, Math.PI / 2],
      [-10.7, 26.5, -Math.PI / 2],
      [25.3, 28.5, -Math.PI / 2],
      [27.2, 29.3, Math.PI],
      [-43.3, 26, Math.PI / 2],
      [-9.3, 12.5, Math.PI / 2],
      [9.3, 27, -Math.PI / 2],
      [107, -14.5, 0],
      [143.3, -3.5, -Math.PI / 2],
      [127.3, 13.5, -Math.PI / 2],
    ] as const
  ).map(([x, z, rot], i) => ({ id: `locker${i}`, x, z, rot }));

  const pickups: PickupDef[] = [
    ...(
      [
        [-38, -20],
        [24, -20],
        [-33, 12],
        [20, 24],
        [-8, 20],
        [36, -4],
        [140, 4],
        [-12, -4],
      ] as const
    ).map(([x, z], i) => ({ id: `battery${i}`, kind: 'battery' as const, x, z })),
    ...(
      [
        [29, -6],
        [-41, 4],
        [122, -14],
      ] as const
    ).map(([x, z], i) => ({ id: `medkit${i}`, kind: 'medkit' as const, x, z })),
    ...(
      [
        [39.5, -21],
        [-26, 27],
        [7, -12],
      ] as const
    ).map(([x, z], i) => ({ id: `fire${i}`, kind: 'firecracker' as const, x, z })),
  ];

  const shadowPoints: Vec2[] = (
    [
      [-42, -28],
      [-22, -22],
      [-6, -22],
      [10, -22],
      [22, -20],
      [42, -28],
      [-42, -16],
      [14, -16],
      [-42, -12],
      [-20, -12],
      [-16, -3],
      [16, -12],
      [30, -12],
      [42, -3],
      [-42, 0],
      [-12, 0],
      [12, 0],
      [42, 0],
      [-42, 4],
      [-12, 12],
      [-42, 16],
      [-8, 28],
      [8, 4],
      [42, 12],
      [12, 16],
      [42, 16],
      [24, 20],
      [42, 29],
      [-38, 20],
      [-14, 20],
      [104, 4],
      [118, -5],
      [134, -10],
      [126, 5],
      [142, 5],
      [110, 14],
    ] as const
  ).map(([x, z]) => ({ x, z }));

  const lights: LightDef[] = [
    { x: -30, y: 3.3, z: -16, color: '#b8c8ff', intensity: 5, distance: 14, flicker: 0.6 },
    { x: 8, y: 3.3, z: -16, color: '#b8c8ff', intensity: 4, distance: 14, flicker: 0.2 },
    { x: 34, y: 3.3, z: -16, color: '#ffd9a0', intensity: 4, distance: 12, flicker: 0.9 },
    { x: -26, y: 3.3, z: 0, color: '#a8c0d8', intensity: 5, distance: 16, flicker: 0.3 },
    { x: 16, y: 3.3, z: 0, color: '#a8c0d8', intensity: 5, distance: 16, flicker: 0.7 },
    { x: 0, y: 3.3, z: 16, color: '#ffcf90', intensity: 7, distance: 18, flicker: 0.35 },
    { x: 0, y: 3.3, z: 26, color: '#ff9a70', intensity: 5, distance: 12, flicker: 0.6 },
    { x: -20, y: 3.3, z: -8, color: '#b0c8e0', intensity: 5, distance: 14, flicker: 0.5 },
    { x: 11, y: 3.3, z: -8, color: '#d0c0a0', intensity: 5, distance: 14, flicker: 0.25 },
    { x: 0, y: 3.3, z: 0, color: '#a8c0d8', intensity: 6, distance: 16, flicker: 0.2, powered: true },
    { x: -36, y: 3.3, z: 8, color: '#c8d8ff', intensity: 4, distance: 12, flicker: 0.7 },
    { x: 26, y: 3.3, z: 8, color: '#ffd8a0', intensity: 4, distance: 14, flicker: 0.4, powered: true },
    { x: -36, y: 3.3, z: -24, color: '#d8f0ff', intensity: 7, distance: 10, flicker: 0.95 },
    { x: 26, y: 3.0, z: -24, color: '#ff8a5a', intensity: 4, distance: 10, flicker: 0.5 },
    { x: -26, y: 3.3, z: 20, color: '#c04040', intensity: 4, distance: 12, flicker: 0.4 },
    { x: 35, y: 3.3, z: 24, color: '#ffcf90', intensity: 5, distance: 12, flicker: 0.2, powered: true },
    { x: 116, y: 2.9, z: 0, color: '#ff9a50', intensity: 5, distance: 14, flicker: 0.5 },
    { x: 130, y: 2.9, z: -10, color: '#90c0ff', intensity: 4, distance: 10, flicker: 0.8 },
  ];

  const decor: DecorDef[] = [];
  const add = (kind: DecorDef['kind'], x: number, z: number, rot = 0, scale = 1) => decor.push({ kind, x, z, rot, scale });
  add('wheelchair', -40, -16, 0.6);
  add('wheelchair', 20, -0.5, 2.1);
  add('wheelchair', 38, 16, 4);
  add('iv_stand', -33.5, -26);
  add('iv_stand', -27, -10);
  add('iv_stand', 3, -27);
  add('iv_stand', 130, -12);
  for (let i = 0; i < 14; i++) add('papers', -40 + i * 6.3, ((i * 7.1) % 30) - 15, i);
  add('blood', -36, -22, 0, 1.4);
  add('blood', -2, 0, 1, 1);
  add('blood', 132, -13, 2, 1.6);
  add('blood', -24, 26, 0.5, 1);
  add('chair', -21, 7, 0.4);
  add('chair', -17, 9, 2.4);
  add('chair', -23, 10, 4.1);
  add('chair', -19, 4.5, 5.5);
  add('chair', 14, 4.4, 0);
  add('chair', 22, 12.2, Math.PI);
  add('chair', 30, 12.2, 3);
  add('bucket', -1, -9);
  add('bucket', 18, 27);
  add('drain', -1, -8);
  add('drain', 120, 0);
  add('sign', 0, 29.6, Math.PI);
  add('sign', 43.6, 24, -Math.PI / 2);
  add('barrel', 98, 12);
  add('barrel', 100, -12);
  add('barrel', 140, 12);
  add('barrel', 141, -12);
  add('bones', 134, -6);
  add('skull_pile', 98.5, -14);

  return {
    id: 'asylum',
    name: 'The Abandoned Asylum',
    subtitle: 'Saint Ambrose Psychiatric Hospital',
    description:
      'Endless tiled corridors, a flooded basement and an operating room that still smells of ether. Restore power, find the access keys and get out through the lobby or the loading dock.',
    bounds: { minX: -50, maxX: 150, minZ: -36, maxZ: 40 },
    regions: [
      { id: 'main', name: 'Asylum', minX: -44, maxX: 44, minZ: -30, maxZ: 30, indoor: true, ceiling: 3.6, floor: 'tile' },
      {
        id: 'vest_s',
        name: 'Main Entrance',
        minX: -2.2,
        maxX: 2.2,
        minZ: 30,
        maxZ: 35,
        indoor: false,
        ceiling: 0,
        floor: 'gravel',
      },
      {
        id: 'vest_e',
        name: 'Loading Dock',
        minX: 44,
        maxX: 49,
        minZ: 21.8,
        maxZ: 26.2,
        indoor: false,
        ceiling: 0,
        floor: 'gravel',
      },
      {
        id: 'basement',
        name: 'Basement',
        minX: 96,
        maxX: 144,
        minZ: -16,
        maxZ: 16,
        indoor: true,
        ceiling: 3.2,
        floor: 'concrete',
      },
    ],
    boxes: b.boxes,
    circles,
    generators: [
      { id: 'gen_or', x: -40.5, z: -21, rot: Math.PI / 2 },
      { id: 'gen_elec', x: 27, z: -21.5, rot: Math.PI },
      { id: 'gen_ward', x: -24.6, z: -8, rot: -Math.PI / 2 },
      { id: 'gen_day', x: 15.5, z: -12.4, rot: 0 },
      { id: 'gen_therapy', x: -13.5, z: 11, rot: Math.PI },
      { id: 'gen_cafe', x: 41, z: 6, rot: -Math.PI / 2 },
      { id: 'gen_boiler', x: 117, z: 13, rot: Math.PI },
    ],
    generatorsRequired: 5,
    keySpawns: (
      [
        [-15, -27],
        [9, -28.5],
        [38, -21],
        [-8.5, -12],
        [30, -3.5],
        [-32, 26.5],
        [22.5, 28.5],
        [115, -14.5],
        [132, -11],
      ] as const
    ).map(([x, z]) => ({ x, z })),
    keysRequired: 2,
    keysSpawned: 4,
    exits: [
      {
        id: 'exit_main',
        name: 'Main Entrance',
        gate: { x: 0, z: 30, w: 4, d: 0.5, h: 3.4, kind: 'concrete' },
        panel: { x: 3.4, z: 28.6, rot: Math.PI },
        zone: { minX: -2, maxX: 2, minZ: 31, maxZ: 35 },
      },
      {
        id: 'exit_dock',
        name: 'Loading Dock',
        gate: { x: 44, z: 24, w: 0.5, d: 4, h: 3.4, kind: 'concrete' },
        panel: { x: 42.4, z: 20.6, rot: Math.PI },
        zone: { minX: 45, maxX: 49, minZ: 22, maxZ: 26 },
      },
    ],
    cages: (
      [
        [-30, -16],
        [30, -16],
        [0, 0],
        [-26, 16],
        [26, 16],
        [-3, 24],
        [131, -9],
      ] as const
    ).map(([x, z], i) => ({ id: `cage${i}`, x, z })),
    lockers,
    pallets: [
      { id: 'pal0', x: -27, z: -16, axis: 'z', length: 3.6 },
      { id: 'pal1', x: 6, z: -16, axis: 'z', length: 3.6 },
      { id: 'pal2', x: -26, z: 0, axis: 'z', length: 3.6 },
      { id: 'pal3', x: 30, z: 0, axis: 'z', length: 3.6 },
      { id: 'pal4', x: -26, z: 16, axis: 'z', length: 3.6 },
      { id: 'pal5', x: 28, z: 16, axis: 'z', length: 3.6 },
      { id: 'pal6', x: -30, z: 20, axis: 'z', length: 3.6 },
      { id: 'pal7', x: -20, z: -8, axis: 'x', length: 3.6 },
      { id: 'pal8', x: 20, z: -8, axis: 'x', length: 3.6 },
      { id: 'pal9', x: 110, z: 0, axis: 'z', length: 5.6 },
    ],
    doors: b.doors,
    hatches: [
      { id: 'stairs_elec', x: 30.6, z: -27.6, to: 'stairs_bw', label: 'Basement stairs' },
      { id: 'stairs_bw', x: 99, z: 0, to: 'stairs_elec', label: 'Stairs to Electrical' },
      { id: 'stairs_kitchen', x: 41.6, z: 28.4, to: 'stairs_be', label: 'Basement stairs' },
      { id: 'stairs_be', x: 141, z: 0, to: 'stairs_kitchen', label: 'Stairs to Kitchen' },
    ],
    pickups,
    shadowPoints,
    survivorSpawns: (
      [
        [-4, 24],
        [4, 24],
        [-6, 18],
        [6, 18],
        [-2, 27],
        [2, 27],
        [-7, 26],
        [7, 26],
      ] as const
    ).map(([x, z]) => ({ x, z })),
    hunterSpawn: { x: 0, z: -16 },
    lights,
    decor,
    atmosphere: {
      fogColor: '#0e1216',
      fogDensity: 0.045,
      indoorFogDensity: 0.045,
      ambientColor: '#5a667a',
      ambientIntensity: 0.95,
      moonColor: '#8fa6c8',
      moonIntensity: 0.15,
      moonDir: [-0.3, -1, 0.4],
      sky: 'none',
      hunterTint: '#3a0d0d',
    },
  };
}

export const ASYLUM: MapDef = build();
