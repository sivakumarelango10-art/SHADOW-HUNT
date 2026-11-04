import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { regionAt, type MapDef } from '@shadow-hunt/shared';
import { currentRoom } from '../../multiplayer/net';
import { useSettings } from '../../stores/settings';
import { tex } from '../textures';

/**
 * Fog, moonlight, sky and the pooled practical lights. Practical lights use a
 * fixed-size pool re-assigned to the nearest fixtures, so the number of lights in
 * the shader never changes (no recompiles) and mobile stays within budget.
 */
export function Atmosphere({ map, role }: { map: MapDef; role: string }) {
  const { scene, camera } = useThree();
  const quality = useSettings((s) => s.quality);
  const shadows = useSettings((s) => s.shadows);
  const fogQuality = useSettings((s) => s.fogQuality);
  const a = map.atmosphere;
  const moon = useRef<THREE.DirectionalLight>(null);
  const ambient = useRef<THREE.AmbientLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const poolSize = quality === 'low' ? 3 : quality === 'medium' ? 5 : 8;
  const pool = useRef<(THREE.PointLight | null)[]>([]);

  const fog = useMemo(() => new THREE.FogExp2(a.fogColor, a.fogDensity), [a.fogColor, a.fogDensity]);
  useEffect(() => {
    scene.fog = fog;
    scene.background = new THREE.Color(a.fogColor);
    return () => {
      scene.fog = null;
      scene.background = null;
    };
  }, [scene, fog, a.fogColor]);

  const sky = useMemo(() => {
    if (a.sky !== 'night') return null;
    const g = new THREE.Group();
    const n = 1400;
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(Math.random() * 0.9);
      p.set([Math.cos(th) * Math.sin(ph) * 400, Math.cos(ph) * 400, Math.sin(th) * Math.sin(ph) * 400], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const stars = new THREE.Points(
      sg,
      new THREE.PointsMaterial({
        color: '#c8d4e8',
        size: 1.2,
        sizeAttenuation: false,
        fog: false,
        transparent: true,
        opacity: 0.8,
      }),
    );
    g.add(stars);
    const moonSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex.glow(), color: '#dfe8ff', fog: false, transparent: true, depthWrite: false }),
    );
    const dir = new THREE.Vector3(...a.moonDir).normalize().multiplyScalar(-380);
    moonSprite.position.copy(dir);
    moonSprite.scale.setScalar(60);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(9, 32), new THREE.MeshBasicMaterial({ color: '#eef2ff', fog: false }));
    disc.position.copy(dir);
    disc.lookAt(0, 0, 0);
    g.add(moonSprite, disc);
    g.renderOrder = -1;
    return g;
  }, [a.sky, a.moonDir]);
  useEffect(() => () => sky?.traverse((o) => (o as THREE.Mesh).geometry?.dispose()), [sky]);

  // Dust motes / fireflies that drift around the camera.
  const motes = useMemo(() => {
    const n = quality === 'low' ? 120 : 320;
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) p.set([(Math.random() - 0.5) * 30, Math.random() * 4, (Math.random() - 0.5) * 30], i * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const m = new THREE.PointsMaterial({
      map: tex.glow(),
      color: map.id === 'blackwood' ? '#b8d0a0' : '#c8c0b0',
      size: map.id === 'blackwood' ? 0.09 : 0.05,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    return pts;
  }, [quality, map.id]);
  useEffect(
    () => () => {
      motes.geometry.dispose();
      (motes.material as THREE.Material).dispose();
    },
    [motes],
  );

  const assigned = useRef<number[]>([]);
  const t = useRef(0);
  const reassignAt = useRef(0);
  const bulbs = useRef<THREE.Mesh[]>([]);

  useEffect(() => {
    bulbs.current = [];
    scene.traverse((o) => {
      if (o.name === 'bulb') bulbs.current.push(o as THREE.Mesh);
    });
  }, [scene, map]);

  useFrame((_, dt) => {
    t.current += dt;
    const s = currentRoom()?.state as any;
    const powerOn = !!s?.powerOn;
    const cx = camera.position.x;
    const cz = camera.position.z;
    const region = regionAt(map, cx, cz);
    const indoor = !!region?.indoor;
    const fogTarget =
      (indoor ? a.indoorFogDensity : a.fogDensity) * (fogQuality === 'low' ? 0.85 : 1) * (role === 'hunter' ? 0.8 : 1);
    fog.density += (fogTarget - fog.density) * Math.min(1, dt * 2);
    if (role === 'hunter') fog.color.lerp(new THREE.Color(a.hunterTint), 0.05);

    if (moon.current) {
      moon.current.position.set(cx - a.moonDir[0] * 40, 60, cz - a.moonDir[2] * 40);
      moon.current.target.position.set(cx, 0, cz);
      moon.current.target.updateMatrixWorld();
      moon.current.intensity +=
        ((indoor ? a.moonIntensity * 0.25 : a.moonIntensity) - moon.current.intensity) * Math.min(1, dt * 2);
    }
    if (ambient.current) ambient.current.intensity = a.ambientIntensity * (role === 'hunter' ? 1.6 : 1) * (powerOn ? 1.15 : 1);

    // Pool reassignment twice a second
    if (t.current > reassignAt.current) {
      reassignAt.current = t.current + 0.5;
      assigned.current = map.lights
        .map((l, i) => ({ i, d: (l.x - cx) ** 2 + (l.z - cz) ** 2, ok: !l.powered || powerOn }))
        .filter((x) => x.ok)
        .sort((x, y) => x.d - y.d)
        .slice(0, poolSize)
        .map((x) => x.i);
    }
    pool.current.forEach((pl, k) => {
      if (!pl) return;
      const idx = assigned.current[k];
      if (idx === undefined) {
        pl.intensity = 0;
        return;
      }
      const l = map.lights[idx]!;
      pl.position.set(l.x, l.y - 0.1, l.z);
      pl.color.set(l.color);
      pl.distance = l.distance;
      const f = l.flicker;
      const n = Math.sin(t.current * 23 + idx * 7) * Math.sin(t.current * 7.3 + idx);
      const dropout = f > 0.5 && Math.sin(t.current * 1.7 + idx * 3) > 0.92 ? 0.05 : 1;
      pl.intensity = l.intensity * (1 - f * 0.35 + n * f * 0.35) * dropout;
    });
    for (const b of bulbs.current) {
      const l = b.userData.light as MapDef['lights'][number];
      b.visible = !l.powered || powerOn;
    }
    if (sky) {
      // Keep the sky dome centred on the viewer and inside the far plane.
      sky.position.copy(camera.position);
      sky.scale.setScalar(((camera as THREE.PerspectiveCamera).far * 0.92) / 400);
    }
    motes.position.set(cx, 0, cz);
    const arr = motes.geometry.attributes.position!.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 1]! += Math.sin(t.current + i) * 0.002;
      if (arr[i + 1]! > 4) arr[i + 1] = 0;
    }
    motes.geometry.attributes.position!.needsUpdate = true;
  });

  return (
    <>
      <ambientLight ref={ambient} color={a.ambientColor} intensity={a.ambientIntensity} />
      <hemisphereLight ref={hemi} args={[a.moonColor, '#050505', 0.18]} />
      <directionalLight
        ref={moon}
        color={a.moonColor}
        intensity={a.moonIntensity}
        castShadow={shadows && map.id === 'blackwood'}
        shadow-mapSize-width={quality === 'high' ? 2048 : 1024}
        shadow-mapSize-height={quality === 'high' ? 2048 : 1024}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
        shadow-camera-near={1}
        shadow-camera-far={140}
        shadow-bias={-0.0006}
      />
      {Array.from({ length: poolSize }, (_, k) => (
        <pointLight key={`${quality}-${k}`} ref={(el) => void (pool.current[k] = el)} intensity={0} decay={1.6} />
      ))}
      {sky && <primitive object={sky} />}
      <primitive object={motes} />
    </>
  );
}
