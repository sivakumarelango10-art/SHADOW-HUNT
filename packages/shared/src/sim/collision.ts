import type { Box, CircleObstacle, DoorDef, ExitDef, MapDef, PalletDef } from '../maps/types.ts';

export interface AABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface SolidBox extends AABB {
  /** Height in metres, used for line-of-sight decisions. */
  h: number;
}

export interface StaticWorld {
  map: MapDef;
  boxes: SolidBox[];
  circles: CircleObstacle[];
  cellSize: number;
  grid: Map<number, { b: number[]; c: number[] }>;
}

/** Live, state-dependent blockers (closed doors, dropped pallets, closed gates). */
export interface DynamicBlockers {
  boxes: SolidBox[];
}

export function boxToAABB(b: Pick<Box, 'x' | 'z' | 'w' | 'd'>): AABB {
  return { minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2 };
}

const cellKey = (ix: number, iz: number) => (ix + 2048) * 4096 + (iz + 2048);

/** Collider for a locker, generator, etc. that may be rotated by quarter turns. */
function propBox(x: number, z: number, w: number, d: number, rot: number, h: number): SolidBox {
  const quarter = Math.abs(Math.round(rot / (Math.PI / 2))) % 2 === 1;
  const ww = quarter ? d : w;
  const dd = quarter ? w : d;
  return { minX: x - ww / 2, maxX: x + ww / 2, minZ: z - dd / 2, maxZ: z + dd / 2, h };
}

export function buildStaticWorld(map: MapDef, cellSize = 4): StaticWorld {
  const boxes: SolidBox[] = [];
  for (const b of map.boxes) {
    if (b.kind === 'lintel') continue; // above head height
    boxes.push({ ...boxToAABB(b), h: (b.y ?? 0) + b.h });
  }
  for (const g of map.generators) boxes.push(propBox(g.x, g.z, 1.15, 0.85, g.rot, 1.2));
  for (const l of map.lockers) boxes.push(propBox(l.x, l.z, 0.95, 0.6, l.rot, 2.1));
  for (const e of map.exits) boxes.push(propBox(e.panel.x, e.panel.z, 0.5, 0.5, 0, 1.4));

  const world: StaticWorld = { map, boxes, circles: map.circles, cellSize, grid: new Map() };
  const insert = (a: AABB, kind: 'b' | 'c', index: number) => {
    const x0 = Math.floor(a.minX / cellSize);
    const x1 = Math.floor(a.maxX / cellSize);
    const z0 = Math.floor(a.minZ / cellSize);
    const z1 = Math.floor(a.maxZ / cellSize);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const key = cellKey(ix, iz);
        let cell = world.grid.get(key);
        if (!cell) world.grid.set(key, (cell = { b: [], c: [] }));
        cell[kind].push(index);
      }
    }
  };
  boxes.forEach((b, i) => insert(b, 'b', i));
  map.circles.forEach((c, i) => insert({ minX: c.x - c.r, maxX: c.x + c.r, minZ: c.z - c.r, maxZ: c.z + c.r }, 'c', i));
  return world;
}

/** Collider of a door leaf when closed. */
export function doorBox(d: DoorDef): SolidBox {
  return d.axis === 'x'
    ? { minX: d.x - d.width / 2, maxX: d.x + d.width / 2, minZ: d.z - 0.12, maxZ: d.z + 0.12, h: 2.3 }
    : { minX: d.x - 0.12, maxX: d.x + 0.12, minZ: d.z - d.width / 2, maxZ: d.z + d.width / 2, h: 2.3 };
}

/** Collider of a dropped pallet. */
export function palletBox(p: PalletDef): SolidBox {
  return p.axis === 'x'
    ? { minX: p.x - p.length / 2, maxX: p.x + p.length / 2, minZ: p.z - 0.35, maxZ: p.z + 0.35, h: 1.0 }
    : { minX: p.x - 0.35, maxX: p.x + 0.35, minZ: p.z - p.length / 2, maxZ: p.z + p.length / 2, h: 1.0 };
}

export function gateBox(e: ExitDef): SolidBox {
  return { ...boxToAABB(e.gate), h: e.gate.h };
}

export interface DynamicSource {
  doorOpen(id: string): boolean;
  palletDown(id: string): boolean;
  exitOpen(id: string): boolean;
}

export function buildDynamicBlockers(map: MapDef, src: DynamicSource): DynamicBlockers {
  const boxes: SolidBox[] = [];
  for (const d of map.doors) if (!src.doorOpen(d.id)) boxes.push(doorBox(d));
  for (const p of map.pallets) if (src.palletDown(p.id)) boxes.push(palletBox(p));
  for (const e of map.exits) if (!src.exitOpen(e.id)) boxes.push(gateBox(e));
  return { boxes };
}

function pushOutOfBox(p: { x: number; z: number }, r: number, b: AABB): boolean {
  const cx = Math.max(b.minX, Math.min(p.x, b.maxX));
  const cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
  const dx = p.x - cx;
  const dz = p.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-10) {
    const d = Math.sqrt(d2);
    const k = (r - d) / d;
    p.x += dx * k;
    p.z += dz * k;
    return true;
  }
  // Centre inside the box: exit along the axis of least penetration.
  const left = p.x - b.minX;
  const right = b.maxX - p.x;
  const top = p.z - b.minZ;
  const bottom = b.maxZ - p.z;
  const m = Math.min(left, right, top, bottom);
  if (m === left) p.x = b.minX - r;
  else if (m === right) p.x = b.maxX + r;
  else if (m === top) p.z = b.minZ - r;
  else p.z = b.maxZ + r;
  return true;
}

function pushOutOfCircle(p: { x: number; z: number }, r: number, c: CircleObstacle): boolean {
  const dx = p.x - c.x;
  const dz = p.z - c.z;
  const min = r + c.r;
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min) return false;
  const d = Math.sqrt(d2) || 1e-5;
  const k = (min - d) / d;
  p.x += (dx || 1e-5) * k;
  p.z += dz * k;
  return true;
}

/** Push a circle of radius r out of every overlapping solid. Mutates p. */
export function resolveCircle(world: StaticWorld, dyn: DynamicBlockers, p: { x: number; z: number }, r: number): void {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    const cs = world.cellSize;
    const x0 = Math.floor((p.x - r) / cs);
    const x1 = Math.floor((p.x + r) / cs);
    const z0 = Math.floor((p.z - r) / cs);
    const z1 = Math.floor((p.z + r) / cs);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const cell = world.grid.get(cellKey(ix, iz));
        if (!cell) continue;
        for (const i of cell.b) moved = pushOutOfBox(p, r, world.boxes[i]!) || moved;
        for (const i of cell.c) moved = pushOutOfCircle(p, r, world.circles[i]!) || moved;
      }
    }
    for (const b of dyn.boxes) moved = pushOutOfBox(p, r, b) || moved;
    if (!moved) break;
  }
}

/** Move a circle by (dx, dz) with sub-stepping so it never tunnels through thin walls. */
export function moveCircle(
  world: StaticWorld,
  dyn: DynamicBlockers,
  p: { x: number; z: number },
  dx: number,
  dz: number,
  r: number,
): void {
  const dist = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(dist / 0.15));
  for (let i = 0; i < steps; i++) {
    p.x += dx / steps;
    p.z += dz / steps;
    resolveCircle(world, dyn, p, r);
  }
}

/** Liang–Barsky segment/AABB intersection test. */
export function segmentHitsAABB(x1: number, z1: number, x2: number, z2: number, b: AABB, pad = 0): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dz = z2 - z1;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return (
    clip(-dx, x1 - (b.minX - pad)) && clip(dx, b.maxX + pad - x1) && clip(-dz, z1 - (b.minZ - pad)) && clip(dz, b.maxZ + pad - z1)
  );
}

export function segmentHitsCircle(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  c: { x: number; z: number; r: number },
): boolean {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((c.x - x1) * dx + (c.z - z1) * dz) / len2));
  const px = x1 + dx * t - c.x;
  const pz = z1 + dz * t - c.z;
  return px * px + pz * pz < c.r * c.r;
}

export interface LosOptions {
  /** Only boxes at least this tall block sight (low furniture can be seen over). */
  minHeight?: number;
  includeCircles?: boolean;
  /** Circles at least this big block (trees are thin, rocks are not). */
  minCircleRadius?: number;
}

export function hasLineOfSight(
  world: StaticWorld,
  dyn: DynamicBlockers,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  opt: LosOptions = {},
): boolean {
  const minH = opt.minHeight ?? 1.3;
  const minX = Math.min(ax, bx);
  const maxX = Math.max(ax, bx);
  const minZ = Math.min(az, bz);
  const maxZ = Math.max(az, bz);
  const test = (b: SolidBox) =>
    b.h >= minH && b.maxX >= minX && b.minX <= maxX && b.maxZ >= minZ && b.minZ <= maxZ && segmentHitsAABB(ax, az, bx, bz, b);
  for (const b of world.boxes) if (test(b)) return false;
  for (const b of dyn.boxes) if (test(b)) return false;
  if (opt.includeCircles) {
    const minR = opt.minCircleRadius ?? 0;
    for (const c of world.circles) {
      if (c.r < minR) continue;
      if (c.x + c.r < minX || c.x - c.r > maxX || c.z + c.r < minZ || c.z - c.r > maxZ) continue;
      if (segmentHitsCircle(ax, az, bx, bz, c)) return false;
    }
  }
  return true;
}

/** True if a circle of radius r at (x,z) overlaps no solid. */
export function isFree(world: StaticWorld, dyn: DynamicBlockers, x: number, z: number, r: number): boolean {
  const p = { x, z };
  resolveCircle(world, dyn, p, r);
  return Math.abs(p.x - x) < 1e-6 && Math.abs(p.z - z) < 1e-6;
}

/** Which region (room/area) contains the point, if any. */
export function regionAt(map: MapDef, x: number, z: number) {
  // Smaller regions first so cabins win over the forest they sit in.
  let best: MapDef['regions'][number] | undefined;
  for (const r of map.regions) {
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) {
      if (!best || (r.maxX - r.minX) * (r.maxZ - r.minZ) < (best.maxX - best.minX) * (best.maxZ - best.minZ)) best = r;
    }
  }
  return best;
}
