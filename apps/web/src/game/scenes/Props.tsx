import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { MapDef } from '@shadow-hunt/shared';
import { currentRoom } from '../../multiplayer/net';
import { tex } from '../textures';

/**
 * Interactive props whose look depends on replicated state (generators, gates,
 * doors, pallets, keys, cages…). Built imperatively once, then mutated per frame
 * from the live Colyseus state — React never re-renders for state changes here.
 */
export function Props({ map, shadows }: { map: MapDef; shadows: boolean }) {
  const built = useMemo(() => buildProps(map, shadows), [map, shadows]);
  useEffect(() => () => built.dispose(), [built]);
  useFrame((_, dt) => built.update(dt));
  return <primitive object={built.group} />;
}

function buildProps(map: MapDef, shadows: boolean) {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const T = <X extends { dispose(): void }>(x: X) => (disposables.push(x), x);
  const isForest = map.id === 'blackwood';
  const std = (color: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
    T(new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o }));
  const metal = std('#5a6066', { map: tex.metal(), metalness: 0.6, roughness: 0.5 });
  const rust = std('#7a5a44', { map: tex.metal(), metalness: 0.4, roughness: 0.75 });
  const wood = std('#8a7a66', { map: tex.wood() });
  const dark = std('#111214', { roughness: 0.5 });
  const shade = (o: THREE.Object3D) =>
    o.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) {
        c.castShadow = shadows;
        c.receiveShadow = true;
      }
    });
  const box = (w: number, h: number, d: number) => T(new THREE.BoxGeometry(w, h, d));
  const cyl = (rt: number, rb: number, h: number, s = 12) => T(new THREE.CylinderGeometry(rt, rb, h, s));
  const glowTex = tex.glow();

  // ---------------- Generators
  const gens = map.generators.map((g) => {
    const root = new THREE.Group();
    root.position.set(g.x, 0, g.z);
    root.rotation.y = g.rot;
    const body = new THREE.Mesh(box(1.1, 0.75, 0.8), rust);
    body.position.y = 0.375;
    const engine = new THREE.Mesh(cyl(0.22, 0.22, 0.9), metal);
    engine.rotation.z = Math.PI / 2;
    engine.position.set(0, 0.95, 0);
    const pipe = new THREE.Mesh(cyl(0.05, 0.05, 0.8, 8), dark);
    pipe.position.set(0.38, 1.1, 0.2);
    const piston = new THREE.Mesh(cyl(0.08, 0.08, 0.3, 8), metal);
    piston.position.set(-0.3, 1.2, 0);
    const bulbMat = T(new THREE.MeshBasicMaterial({ color: '#2a2a20' }));
    const bulb = new THREE.Mesh(T(new THREE.SphereGeometry(0.07, 10, 8)), bulbMat);
    bulb.position.set(0.3, 1.3, 0);
    const glow = new THREE.Sprite(T(new THREE.SpriteMaterial({ map: glowTex, color: '#ffd28a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 })));
    glow.scale.setScalar(1.2);
    glow.position.copy(bulb.position);
    const front = new THREE.Mesh(box(0.6, 0.35, 0.02), dark);
    front.position.set(0, 0.45, 0.41);
    root.add(body, engine, pipe, piston, bulb, glow, front);
    shade(root);
    group.add(root);
    return { id: g.id, root, piston, bulbMat, glow, shake: 0 };
  });

  // ---------------- Exit gates + panels
  const exits = map.exits.map((e) => {
    const alongX = e.gate.w > e.gate.d;
    const width = alongX ? e.gate.w : e.gate.d;
    const gate = new THREE.Group();
    gate.position.set(e.gate.x, 0, e.gate.z);
    if (!alongX) gate.rotation.y = Math.PI / 2;
    const slider = new THREE.Group();
    gate.add(slider);
    if (isForest) {
      const bars = Math.round(width / 0.35);
      for (let i = 0; i <= bars; i++) {
        const b = new THREE.Mesh(cyl(0.035, 0.035, e.gate.h, 6), metal);
        b.position.set(-width / 2 + (i * width) / bars, e.gate.h / 2, 0);
        slider.add(b);
      }
      for (const y of [0.3, e.gate.h - 0.2]) {
        const rail = new THREE.Mesh(box(width, 0.1, 0.08), metal);
        rail.position.set(0, y, 0);
        slider.add(rail);
      }
    } else {
      const shutter = new THREE.Mesh(box(width, e.gate.h, 0.12), std('#4a4f52', { map: tex.metal(), metalness: 0.5 }));
      shutter.position.y = e.gate.h / 2;
      slider.add(shutter);
      for (let y = 0.3; y < e.gate.h; y += 0.3) {
        const slat = new THREE.Mesh(box(width, 0.03, 0.14), dark);
        slat.position.y = y;
        slider.add(slat);
      }
    }
    shade(gate);
    group.add(gate);

    const panel = new THREE.Group();
    panel.position.set(e.panel.x, 0, e.panel.z);
    panel.rotation.y = e.panel.rot;
    const post = new THREE.Mesh(box(0.45, 1.35, 0.4), metal);
    post.position.y = 0.675;
    const screen = new THREE.Mesh(box(0.34, 0.3, 0.02), dark);
    screen.position.set(0, 1.12, 0.21);
    panel.add(post, screen);
    const lampMats = ['power', 'keys', 'open'].map((_, i) => {
      const m = T(new THREE.MeshBasicMaterial({ color: '#3a0a0a' }));
      const lamp = new THREE.Mesh(T(new THREE.SphereGeometry(0.03, 8, 6)), m);
      lamp.position.set(-0.1 + i * 0.1, 0.9, 0.21);
      panel.add(lamp);
      return m;
    });
    const beacon = new THREE.Sprite(T(new THREE.SpriteMaterial({ map: glowTex, color: '#ff3020', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
    beacon.position.set(0, 1.55, 0);
    beacon.scale.setScalar(0.8);
    panel.add(beacon);
    shade(panel);
    group.add(panel);
    return { id: e.id, slider, h: e.gate.h, width, lampMats, beacon, openT: 0 };
  });

  // ---------------- Doors (hinged leaves)
  const doors = map.doors.map((d) => {
    const pivot = new THREE.Group();
    const leafW = d.width - 0.06;
    if (d.axis === 'x') pivot.position.set(d.x - d.width / 2 + 0.03, 0, d.z);
    else {
      pivot.position.set(d.x, 0, d.z - d.width / 2 + 0.03);
      pivot.rotation.y = -Math.PI / 2;
    }
    const base = pivot.rotation.y;
    const leaf = new THREE.Mesh(box(leafW, 2.3, 0.07), d.locked ? std('#4a3a30', { map: tex.metal(), metalness: 0.3 }) : wood);
    leaf.position.set(leafW / 2, 1.15, 0);
    const knob = new THREE.Mesh(T(new THREE.SphereGeometry(0.04, 8, 6)), metal);
    knob.position.set(leafW - 0.12, 1.05, 0.06);
    pivot.add(leaf, knob);
    shade(pivot);
    group.add(pivot);
    return { id: d.id, pivot, base, angle: d.startsOpen ? 1 : 0 };
  });

  // ---------------- Pallets
  const pallets = map.pallets.map((p) => {
    const root = new THREE.Group();
    root.position.set(p.x, 0, p.z);
    if (p.axis === 'z') root.rotation.y = Math.PI / 2;
    const slab = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const plank = new THREE.Mesh(box(p.length, 0.1, 0.13), wood);
      plank.position.set(0, 0, -0.32 + i * 0.16);
      slab.add(plank);
    }
    for (const x of [-p.length / 2 + 0.1, 0, p.length / 2 - 0.1]) {
      const runner = new THREE.Mesh(box(0.1, 0.12, 0.75), wood);
      runner.position.set(x, -0.1, 0);
      slab.add(runner);
    }
    root.add(slab);
    shade(root);
    group.add(root);
    return { id: p.id, root, slab, t: 0 };
  });

  // ---------------- Lockers
  for (const l of map.lockers) {
    const root = new THREE.Group();
    root.position.set(l.x, 0, l.z);
    root.rotation.y = l.rot;
    const mat = isForest ? wood : std('#3c4a50', { map: tex.metal(), metalness: 0.5, roughness: 0.55 });
    const body = new THREE.Mesh(box(0.95, 2.1, 0.6), mat);
    body.position.y = 1.05;
    root.add(body);
    for (let i = 0; i < 6; i++) {
      const vent = new THREE.Mesh(box(0.5, 0.03, 0.02), dark);
      vent.position.set(0, 1.55 + i * 0.06, 0.31);
      root.add(vent);
    }
    if (isForest) {
      const roof = new THREE.Mesh(box(1.1, 0.08, 0.75), wood);
      roof.position.y = 2.15;
      roof.rotation.x = 0.15;
      root.add(roof);
    }
    shade(root);
    group.add(root);
  }

  // ---------------- Cages
  const cages = map.cages.map((c) => {
    const root = new THREE.Group();
    root.position.set(c.x, 0, c.z);
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const bar = new THREE.Mesh(cyl(0.025, 0.025, 2.2, 5), rust);
      bar.position.set(Math.cos(a) * 0.62, 1.1, Math.sin(a) * 0.62);
      root.add(bar);
    }
    for (const y of [0.05, 2.2]) {
      const ring = new THREE.Mesh(T(new THREE.TorusGeometry(0.62, 0.035, 6, 24)), rust);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      root.add(ring);
    }
    const hook = new THREE.Mesh(T(new THREE.TorusGeometry(0.12, 0.02, 6, 12, Math.PI * 1.4)), metal);
    hook.position.y = 2.45;
    root.add(hook);
    shade(root);
    group.add(root);
    return { id: c.id, root, t: 0 };
  });

  // ---------------- Hatches / stairwells
  for (const h of map.hatches) {
    const root = new THREE.Group();
    root.position.set(h.x, 0.01, h.z);
    const hole = new THREE.Mesh(T(new THREE.PlaneGeometry(1.3, 1.3)), T(new THREE.MeshBasicMaterial({ color: '#000000' })));
    hole.rotation.x = -Math.PI / 2;
    root.add(hole);
    for (const [x, z, w, d] of [[0, -0.7, 1.5, 0.12], [0, 0.7, 1.5, 0.12], [-0.7, 0, 0.12, 1.4], [0.7, 0, 0.12, 1.4]] as const) {
      const rim = new THREE.Mesh(box(w, 0.08, d), metal);
      rim.position.set(x, 0.04, z);
      root.add(rim);
    }
    const rail = new THREE.Mesh(cyl(0.025, 0.025, 1, 6), metal);
    rail.position.set(0.7, 0.5, -0.7);
    root.add(rail);
    shade(root);
    group.add(root);
  }

  // ---------------- Keys & pickups
  const keyMat = T(new THREE.MeshStandardMaterial({ color: '#e8c060', emissive: '#a07010', emissiveIntensity: 1.6, metalness: 0.9, roughness: 0.3 }));
  const keyGeo = (() => {
    const g = new THREE.Group();
    const bow = new THREE.Mesh(T(new THREE.TorusGeometry(0.05, 0.015, 6, 12)), keyMat);
    const shaft = new THREE.Mesh(box(0.02, 0.16, 0.015), keyMat);
    shaft.position.y = -0.12;
    const bit = new THREE.Mesh(box(0.05, 0.03, 0.015), keyMat);
    bit.position.set(0.025, -0.18, 0);
    g.add(bow, shaft, bit);
    return g;
  })();
  const keyPool: { root: THREE.Group; glow: THREE.Sprite }[] = [];
  for (let i = 0; i < 8; i++) {
    const root = new THREE.Group();
    root.add(keyGeo.clone());
    const glow = new THREE.Sprite(T(new THREE.SpriteMaterial({ map: glowTex, color: '#ffcf60', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 })));
    glow.scale.setScalar(0.9);
    root.add(glow);
    root.visible = false;
    group.add(root);
    keyPool.push({ root, glow });
  }

  const pickupMeshes = map.pickups.map((p) => {
    const root = new THREE.Group();
    root.position.set(p.x, 0, p.z);
    let m: THREE.Object3D;
    if (p.kind === 'battery') {
      m = new THREE.Mesh(cyl(0.05, 0.05, 0.16, 10), T(new THREE.MeshStandardMaterial({ color: '#3a7a4a', emissive: '#1a5a2a', emissiveIntensity: 1 })));
      m.rotation.z = Math.PI / 2;
    } else if (p.kind === 'medkit') {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(box(0.32, 0.16, 0.22), std('#d8d4c8')));
      const cross1 = new THREE.Mesh(box(0.14, 0.01, 0.04), T(new THREE.MeshBasicMaterial({ color: '#c01818' })));
      cross1.position.y = 0.085;
      const cross2 = cross1.clone();
      cross2.rotation.y = Math.PI / 2;
      g.add(cross1, cross2);
      m = g;
    } else {
      m = new THREE.Mesh(cyl(0.03, 0.03, 0.2, 8), T(new THREE.MeshStandardMaterial({ color: '#b02020', emissive: '#501010', emissiveIntensity: 1 })));
      m.rotation.z = Math.PI / 2;
    }
    m.position.y = 0.1;
    root.add(m);
    const glow = new THREE.Sprite(T(new THREE.SpriteMaterial({ map: glowTex, color: p.kind === 'battery' ? '#60ff90' : p.kind === 'medkit' ? '#ffffff' : '#ff6040', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.35 })));
    glow.scale.setScalar(0.7);
    glow.position.y = 0.15;
    root.add(glow);
    group.add(root);
    return { id: p.id, root };
  });

  let t = 0;
  const update = (dt: number) => {
    t += dt;
    const s = currentRoom()?.state as any;
    if (!s || !s.generators) return;
    const powered = s.powerOn as boolean;

    for (const g of gens) {
      const st = s.generators.get(g.id);
      if (!st) continue;
      const active = st.repairers > 0;
      g.piston.position.y = 1.2 + (active ? Math.abs(Math.sin(t * 16)) * 0.08 : 0);
      if (st.completed) {
        g.bulbMat.color.set('#fff2c0');
        g.glow.material.opacity = 0.9;
      } else if (active) {
        const f = 0.5 + 0.5 * Math.sin(t * 20 + g.root.position.x);
        g.bulbMat.color.setRGB(0.6 + f * 0.4, 0.45 + f * 0.3, 0.1);
        g.glow.material.opacity = 0.2 + f * 0.4 * st.progress;
      } else {
        g.bulbMat.color.set(st.kicked ? '#7a1010' : '#2a2a20');
        g.glow.material.opacity = st.kicked ? 0.25 + 0.2 * Math.sin(t * 6) : 0;
        g.glow.material.color.set(st.kicked ? '#ff3020' : '#ffd28a');
      }
      g.root.position.y = active || st.completed ? Math.sin(t * 40) * 0.005 : 0;
    }

    for (const e of exits) {
      const st = s.exits.get(e.id);
      if (!st) continue;
      const target = st.open ? 1 : 0;
      e.openT += (target - e.openT) * Math.min(1, dt * 0.8);
      if (isForest) e.slider.position.x = e.openT * e.width * 0.96;
      else e.slider.position.y = e.openT * (e.h - 0.3);
      const hasKeys = s.keysDeposited >= s.keysRequired;
      e.lampMats[0]!.color.set(powered ? '#40ff60' : '#3a0a0a');
      e.lampMats[1]!.color.set(hasKeys ? '#40ff60' : s.keysDeposited > 0 ? '#ffb030' : '#3a0a0a');
      e.lampMats[2]!.color.set(st.open ? '#40ff60' : st.progress > 0 ? '#ffb030' : '#3a0a0a');
      const pulse = 0.5 + 0.5 * Math.sin(t * (st.progress > 0 && !st.open ? 10 : 3));
      e.beacon.material.color.set(st.open ? '#50ff70' : powered ? '#ffb030' : '#ff2a1a');
      e.beacon.material.opacity = powered ? 0.5 + pulse * 0.5 : 0.25 + pulse * 0.2;
    }

    for (const d of doors) {
      const st = s.doors.get(d.id);
      if (!st) continue;
      const target = st.open ? 1 : 0;
      d.angle += (target - d.angle) * Math.min(1, dt * 7);
      d.pivot.rotation.y = d.base + d.angle * 1.45;
    }

    for (const p of pallets) {
      const st = s.pallets.get(p.id) as string | undefined;
      p.root.visible = st !== 'broken';
      const target = st === 'down' ? 1 : 0;
      p.t += (target - p.t) * Math.min(1, dt * 14);
      // Upright, leaning against the side; falls flat across the gap when dropped.
      p.slab.rotation.x = (1 - p.t) * -1.35;
      p.slab.position.set(0, 0.2 + (1 - p.t) * 0.85, -(1 - p.t) * 0.55);
    }

    for (const c of cages) {
      const occupied = !!s.cages.get(c.id);
      c.t += dt;
      c.root.rotation.y = occupied ? Math.sin(c.t * 3) * 0.04 : 0;
    }

    let k = 0;
    s.keys.forEach((key: any) => {
      if (key.carriedBy || key.deposited || k >= keyPool.length) return;
      const item = keyPool[k++]!;
      item.root.visible = true;
      item.root.position.set(key.x, 0.9 + Math.sin(t * 2 + k) * 0.08, key.z);
      item.root.rotation.y = t * 1.5;
      item.glow.material.opacity = 0.55 + Math.sin(t * 3) * 0.25;
    });
    for (; k < keyPool.length; k++) keyPool[k]!.root.visible = false;

    for (const p of pickupMeshes) {
      p.root.visible = !s.pickups.get(p.id);
      p.root.rotation.y = t * 0.8;
    }
  };

  return { group, update, dispose: () => disposables.forEach((d) => d.dispose()) };
}
