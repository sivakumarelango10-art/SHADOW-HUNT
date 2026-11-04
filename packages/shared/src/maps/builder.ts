import type { Box, BoxKind, DoorDef, MapDef } from './types.ts';

/** Deterministic PRNG so server and client generate identical procedural layouts. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Gap {
  /** Centre of the opening along the wall. */
  at: number;
  width: number;
  /** If set, a door is placed in the opening. */
  door?: 'door' | 'locked' | 'closed';
}

export interface WallOptions {
  thickness?: number;
  height?: number;
  kind?: BoxKind;
  /** Header above openings so doorways read as doorways. */
  lintel?: boolean;
}

/**
 * Small imperative builder that turns wall lines with openings into boxes and doors.
 * Walls are described once (not per room) so shared walls never double up.
 */
export class MapBuilder {
  boxes: Box[] = [];
  doors: DoorDef[] = [];
  private doorCount = 0;

  constructor(private defaults: Required<WallOptions> = { thickness: 0.3, height: 3.6, kind: 'wall', lintel: true }) {}

  /** Wall running along X at fixed z, from x0 to x1. */
  wallX(z: number, x0: number, x1: number, gaps: (Gap | number)[] = [], opt: WallOptions = {}): this {
    const o = { ...this.defaults, ...opt };
    for (const [a, b] of splitByGaps(x0, x1, normGaps(gaps))) {
      if (b - a > 0.01) this.boxes.push({ x: (a + b) / 2, z, w: b - a, d: o.thickness, h: o.height, kind: o.kind });
    }
    for (const g of normGaps(gaps)) {
      if (o.lintel && o.height > 2.6) {
        this.boxes.push({ x: g.at, z, w: g.width, d: o.thickness, h: o.height - 2.4, y: 2.4, kind: 'lintel' });
      }
      if (g.door) this.addDoor(g.at, z, 'x', g.width, g.door);
    }
    return this;
  }

  /** Wall running along Z at fixed x, from z0 to z1. */
  wallZ(x: number, z0: number, z1: number, gaps: (Gap | number)[] = [], opt: WallOptions = {}): this {
    const o = { ...this.defaults, ...opt };
    for (const [a, b] of splitByGaps(z0, z1, normGaps(gaps))) {
      if (b - a > 0.01) this.boxes.push({ x, z: (a + b) / 2, w: o.thickness, d: b - a, h: o.height, kind: o.kind });
    }
    for (const g of normGaps(gaps)) {
      if (o.lintel && o.height > 2.6) {
        this.boxes.push({ x, z: g.at, w: o.thickness, d: g.width, h: o.height - 2.4, y: 2.4, kind: 'lintel' });
      }
      if (g.door) this.addDoor(x, g.at, 'z', g.width, g.door);
    }
    return this;
  }

  /** Rectangular room. `doors` maps a side to gap specs along that side. */
  room(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    doors: Partial<Record<'n' | 's' | 'e' | 'w', (Gap | number)[]>> = {},
    opt: WallOptions = {},
  ): this {
    this.wallX(z0, x0, x1, doors.n ?? [], opt);
    this.wallX(z1, x0, x1, doors.s ?? [], opt);
    this.wallZ(x0, z0, z1, doors.w ?? [], opt);
    this.wallZ(x1, z0, z1, doors.e ?? [], opt);
    return this;
  }

  box(x: number, z: number, w: number, d: number, h: number, kind: BoxKind, rot = 0): this {
    this.boxes.push({ x, z, w, d, h, kind, rot });
    return this;
  }

  private addDoor(x: number, z: number, axis: 'x' | 'z', width: number, kind: 'door' | 'locked' | 'closed'): void {
    this.doors.push({
      id: `door${this.doorCount++}`,
      x,
      z,
      axis,
      width,
      locked: kind === 'locked',
      startsOpen: kind === 'door',
    });
  }
}

function normGaps(gaps: (Gap | number)[]): Gap[] {
  return gaps.map((g) => (typeof g === 'number' ? { at: g, width: 1.8, door: 'door' as const } : g)).sort((a, b) => a.at - b.at);
}

function splitByGaps(a: number, b: number, gaps: Gap[]): [number, number][] {
  const out: [number, number][] = [];
  let cur = a;
  for (const g of gaps) {
    const g0 = g.at - g.width / 2;
    const g1 = g.at + g.width / 2;
    if (g0 > cur) out.push([cur, Math.min(g0, b)]);
    cur = Math.max(cur, g1);
  }
  if (cur < b) out.push([cur, b]);
  return out;
}

/** Basic structural validation used by unit tests. */
export function validateMap(map: MapDef): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const check = (id: string) => {
    if (ids.has(id)) errors.push(`duplicate id ${id}`);
    ids.add(id);
  };
  [...map.generators, ...map.cages, ...map.lockers, ...map.pallets, ...map.doors, ...map.hatches, ...map.pickups].forEach((e) =>
    check(e.id),
  );
  map.exits.forEach((e) => check(e.id));
  for (const h of map.hatches) {
    if (!map.hatches.find((o) => o.id === h.to)) errors.push(`hatch ${h.id} has no destination ${h.to}`);
  }
  if (map.generatorsRequired > map.generators.length) errors.push('generatorsRequired exceeds generator count');
  if (map.keysSpawned > map.keySpawns.length) errors.push('keysSpawned exceeds spawn candidates');
  if (map.keysRequired > map.keysSpawned) errors.push('keysRequired exceeds keysSpawned');
  return errors;
}
