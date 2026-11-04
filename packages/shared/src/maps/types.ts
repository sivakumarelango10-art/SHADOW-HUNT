import type { ItemKind, MapId, Vec2 } from '../types.ts';

/** Axis-aligned solid box. Centre (x,z), size w (along x) × d (along z), height h. */
export interface Box {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  kind: BoxKind;
  /** Visual-only rotation (0 or quarter turns) for props; collision is always axis aligned. */
  rot?: number;
  /** Optional y offset for floating geometry (e.g. lintels). */
  y?: number;
}

export type BoxKind =
  | 'wall'
  | 'wallInterior'
  | 'fence'
  | 'cabin'
  | 'lintel'
  | 'vehicle_truck'
  | 'vehicle_car'
  | 'vehicle_bus'
  | 'crate'
  | 'log'
  | 'concrete'
  | 'bed'
  | 'cabinet'
  | 'counter'
  | 'table'
  | 'optable'
  | 'shelf'
  | 'boiler'
  | 'bunker'
  | 'void';

export interface CircleObstacle {
  x: number;
  z: number;
  r: number;
  kind: 'tree' | 'deadtree' | 'rock' | 'pillar' | 'stump';
  /** Visual height. */
  h: number;
}

export interface Region {
  id: string;
  name: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  indoor: boolean;
  /** Ceiling height for indoor regions (0 = open sky). */
  ceiling: number;
  floor: 'forest' | 'tile' | 'concrete' | 'wood' | 'gravel';
}

export interface GeneratorDef {
  id: string;
  x: number;
  z: number;
  rot: number;
}

export interface ExitDef {
  id: string;
  name: string;
  /** Gate collider (blocks the doorway until opened). */
  gate: Box;
  /** Control panel survivors interact with. */
  panel: Vec2 & { rot: number };
  /** Entering this rectangle once the gate is open = escaped. */
  zone: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export interface CageDef {
  id: string;
  x: number;
  z: number;
}

export interface LockerDef {
  id: string;
  x: number;
  z: number;
  rot: number;
}

export interface PalletDef {
  id: string;
  x: number;
  z: number;
  /** 'x': the dropped pallet spans along x (blocks movement along z). */
  axis: 'x' | 'z';
  length: number;
}

export interface DoorDef {
  id: string;
  x: number;
  z: number;
  /** 'x': door leaf spans along x (doorway in a wall running along x). */
  axis: 'x' | 'z';
  width: number;
  /** Locked doors unlock automatically when power is restored. */
  locked: boolean;
  startsOpen: boolean;
}

export interface HatchDef {
  id: string;
  x: number;
  z: number;
  /** Destination hatch id. */
  to: string;
  label: string;
}

export interface PickupDef {
  id: string;
  kind: ItemKind;
  x: number;
  z: number;
}

export interface LightDef {
  x: number;
  y: number;
  z: number;
  color: string;
  intensity: number;
  distance: number;
  flicker: number;
  /** Only switches on once power is restored. */
  powered?: boolean;
}

export interface DecorDef {
  kind:
    | 'grass'
    | 'fern'
    | 'bones'
    | 'papers'
    | 'chair'
    | 'wheelchair'
    | 'barrel'
    | 'tire'
    | 'lamp_post'
    | 'skull_pile'
    | 'blood'
    | 'bucket'
    | 'sign'
    | 'iv_stand'
    | 'drain';
  x: number;
  z: number;
  rot: number;
  scale: number;
}

export interface Atmosphere {
  fogColor: string;
  fogDensity: number;
  indoorFogDensity: number;
  ambientColor: string;
  ambientIntensity: number;
  moonColor: string;
  moonIntensity: number;
  moonDir: [number, number, number];
  sky: 'night' | 'none';
  hunterTint: string;
}

export interface MapDef {
  id: MapId;
  name: string;
  subtitle: string;
  description: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  regions: Region[];
  boxes: Box[];
  circles: CircleObstacle[];
  generators: GeneratorDef[];
  generatorsRequired: number;
  keySpawns: Vec2[];
  keysRequired: number;
  keysSpawned: number;
  exits: ExitDef[];
  cages: CageDef[];
  lockers: LockerDef[];
  pallets: PalletDef[];
  doors: DoorDef[];
  hatches: HatchDef[];
  pickups: PickupDef[];
  shadowPoints: Vec2[];
  survivorSpawns: Vec2[];
  hunterSpawn: Vec2;
  lights: LightDef[];
  decor: DecorDef[];
  atmosphere: Atmosphere;
}
