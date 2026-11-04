import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32, type Box, type MapDef } from '@shadow-hunt/shared';
import { tex } from '../textures';

/**
 * Builds all static geometry for a map as a handful of merged meshes and
 * instanced meshes (trees, rocks, grass) so a 500-tree forest costs ~20 draw calls.
 */

interface Arrays {
  pos: number[];
  nor: number[];
  uv: number[];
  idx: number[];
}

const newArrays = (): Arrays => ({ pos: [], nor: [], uv: [], idx: [] });

/** Box with world-space UVs so textures tile at a constant physical size. */
function appendBox(a: Arrays, cx: number, cy: number, cz: number, w: number, h: number, d: number, uvScale: number, vSpan = 0) {
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy, y1 = cy + h, z0 = cz - d / 2, z1 = cz + d / 2;
  const faces: [number[][], number[], (p: number[]) => [number, number]][] = [
    [[[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], (p) => [-p[2]! / uvScale, vy(p[1]!)]],
    [[[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], (p) => [p[2]! / uvScale, vy(p[1]!)]],
    [[[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], (p) => [p[0]! / uvScale, vy(p[1]!)]],
    [[[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], (p) => [-p[0]! / uvScale, vy(p[1]!)]],
    [[[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], (p) => [p[0]! / uvScale, p[2]! / uvScale]],
    [[[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], (p) => [p[0]! / uvScale, p[2]! / uvScale]],
  ];
  function vy(y: number) {
    return vSpan ? y / vSpan : y / uvScale;
  }
  for (const [verts, n, uvf] of faces) {
    const base = a.pos.length / 3;
    for (const v of verts) {
      a.pos.push(v[0]!, v[1]!, v[2]!);
      a.nor.push(n[0]!, n[1]!, n[2]!);
      const [u, vv] = uvf(v);
      a.uv.push(u, vv);
    }
    a.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function toGeometry(a: Arrays) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(a.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(a.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(a.uv, 2));
  g.setIndex(a.idx);
  g.computeBoundingSphere();
  return g;
}

function std(map: THREE.Texture | null, color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ map, color, roughness: 0.9, metalness: 0, ...opts });
}

export interface StaticMapResult {
  group: THREE.Group;
  dispose: () => void;
}

export function buildStaticMap(map: MapDef, opts: { shadows: boolean; detail: 'low' | 'high' }): StaticMapResult {
  const group = new THREE.Group();
  group.name = `map:${map.id}`;
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);
  const rnd = mulberry32(99);
  const isForest = map.id === 'blackwood';

  // ---------------- Materials
  const M = {
    wall: track(std(tex.asylumWall(), '#ffffff')),
    concrete: track(std(tex.concrete(), '#9a9a9a')),
    wood: track(std(tex.wood(), '#a89a88')),
    fence: track(std(tex.wood(), '#6f665a')),
    metal: track(std(tex.metal(), '#bfc4c8', { metalness: 0.55, roughness: 0.55 })),
    rust: track(std(tex.metal(), '#8a6a50', { metalness: 0.4, roughness: 0.7 })),
    fabric: track(std(null, '#6b675c', { roughness: 1 })),
    bark: track(std(tex.bark(), '#9a8a7a')),
    dark: track(std(null, '#0d0f12', { roughness: 0.4 })),
    glass: track(std(null, '#0a1018', { roughness: 0.15, metalness: 0.6 })),
  };

  // ---------------- Boxes grouped by material
  const buckets = new Map<THREE.Material, Arrays>();
  const put = (m: THREE.Material, b: Box, uvScale = 2, vSpan = 0) => {
    let a = buckets.get(m);
    if (!a) buckets.set(m, (a = newArrays()));
    appendBox(a, b.x, b.y ?? 0, b.z, b.w, b.h, b.d, uvScale, vSpan);
  };
  const vehicles: Box[] = [];
  for (const b of map.boxes) {
    switch (b.kind) {
      case 'wall':
      case 'wallInterior':
        put(M.wall, b, 3, 3.6);
        break;
      case 'lintel':
        put(isForest ? M.wood : M.wall, b, 3, isForest ? 0 : 3.6);
        break;
      case 'fence':
        put(M.fence, b, 2.5);
        break;
      case 'cabin':
        put(M.wood, b, 2.4);
        break;
      case 'bunker':
      case 'concrete':
        put(M.concrete, b, 3);
        break;
      case 'crate':
      case 'table':
      case 'counter':
        put(M.wood, b, 1.2);
        break;
      case 'log':
        put(M.bark, b, 1.5);
        break;
      case 'bed':
        put(M.metal, { ...b, h: 0.35 }, 1);
        put(M.fabric, { ...b, y: 0.35, h: b.h - 0.35, w: b.w * 0.94, d: b.d * 0.94 }, 1);
        break;
      case 'cabinet':
      case 'shelf':
      case 'optable':
        put(M.metal, b, 1.2);
        break;
      case 'boiler':
        put(M.rust, b, 1.5);
        break;
      case 'vehicle_bus':
      case 'vehicle_car':
      case 'vehicle_truck':
        vehicles.push(b);
        break;
      default:
        break;
    }
  }
  // Exit gate frames
  for (const e of map.exits) {
    const along = e.gate.w > e.gate.d ? 'x' : 'z';
    const half = (along === 'x' ? e.gate.w : e.gate.d) / 2 + 0.25;
    const post = (dx: number, dz: number) => put(M.concrete, { x: e.gate.x + dx, z: e.gate.z + dz, w: 0.5, d: 0.5, h: e.gate.h + 0.6, kind: 'concrete' }, 1);
    if (along === 'x') {
      post(-half, 0);
      post(half, 0);
    } else {
      post(0, -half);
      post(0, half);
    }
  }
  for (const [m, a] of buckets) {
    const mesh = new THREE.Mesh(track(toGeometry(a)), m);
    mesh.castShadow = opts.shadows;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ---------------- Vehicles (composed)
  for (const v of vehicles) {
    const g = new THREE.Group();
    g.position.set(v.x, 0, v.z);
    const alongZ = v.d > v.w;
    if (!alongZ) g.rotation.y = Math.PI / 2;
    const L = alongZ ? v.d : v.w;
    const W = alongZ ? v.w : v.d;
    const body = track(new THREE.BoxGeometry(W, v.h * 0.55, L));
    const paint = track(std(tex.metal(), v.kind === 'vehicle_bus' ? '#8a7a3a' : v.kind === 'vehicle_truck' ? '#4a5a62' : '#5a2a28', { metalness: 0.35, roughness: 0.6 }));
    const b = new THREE.Mesh(body, paint);
    b.position.y = v.h * 0.25 + 0.3;
    b.rotation.z = (rnd() - 0.5) * 0.06;
    g.add(b);
    const cabLen = v.kind === 'vehicle_bus' ? L * 0.95 : v.kind === 'vehicle_truck' ? L * 0.32 : L * 0.5;
    const cab = new THREE.Mesh(track(new THREE.BoxGeometry(W * 0.92, v.h * 0.42, cabLen)), paint);
    cab.position.set(0, v.h * 0.55 + 0.3 + v.h * 0.21 - 0.02, v.kind === 'vehicle_truck' ? -L / 2 + cabLen / 2 : 0);
    g.add(cab);
    const win = new THREE.Mesh(track(new THREE.BoxGeometry(W * 0.94, v.h * 0.22, cabLen * 0.9)), M.glass);
    win.position.copy(cab.position).setY(cab.position.y + v.h * 0.05);
    g.add(win);
    const wheelG = track(new THREE.CylinderGeometry(0.38, 0.38, 0.25, 14));
    const n = v.kind === 'vehicle_bus' ? 3 : 2;
    for (let i = 0; i < n; i++)
      for (const s of [-1, 1]) {
        const w = new THREE.Mesh(wheelG, M.dark);
        w.rotation.z = Math.PI / 2;
        w.position.set((s * W) / 2, 0.36 - (rnd() < 0.3 ? 0.15 : 0), -L / 2 + 0.8 + (i * (L - 1.6)) / (n - 1));
        g.add(w);
      }
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = opts.shadows;
        o.receiveShadow = true;
      }
    });
    group.add(g);
  }

  // ---------------- Floors & ceilings
  const floorMat = {
    forest: track(std(tex.forestFloor(), '#ffffff', { roughnessMap: tex.forestRough(), roughness: 1 })),
    gravel: track(std(tex.gravel(), '#ffffff', { roughness: 0.85 })),
    tile: track(std(tex.tileFloor(), '#ffffff', { roughnessMap: tex.tileRough(), roughness: 0.8, metalness: 0.05 })),
    concrete: track(std(tex.concrete(), '#7a7a7a', { roughness: 0.75 })),
    wood: track(std(tex.wood(), '#8a7a68', { roughness: 0.8 })),
  };
  const plane = (w: number, d: number, repeat: number) => {
    const g = new THREE.PlaneGeometry(w, d);
    const uv = g.attributes.uv!;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / repeat), uv.getY(i) * (d / repeat));
    return track(g);
  };
  if (isForest) {
    const ground = new THREE.Mesh(plane(260, 260, 6), floorMat.forest);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.001, 0);
    ground.receiveShadow = true;
    group.add(ground);
  }
  for (const r of map.regions) {
    const w = r.maxX - r.minX;
    const d = r.maxZ - r.minZ;
    const cx = (r.minX + r.maxX) / 2;
    const cz = (r.minZ + r.maxZ) / 2;
    if (!(isForest && r.id === 'forest')) {
      const f = new THREE.Mesh(plane(w, d, r.floor === 'tile' ? 4 : 4), floorMat[r.floor]);
      f.rotation.x = -Math.PI / 2;
      f.position.set(cx, 0.002, cz);
      f.receiveShadow = true;
      group.add(f);
    }
    if (r.indoor && r.ceiling > 0) {
      const isCabin = isForest && r.id !== 'bunker' && r.id !== 'hut';
      const c = new THREE.Mesh(plane(w, d, 4), isCabin ? M.wood : M.concrete);
      c.rotation.x = Math.PI / 2;
      c.position.set(cx, r.ceiling, cz);
      c.receiveShadow = true;
      group.add(c);
      if (isCabin) {
        // Gable roof seen from outside
        const span = Math.min(w, d);
        const len = Math.max(w, d);
        const rise = 1.2;
        const slope = Math.hypot(span / 2 + 0.4, rise);
        const roofMat = track(std(tex.wood(), '#3a332c', { side: THREE.DoubleSide }));
        const ang = Math.atan2(rise, span / 2 + 0.4);
        for (const s of [-1, 1]) {
          const roof = new THREE.Mesh(plane(len + 0.8, slope, 3), roofMat);
          roof.rotation.order = 'YXZ';
          roof.rotation.y = w >= d ? 0 : Math.PI / 2;
          // Tilt from flat so this half slopes down towards its own side.
          roof.rotation.x = -Math.PI / 2 + s * ang;
          const off = (s * (span / 2 + 0.4)) / 2;
          roof.position.set(cx + (w >= d ? 0 : off), r.ceiling + rise / 2, cz + (w >= d ? off : 0));
          roof.castShadow = opts.shadows;
          group.add(roof);
        }
      }
    }
  }

  // ---------------- Trees, rocks, pillars (instanced)
  const trees = map.circles.filter((c) => c.kind === 'tree');
  const dead = map.circles.filter((c) => c.kind === 'deadtree');
  const rocks = map.circles.filter((c) => c.kind === 'rock');
  const pillars = map.circles.filter((c) => c.kind === 'pillar');
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const p3 = new THREE.Vector3();
  const e = new THREE.Euler();

  if (trees.length + dead.length) {
    const trunkG = track(new THREE.CylinderGeometry(0.6, 1, 1, 7, 1));
    trunkG.translate(0, 0.5, 0);
    const all = [...trees, ...dead];
    const trunks = new THREE.InstancedMesh(trunkG, M.bark, all.length);
    all.forEach((t, i) => {
      e.set((rnd() - 0.5) * 0.06, rnd() * 6, (rnd() - 0.5) * 0.06);
      q.setFromEuler(e);
      m4.compose(p3.set(t.x, 0, t.z), q, sc.set(t.r, t.kind === 'deadtree' ? t.h * 0.7 : t.h * 0.75, t.r));
      trunks.setMatrixAt(i, m4);
    });
    trunks.castShadow = opts.shadows;
    trunks.receiveShadow = true;
    group.add(trunks);

    const foliageMat = track(std(tex.foliage(), '#5f7262', { roughness: 1 }));
    const layers = opts.detail === 'high' ? 4 : 3;
    const coneG = track(new THREE.ConeGeometry(1, 1, 8, 1));
    coneG.translate(0, 0.5, 0);
    const foliage = new THREE.InstancedMesh(coneG, foliageMat, trees.length * layers);
    let k = 0;
    for (const t of trees) {
      const base = t.h * 0.28;
      for (let l = 0; l < layers; l++) {
        const f = l / layers;
        const radius = (3.2 - f * 2.2) * (0.8 + t.r);
        const height = t.h * (0.42 - f * 0.08);
        e.set(0, rnd() * 6, 0);
        q.setFromEuler(e);
        m4.compose(p3.set(t.x, base + f * t.h * 0.55, t.z), q, sc.set(radius, height, radius));
        foliage.setMatrixAt(k++, m4);
      }
    }
    foliage.castShadow = opts.shadows;
    foliage.receiveShadow = false;
    group.add(foliage);

    if (dead.length) {
      const branchG = track(new THREE.CylinderGeometry(0.04, 0.09, 1, 5));
      branchG.translate(0, 0.5, 0);
      const per = 4;
      const branches = new THREE.InstancedMesh(branchG, M.bark, dead.length * per);
      let bi = 0;
      for (const t of dead) {
        for (let b = 0; b < per; b++) {
          e.set(0.6 + rnd() * 0.6, rnd() * Math.PI * 2, 0, 'YXZ');
          q.setFromEuler(e);
          m4.compose(p3.set(t.x, t.h * (0.3 + rnd() * 0.35), t.z), q, sc.set(1, 1.5 + rnd() * 2.5, 1));
          branches.setMatrixAt(bi++, m4);
        }
      }
      branches.castShadow = opts.shadows;
      group.add(branches);
    }
  }
  if (rocks.length) {
    const rg = new THREE.IcosahedronGeometry(1, 1);
    const pa = rg.attributes.position!;
    const rr = mulberry32(5);
    for (let i = 0; i < pa.count; i++) {
      const v = new THREE.Vector3(pa.getX(i), pa.getY(i), pa.getZ(i));
      v.multiplyScalar(0.8 + rr() * 0.35);
      pa.setXYZ(i, v.x, v.y, v.z);
    }
    rg.computeVertexNormals();
    track(rg);
    const rockMat = track(std(tex.concrete(), '#5f6058', { roughness: 0.95 }));
    const inst = new THREE.InstancedMesh(rg, rockMat, rocks.length);
    rocks.forEach((r, i) => {
      e.set(rnd() * 3, rnd() * 6, rnd() * 3);
      q.setFromEuler(e);
      m4.compose(p3.set(r.x, r.r * 0.25, r.z), q, sc.set(r.r * 1.05, r.r * 0.85, r.r * 1.05));
      inst.setMatrixAt(i, m4);
    });
    inst.castShadow = opts.shadows;
    inst.receiveShadow = true;
    group.add(inst);
  }
  if (pillars.length) {
    const pg = track(new THREE.CylinderGeometry(1, 1, 1, 12));
    pg.translate(0, 0.5, 0);
    const inst = new THREE.InstancedMesh(pg, M.concrete, pillars.length);
    pillars.forEach((c, i) => {
      m4.compose(p3.set(c.x, 0, c.z), q.identity(), sc.set(c.r, c.h, c.r));
      inst.setMatrixAt(i, m4);
    });
    inst.castShadow = opts.shadows;
    inst.receiveShadow = true;
    group.add(inst);
  }

  // ---------------- Decor
  const grass = map.decor.filter((d) => d.kind === 'grass' || d.kind === 'fern');
  if (grass.length) {
    const count = opts.detail === 'high' ? grass.length : Math.floor(grass.length * 0.5);
    const blade = new THREE.PlaneGeometry(1, 0.7);
    blade.translate(0, 0.35, 0);
    const b2 = blade.clone().rotateY(Math.PI / 2);
    const merged = track(mergeGeometries([blade, b2])!);
    const gm = track(new THREE.MeshStandardMaterial({ map: tex.grassBlade(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1, color: '#8a9a7a' }));
    const inst = new THREE.InstancedMesh(merged, gm, count);
    for (let i = 0; i < count; i++) {
      const d = grass[i]!;
      e.set(0, d.rot, 0);
      q.setFromEuler(e);
      const s = d.kind === 'fern' ? d.scale * 1.4 : d.scale;
      m4.compose(p3.set(d.x, 0, d.z), q, sc.set(s, s * (d.kind === 'fern' ? 0.8 : 1), s));
      inst.setMatrixAt(i, m4);
    }
    group.add(inst);
  }

  const decoMat = {
    blood: track(new THREE.MeshStandardMaterial({ map: tex.blood(), transparent: true, depthWrite: false, roughness: 0.25, polygonOffset: true, polygonOffsetFactor: -2 })),
    paper: track(std(tex.paper(), '#9a9588')),
  };
  const barrelG = track(new THREE.CylinderGeometry(0.32, 0.32, 0.9, 14));
  const tireG = track(new THREE.TorusGeometry(0.34, 0.13, 8, 16));
  const decalG = track(new THREE.PlaneGeometry(1, 1));
  for (const d of map.decor) {
    let o: THREE.Object3D | null = null;
    switch (d.kind) {
      case 'barrel': {
        o = new THREE.Mesh(barrelG, M.rust);
        o.position.set(d.x, 0.45, d.z);
        break;
      }
      case 'tire': {
        o = new THREE.Mesh(tireG, M.dark);
        o.rotation.x = Math.PI / 2;
        o.position.set(d.x, 0.13, d.z);
        break;
      }
      case 'blood':
      case 'papers': {
        o = new THREE.Mesh(decalG, d.kind === 'blood' ? decoMat.blood : decoMat.paper);
        o.rotation.set(-Math.PI / 2, 0, d.rot);
        const s = d.kind === 'blood' ? 2.2 * d.scale : 0.35;
        o.scale.set(s, s * (d.kind === 'papers' ? 1.3 : 1), 1);
        o.position.set(d.x, 0.012, d.z);
        break;
      }
      case 'chair':
      case 'wheelchair': {
        const g = new THREE.Group();
        const seat = new THREE.Mesh(track(new THREE.BoxGeometry(0.5, 0.06, 0.5)), d.kind === 'chair' ? M.wood : M.fabric);
        seat.position.y = 0.48;
        const back = new THREE.Mesh(track(new THREE.BoxGeometry(0.5, 0.5, 0.05)), d.kind === 'chair' ? M.wood : M.fabric);
        back.position.set(0, 0.75, 0.23);
        g.add(seat, back);
        if (d.kind === 'wheelchair') {
          for (const s of [-1, 1]) {
            const w = new THREE.Mesh(tireG, M.metal);
            w.scale.setScalar(0.8);
            w.rotation.y = Math.PI / 2;
            w.position.set(s * 0.3, 0.33, 0.05);
            g.add(w);
          }
        } else {
          for (const [x, z] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]] as const) {
            const leg = new THREE.Mesh(track(new THREE.BoxGeometry(0.04, 0.48, 0.04)), M.wood);
            leg.position.set(x, 0.24, z);
            g.add(leg);
          }
        }
        g.position.set(d.x, 0, d.z);
        g.rotation.y = d.rot;
        o = g;
        break;
      }
      case 'iv_stand': {
        const g = new THREE.Group();
        const pole = new THREE.Mesh(track(new THREE.CylinderGeometry(0.015, 0.015, 1.8, 6)), M.metal);
        pole.position.y = 0.9;
        const bag = new THREE.Mesh(track(new THREE.BoxGeometry(0.12, 0.2, 0.04)), track(std(null, '#7a2a2a', { transparent: true, opacity: 0.8 })));
        bag.position.set(0.08, 1.6, 0);
        g.add(pole, bag);
        g.position.set(d.x, 0, d.z);
        o = g;
        break;
      }
      case 'sign': {
        const g = new THREE.Group();
        const board = new THREE.Mesh(track(new THREE.BoxGeometry(1.4, 0.5, 0.05)), track(std(null, '#3a1a14')));
        board.position.y = 1.9;
        const post = new THREE.Mesh(track(new THREE.BoxGeometry(0.08, 1.9, 0.08)), M.wood);
        post.position.y = 0.95;
        g.add(board, post);
        g.position.set(d.x, 0, d.z);
        g.rotation.y = d.rot;
        o = g;
        break;
      }
      case 'lamp_post': {
        const g = new THREE.Group();
        const pole = new THREE.Mesh(track(new THREE.CylinderGeometry(0.06, 0.08, 4.8, 8)), M.metal);
        pole.position.y = 2.4;
        g.add(pole);
        g.position.set(d.x, 0, d.z);
        o = g;
        break;
      }
      case 'bones':
      case 'skull_pile': {
        const g = new THREE.Group();
        const boneM = track(std(null, '#b8ae98', { roughness: 0.8 }));
        const n = d.kind === 'skull_pile' ? 6 : 4;
        for (let i = 0; i < n; i++) {
          const b =
            d.kind === 'skull_pile' && i % 2 === 0
              ? new THREE.Mesh(track(new THREE.SphereGeometry(0.11, 8, 6)), boneM)
              : new THREE.Mesh(track(new THREE.CylinderGeometry(0.025, 0.03, 0.45, 5)), boneM);
          b.position.set((rnd() - 0.5) * 0.6, 0.06 + (d.kind === 'skull_pile' ? i * 0.04 : 0), (rnd() - 0.5) * 0.6);
          b.rotation.set(Math.PI / 2, rnd() * 3, rnd());
          g.add(b);
        }
        g.position.set(d.x, 0, d.z);
        o = g;
        break;
      }
      case 'bucket': {
        o = new THREE.Mesh(track(new THREE.CylinderGeometry(0.16, 0.12, 0.3, 10)), M.rust);
        o.position.set(d.x, 0.15, d.z);
        break;
      }
      case 'drain': {
        o = new THREE.Mesh(track(new THREE.CircleGeometry(0.25, 12)), M.dark);
        o.rotation.x = -Math.PI / 2;
        o.position.set(d.x, 0.01, d.z);
        break;
      }
      default:
        break;
    }
    if (o) {
      o.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) {
          c.castShadow = opts.shadows && d.kind !== 'blood' && d.kind !== 'papers';
          c.receiveShadow = true;
        }
      });
      group.add(o);
    }
  }

  // Bulbs for every light position (cheap emissive glow, real lights come from the pool).
  for (const l of map.lights) {
    const bulb = new THREE.Mesh(track(new THREE.SphereGeometry(0.09, 8, 6)), track(new THREE.MeshBasicMaterial({ color: l.color })));
    bulb.position.set(l.x, l.y, l.z);
    bulb.userData.light = l;
    bulb.name = 'bulb';
    group.add(bulb);
  }

  return {
    group,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}
