import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { FxMsg, MapDef } from '@shadow-hunt/shared';
import { bus } from '../../multiplayer/events';
import { currentRoom } from '../../multiplayer/net';
import { useHud } from '../../stores/hud';
import { audio } from '../audio/audio';
import { tex } from '../textures';

interface Particle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  color: THREE.Color;
}

/**
 * Visual + audio reactions to server events: sparks, smoke, blood, noise rings
 * for the hunter, scratch marks, Echo Sense silhouettes and screen feedback.
 */
export function Effects({ map }: { map: MapDef }) {
  const sys = useMemo(() => createEffects(), []);
  useEffect(() => () => sys.dispose(), [sys]);

  useEffect(() => {
    const offs = [
      bus.on('fx', (m) => onFx(sys, m, map)),
      bus.on('noise', (m) => sys.ring(m.x, m.z, m.kind === 'step' ? '#ff8a6a' : '#ff3a2a', m.kind === 'sprint' || m.kind === 'step' ? 1.2 : 2.8)),
      bus.on('track', (m) => sys.mark(m.x, m.z, m.kind)),
      bus.on('reveal', (m) => m.targets.forEach((t) => sys.silhouette(t.x, t.z, m.duration + 0.2))),
    ];
    return () => offs.forEach((o) => o());
  }, [sys, map]);

  useFrame((_, dt) => sys.update(dt));
  return <primitive object={sys.group} />;
}

function selfId() {
  return currentRoom()?.sessionId;
}

function onFx(sys: ReturnType<typeof createEffects>, m: FxMsg, map: MapDef) {
  const me = selfId();
  switch (m.kind) {
    case 'swing':
      if (m.by !== me) audio.at('swing', m.x, m.z, 0.8);
      break;
    case 'hit':
      audio.at('hit', m.x, m.z, 1);
      audio.at('hurt', m.x, m.z, 0.9, 0.95 + Math.random() * 0.15);
      sys.burst(m.x, 1.2, m.z, '#7a0a0a', 26, 3, 0.9);
      if (m.target === me) useHud.getState().set({ hitFlash: performance.now() });
      break;
    case 'down':
      audio.at('down', m.x, m.z, 1);
      sys.burst(m.x, 0.6, m.z, '#6a0808', 30, 2, 1.1);
      if (m.target === me) useHud.getState().set({ hitFlash: performance.now() });
      break;
    case 'capture':
      audio.at('cage', m.x2 ?? m.x, m.z2 ?? m.z, 1);
      sys.burst(m.x2 ?? m.x, 1.2, m.z2 ?? m.z, '#2a2a30', 30, 1.5, 1.6, 0.35);
      break;
    case 'rescue':
      audio.at('cage', m.x, m.z, 0.8, 1.2);
      sys.burst(m.x, 1.2, m.z, '#c8b080', 20, 2, 0.8);
      break;
    case 'eliminated':
      audio.at('eliminated', m.x, m.z, 1);
      sys.burst(m.x, 1.5, m.z, '#050505', 60, 2.5, 2.5, 0.5);
      break;
    case 'escape':
      audio.at('escape', m.x, m.z, m.target === me ? 1 : 0.5);
      break;
    case 'roar':
      audio.at('roar', m.x, m.z, 1, 1, 2);
      sys.shockwave(m.x, m.z, '#8a1010', 24);
      break;
    case 'gen_fail':
      audio.at('gen_fail', m.x, m.z, 1);
      sys.burst(m.x, 1.2, m.z, '#ffd27a', 40, 4, 0.6, 0.06, true);
      sys.burst(m.x, 1.3, m.z, '#303030', 16, 1, 2, 0.4);
      if (m.by === me) audio.play('skill_fail', 0.7);
      break;
    case 'gen_done':
      audio.at('gen_done', m.x, m.z, 1);
      sys.burst(m.x, 1.3, m.z, '#ffe8a0', 30, 3, 0.8, 0.07, true);
      break;
    case 'gen_kick':
      audio.at('gen_fail', m.x, m.z, 0.6, 0.7);
      sys.burst(m.x, 1, m.z, '#ffb060', 20, 3, 0.5, 0.05, true);
      break;
    case 'power_on':
      audio.play('power_on', 0.9);
      setTimeout(() => audio.play('alarm', 0.5), 1200);
      break;
    case 'pallet_drop':
      audio.at('pallet', m.x, m.z, 1);
      sys.burst(m.x, 0.3, m.z, '#6a5a44', 24, 2.5, 0.9, 0.08);
      break;
    case 'pallet_stun':
      audio.at('hit', m.x, m.z, 0.8, 0.7);
      break;
    case 'pallet_break':
      audio.at('pallet', m.x, m.z, 1, 0.8);
      sys.burst(m.x, 0.5, m.z, '#8a7a5a', 40, 4, 1.1, 0.1);
      break;
    case 'door':
      audio.at('door', m.x, m.z, 0.8, m.target === 'close' ? 1.15 : 0.9);
      break;
    case 'locker':
      audio.at('locker', m.x, m.z, 0.9);
      break;
    case 'exit_open':
      audio.at('alarm', m.x, m.z, 1);
      audio.play('power_on', 0.4);
      sys.burst(m.x, 2, m.z, '#a0ffb0', 40, 2, 1.5, 0.08, true);
      break;
    case 'key_pickup':
    case 'key_deposit':
      audio.at('key', m.x, m.z, 0.9);
      break;
    case 'shadow_step':
      audio.at('shadow_step', m.x, m.z, 1);
      sys.burst(m.x, 1.2, m.z, '#000000', 50, 1.2, 1.6, 0.45);
      if (m.x2 !== undefined && m.z2 !== undefined) {
        sys.burst(m.x2, 1.2, m.z2, '#05060a', 50, 1.2, 1.6, 0.45);
        if (m.target === 'end') audio.at('whisper', m.x2, m.z2, 1);
      }
      break;
    case 'charge_start':
      audio.at('charge', m.x, m.z, 1);
      break;
    case 'charge_wall':
      audio.at('hit', m.x, m.z, 1, 0.6);
      sys.burst(m.x, 1.4, m.z, '#6a6a6a', 40, 3, 1, 0.12);
      break;
    case 'echo_sense':
      audio.at('echo', m.x, m.z, 1);
      sys.shockwave(m.x, m.z, '#a02020', 30);
      break;
    case 'firecracker':
      audio.at('firecracker', m.x, m.z, 1);
      sys.burst(m.x, 0.4, m.z, '#ffdca0', 70, 6, 0.6, 0.06, true);
      sys.flash(m.x, m.z);
      break;
    case 'hatch':
      audio.at('door', m.x, m.z, 0.8, 0.7);
      break;
  }
  void map;
}

function createEffects() {
  const group = new THREE.Group();
  const MAX = 900;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(MAX * 3);
  const col = new Float32Array(MAX * 3);
  const size = new Float32Array(MAX);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: tex.glow() } },
    vertexShader: `attribute float size; varying vec3 vColor; void main(){ vColor = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * (300.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D map; varying vec3 vColor; void main(){ vec4 t = texture2D(map, gl_PointCoord); if (t.a < 0.02) discard; gl_FragColor = vec4(vColor, t.a); }`,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  group.add(points);
  const additive = mat.clone();
  additive.blending = THREE.AdditiveBlending;
  const glowGeo = geo.clone();
  const glowPoints = new THREE.Points(glowGeo, additive);
  glowPoints.frustumCulled = false;
  group.add(glowPoints);

  const parts: (Particle & { glow: boolean })[] = Array.from({ length: MAX }, () => ({
    active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0.1, color: new THREE.Color(), glow: false,
  }));
  let cursor = 0;

  // Rings (noise pings / shockwaves)
  const ringGeo = new THREE.RingGeometry(0.85, 1, 48);
  ringGeo.rotateX(-Math.PI / 2);
  const rings: { mesh: THREE.Mesh; t: number; max: number; scale: number }[] = [];
  // Scratch marks
  const markGeo = new THREE.PlaneGeometry(0.5, 0.12);
  markGeo.rotateX(-Math.PI / 2);
  const marks: { mesh: THREE.Mesh; t: number }[] = [];
  // Silhouettes (Echo Sense)
  const silGeo = new THREE.CapsuleGeometry(0.32, 1.1, 4, 8);
  const silMat = new THREE.MeshBasicMaterial({ color: '#ff2a2a', transparent: true, opacity: 0.6, depthTest: false, blending: THREE.AdditiveBlending });
  const sils: { mesh: THREE.Mesh; t: number; max: number }[] = [];
  // Firecracker flash light
  const flashLight = new THREE.PointLight('#ffd8a0', 0, 18, 1.5);
  group.add(flashLight);
  let flashT = 0;

  const spawn = (x: number, y: number, z: number, color: string, speed: number, life: number, sz: number, glow: boolean) => {
    const p = parts[cursor]!;
    cursor = (cursor + 1) % MAX;
    p.active = true;
    p.x = x;
    p.y = y;
    p.z = z;
    const a = Math.random() * Math.PI * 2;
    const u = Math.random() * 2 - 1;
    const r = Math.sqrt(1 - u * u);
    p.vx = Math.cos(a) * r * speed;
    p.vy = Math.abs(u) * speed * 0.8 + (glow ? 1 : 0.3);
    p.vz = Math.sin(a) * r * speed;
    p.life = 0;
    p.max = life * (0.6 + Math.random() * 0.6);
    p.size = sz;
    p.color.set(color);
    p.glow = glow;
  };

  return {
    group,
    burst(x: number, y: number, z: number, color: string, n: number, speed: number, life: number, sz = 0.06, glow = false) {
      for (let i = 0; i < n; i++) spawn(x, y, z, color, speed * (0.3 + Math.random()), life, sz * (0.6 + Math.random()), glow);
    },
    ring(x: number, z: number, color: string, scale: number) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }));
      m.position.set(x, 0.15, z);
      m.renderOrder = 10;
      group.add(m);
      rings.push({ mesh: m, t: 0, max: 1.6, scale });
    },
    shockwave(x: number, z: number, color: string, radius: number) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
      m.position.set(x, 0.2, z);
      group.add(m);
      rings.push({ mesh: m, t: 0, max: 1.2, scale: radius });
    },
    mark(x: number, z: number, kind: 'scratch' | 'blood') {
      const m = new THREE.Mesh(
        markGeo,
        new THREE.MeshBasicMaterial({ color: kind === 'scratch' ? '#ff5a3a' : '#a00808', transparent: true, opacity: 0.85, depthTest: false }),
      );
      m.position.set(x + (Math.random() - 0.5) * 0.4, 0.04, z + (Math.random() - 0.5) * 0.4);
      m.rotation.y = Math.random() * Math.PI;
      m.renderOrder = 9;
      group.add(m);
      marks.push({ mesh: m, t: 0 });
      if (marks.length > 120) {
        const old = marks.shift()!;
        group.remove(old.mesh);
        (old.mesh.material as THREE.Material).dispose();
      }
    },
    silhouette(x: number, z: number, life: number) {
      const m = new THREE.Mesh(silGeo, silMat.clone());
      m.position.set(x, 0.9, z);
      m.renderOrder = 20;
      group.add(m);
      sils.push({ mesh: m, t: 0, max: life });
    },
    flash(x: number, z: number) {
      flashLight.position.set(x, 1, z);
      flashT = 0.35;
    },
    update(dt: number) {
      let n = 0;
      let g = 0;
      const gpos = glowGeo.attributes.position!.array as Float32Array;
      const gcol = glowGeo.attributes.color!.array as Float32Array;
      const gsize = glowGeo.attributes.size!.array as Float32Array;
      for (const p of parts) {
        if (!p.active) continue;
        p.life += dt;
        if (p.life >= p.max) {
          p.active = false;
          continue;
        }
        p.vy -= (p.glow ? 6 : 1.2) * dt;
        p.x += p.vx * dt;
        p.y = Math.max(0.02, p.y + p.vy * dt);
        p.z += p.vz * dt;
        p.vx *= 0.97;
        p.vz *= 0.97;
        const k = 1 - p.life / p.max;
        if (p.glow) {
          gpos.set([p.x, p.y, p.z], g * 3);
          gcol.set([p.color.r * k, p.color.g * k, p.color.b * k], g * 3);
          gsize[g] = p.size * (0.5 + k);
          g++;
        } else {
          pos.set([p.x, p.y, p.z], n * 3);
          col.set([p.color.r, p.color.g, p.color.b], n * 3);
          size[n] = p.size * (1.5 - k * 0.5) * k;
          n++;
        }
      }
      geo.setDrawRange(0, n);
      glowGeo.setDrawRange(0, g);
      geo.attributes.position!.needsUpdate = geo.attributes.color!.needsUpdate = geo.attributes.size!.needsUpdate = true;
      glowGeo.attributes.position!.needsUpdate = glowGeo.attributes.color!.needsUpdate = glowGeo.attributes.size!.needsUpdate = true;

      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i]!;
        r.t += dt;
        const k = r.t / r.max;
        r.mesh.scale.setScalar(0.3 + k * r.scale);
        (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.85;
        if (k >= 1) {
          group.remove(r.mesh);
          (r.mesh.material as THREE.Material).dispose();
          rings.splice(i, 1);
        }
      }
      for (let i = marks.length - 1; i >= 0; i--) {
        const m = marks[i]!;
        m.t += dt;
        (m.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.85 * (1 - m.t / 6));
        if (m.t > 6) {
          group.remove(m.mesh);
          (m.mesh.material as THREE.Material).dispose();
          marks.splice(i, 1);
        }
      }
      for (let i = sils.length - 1; i >= 0; i--) {
        const s = sils[i]!;
        s.t += dt;
        (s.mesh.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - s.t / s.max);
        if (s.t > s.max) {
          group.remove(s.mesh);
          (s.mesh.material as THREE.Material).dispose();
          sils.splice(i, 1);
        }
      }
      flashT = Math.max(0, flashT - dt);
      flashLight.intensity = flashT > 0 ? 60 * (flashT / 0.35) : 0;
    },
    dispose() {
      geo.dispose();
      glowGeo.dispose();
      mat.dispose();
      additive.dispose();
      ringGeo.dispose();
      markGeo.dispose();
      silGeo.dispose();
    },
  };
}
