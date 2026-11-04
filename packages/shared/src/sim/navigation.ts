import type { MapDef } from '../maps/types.ts';
import { isFree, type DynamicBlockers, type StaticWorld } from './collision.ts';

/**
 * Grid navigation graph used by the optional bot Hunter. Built once per map
 * against static geometry (doors treated as open); the bot handles closed doors
 * and dropped pallets reactively.
 */
export interface NavGraph {
  nodes: { x: number; z: number }[];
  edges: number[][];
  /** Hatch links: node index → destination node index. */
  hatchLinks: Map<number, { to: number; hatchId: string }>;
  cell: number;
  index: Map<number, number>;
}

const EMPTY: DynamicBlockers = { boxes: [] };
const key = (ix: number, iz: number) => (ix + 4096) * 8192 + (iz + 4096);

export function buildNavGraph(world: StaticWorld, clearance = 0.55): NavGraph {
  const map: MapDef = world.map;
  const cell = 1;
  const nodes: { x: number; z: number }[] = [];
  const index = new Map<number, number>();
  const seen = new Set<number>();
  for (const r of map.regions) {
    for (let x = Math.ceil(r.minX / cell) * cell; x <= r.maxX; x += cell) {
      for (let z = Math.ceil(r.minZ / cell) * cell; z <= r.maxZ; z += cell) {
        const ix = Math.round(x / cell);
        const iz = Math.round(z / cell);
        const k = key(ix, iz);
        if (seen.has(k)) continue;
        seen.add(k);
        if (!isFree(world, EMPTY, x, z, clearance)) continue;
        index.set(k, nodes.length);
        nodes.push({ x, z });
      }
    }
  }
  const edges: number[][] = nodes.map(() => []);
  const dirs = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  nodes.forEach((n, i) => {
    const ix = Math.round(n.x / cell);
    const iz = Math.round(n.z / cell);
    for (const [dx, dz] of dirs) {
      const j = index.get(key(ix + dx!, iz + dz!));
      if (j === undefined) continue;
      const m = nodes[j]!;
      // Mid-point clearance check catches thin walls between adjacent nodes.
      if (!isFree(world, EMPTY, (n.x + m.x) / 2, (n.z + m.z) / 2, clearance)) continue;
      edges[i]!.push(j);
      edges[j]!.push(i);
    }
  });
  const graph: NavGraph = { nodes, edges, hatchLinks: new Map(), cell, index };
  for (const h of map.hatches) {
    const a = nearestNode(graph, h.x, h.z);
    const dest = map.hatches.find((o) => o.id === h.to);
    if (a < 0 || !dest) continue;
    const b = nearestNode(graph, dest.x, dest.z);
    if (b < 0) continue;
    graph.hatchLinks.set(a, { to: b, hatchId: h.id });
    edges[a]!.push(b);
  }
  return graph;
}

export function nearestNode(g: NavGraph, x: number, z: number): number {
  const ix = Math.round(x / g.cell);
  const iz = Math.round(z / g.cell);
  for (let r = 0; r <= 6; r++) {
    let best = -1;
    let bestD = Infinity;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const j = g.index.get(key(ix + dx, iz + dz));
        if (j === undefined) continue;
        const n = g.nodes[j]!;
        const d = (n.x - x) ** 2 + (n.z - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/** A* over the nav graph. Returns node indices from start to goal (inclusive), or null. */
export function findPath(g: NavGraph, from: number, to: number, maxExpanded = 20000): number[] | null {
  if (from < 0 || to < 0) return null;
  if (from === to) return [from];
  const n = g.nodes.length;
  const gScore = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap: [number, number][] = [];
  const goal = g.nodes[to]!;
  const h = (i: number) => {
    const p = g.nodes[i]!;
    return Math.hypot(p.x - goal.x, p.z - goal.z);
  };
  const pushHeap = (item: [number, number]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p]![0] <= heap[i]![0]) break;
      [heap[p], heap[i]] = [heap[i]!, heap[p]!];
      i = p;
    }
  };
  const popHeap = (): [number, number] | undefined => {
    if (!heap.length) return undefined;
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
        if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!];
        i = m;
      }
    }
    return top;
  };
  gScore[from] = 0;
  pushHeap([h(from), from]);
  let expanded = 0;
  while (heap.length) {
    const [, cur] = popHeap()!;
    if (closed[cur]) continue;
    if (cur === to) break;
    closed[cur] = 1;
    if (++expanded > maxExpanded) return null;
    const cp = g.nodes[cur]!;
    for (const nb of g.edges[cur]!) {
      if (closed[nb]) continue;
      const np = g.nodes[nb]!;
      const link = g.hatchLinks.get(cur);
      const cost = link && link.to === nb ? 4 : Math.hypot(np.x - cp.x, np.z - cp.z);
      const t = gScore[cur]! + cost;
      if (t < gScore[nb]!) {
        gScore[nb] = t;
        came[nb] = cur;
        pushHeap([t + h(nb), nb]);
      }
    }
  }
  if (came[to] === -1) return null;
  const path: number[] = [to];
  let c = to;
  while (c !== from) {
    c = came[c]!;
    path.push(c);
  }
  return path.reverse();
}
