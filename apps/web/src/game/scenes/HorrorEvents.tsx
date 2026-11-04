import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { hasLineOfSight, type MapDef } from '@shadow-hunt/shared';
import { currentRoom } from '../../multiplayer/net';
import { audio } from '../audio/audio';
import { staticWorld } from '../systems/worldView';

/**
 * Client-side scares for survivors: whispers, far-off creaks and a figure that
 * stands in the fog for a moment. Purely cosmetic and spaced out — tension, not noise.
 * The figure only appears when the real hunter is far away, so it never lies about danger.
 */
export function HorrorEvents({ map }: { map: MapDef }) {
  const { camera } = useThree();
  const next = useRef(performance.now() + 35000);
  const figure = useMemo(() => {
    const g = new THREE.Group();
    const m = new THREE.MeshBasicMaterial({ color: '#020203', transparent: true, opacity: 0, fog: true });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.6, 4, 8), m);
    body.position.y = 1.1;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), m);
    head.position.y = 2.2;
    const eyeM = new THREE.MeshBasicMaterial({ color: '#ff2a2a', transparent: true, opacity: 0, fog: false });
    for (const x of [-0.07, 0.07]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), eyeM);
      e.position.set(x, 2.22, -0.18);
      g.add(e);
    }
    g.add(body, head);
    g.visible = false;
    g.userData = { m, eyeM, t: 0 };
    return g;
  }, []);
  useEffect(
    () => () =>
      figure.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
      }),
    [figure],
  );

  useFrame((_, dt) => {
    const r = currentRoom();
    const s = r?.state as any;
    const me = s?.players?.get(r!.sessionId);
    const ud = figure.userData as { m: THREE.MeshBasicMaterial; eyeM: THREE.MeshBasicMaterial; t: number };
    if (figure.visible) {
      ud.t += dt;
      const a = ud.t < 0.6 ? ud.t / 0.6 : ud.t > 2.4 ? Math.max(0, 1 - (ud.t - 2.4) / 0.4) : 1;
      ud.m.opacity = a * 0.95;
      ud.eyeM.opacity = a;
      figure.lookAt(camera.position.x, 0, camera.position.z);
      // Vanish early if the player gets close.
      if (ud.t > 2.8 || figure.position.distanceTo(camera.position) < 12) figure.visible = false;
    }
    if (
      !s ||
      s.phase !== 'playing' ||
      !me ||
      me.role !== 'survivor' ||
      (me.condition !== 'healthy' && me.condition !== 'injured')
    )
      return;
    const now = performance.now();
    if (now < next.current) return;
    next.current = now + 45000 + Math.random() * 50000;
    let hunterFar = true;
    s.players.forEach((p: any) => {
      if (p.role === 'hunter' && Math.hypot(p.x - me.x, p.z - me.z) < 35) hunterFar = false;
    });
    const roll = Math.random();
    const ang = Math.random() * Math.PI * 2;
    if (roll < 0.4) {
      audio.at('whisper', me.x + Math.cos(ang) * 4, me.z + Math.sin(ang) * 4, 0.5);
    } else if (roll < 0.7) {
      audio.at('door', me.x + Math.cos(ang) * 18, me.z + Math.sin(ang) * 18, 0.35, 0.7);
    } else if (hunterFar) {
      // Place the figure in the fog ahead of the player, where they can actually see it.
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      const d = 24 + Math.random() * 8;
      const x = camera.position.x + fwd.x * d + (Math.random() - 0.5) * 6;
      const z = camera.position.z + fwd.z * d + (Math.random() - 0.5) * 6;
      const world = staticWorld(map.id);
      if (hasLineOfSight(world, { boxes: [] }, camera.position.x, camera.position.z, x, z, { minHeight: 1.2 })) {
        figure.position.set(x, 0, z);
        ud.t = 0;
        figure.visible = true;
        setTimeout(() => audio.at('whisper', x, z, 0.4, 0.8), 400);
      }
    }
  });

  return <primitive object={figure} />;
}
