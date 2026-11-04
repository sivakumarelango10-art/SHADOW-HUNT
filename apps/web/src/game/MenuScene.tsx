import { useEffect, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { mulberry32, type CharacterId } from '@shadow-hunt/shared';
import { createRig, type Pose } from './characters/rig';
import { tex } from './textures';

/** Atmospheric background for the menus: fog, pines, moonlight and something watching. */
function Forest() {
  const group = useMemo(() => {
    const g = new THREE.Group();
    const rnd = mulberry32(7);
    const bark = new THREE.MeshStandardMaterial({ map: tex.bark(), color: '#6a5a4a', roughness: 1 });
    const leaf = new THREE.MeshStandardMaterial({ map: tex.foliage(), color: '#4a5a4c', roughness: 1 });
    const trunkG = new THREE.CylinderGeometry(0.6, 1, 1, 7);
    trunkG.translate(0, 0.5, 0);
    const coneG = new THREE.ConeGeometry(1, 1, 8);
    coneG.translate(0, 0.5, 0);
    const n = 140;
    const trunks = new THREE.InstancedMesh(trunkG, bark, n);
    const cones = new THREE.InstancedMesh(coneG, leaf, n * 3);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      const x = (rnd() - 0.5) * 90;
      const z = -6 - rnd() * 70;
      if (Math.abs(x) < 3 && z > -18) continue;
      const h = 10 + rnd() * 10;
      const r = 0.3 + rnd() * 0.25;
      m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(r, h * 0.75, r));
      trunks.setMatrixAt(i, m);
      for (let l = 0; l < 3; l++) {
        const f = l / 3;
        m.compose(new THREE.Vector3(x, h * 0.28 + f * h * 0.55, z), q, new THREE.Vector3((3 - f * 2) * (0.8 + r), h * 0.4, (3 - f * 2) * (0.8 + r)));
        cones.setMatrixAt(i * 3 + l, m);
      }
    }
    g.add(trunks, cones);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ map: tex.forestFloor(), color: '#9a9a9a', roughness: 1 }));
    (ground.material as THREE.MeshStandardMaterial).map!.repeat.set(30, 30);
    ground.rotation.x = -Math.PI / 2;
    g.add(ground);
    return g;
  }, []);
  return <primitive object={group} />;
}

function Watcher({ id }: { id: CharacterId }) {
  const rig = useMemo(() => createRig(id, 'default', false), [id]);
  useEffect(() => () => rig.dispose(), [rig]);
  const pose = useMemo<Pose>(() => ({ speed: 0, crouching: false, sprinting: false, condition: 'healthy', action: 'none', attackSeq: 0, hitSeq: 0, pitch: 0, carryingKey: false, flashlight: false }), []);
  useFrame((st, dt) => {
    rig.root.position.set(4.5, 0, -16);
    rig.root.rotation.y = Math.atan2(4.5, 16) * 0.6 + Math.sin(st.clock.elapsedTime * 0.3) * 0.15;
    rig.update(pose, dt);
  });
  return <primitive object={rig.root} />;
}

function Drift() {
  const { camera, scene } = useThree();
  useEffect(() => {
    scene.fog = new THREE.FogExp2('#111821', 0.045);
    scene.background = new THREE.Color('#111821');
  }, [scene]);
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    camera.position.set(Math.sin(t * 0.05) * 1.5, 1.7 + Math.sin(t * 0.3) * 0.05, 4 + Math.sin(t * 0.07) * 1);
    camera.lookAt(1.5, 2.2, -20);
  });
  return null;
}

export function MenuScene({ hunter = 'wraith' }: { hunter?: CharacterId }) {
  return (
    <Canvas dpr={[0.75, 1.25]} camera={{ fov: 60, near: 0.1, far: 120 }} gl={{ antialias: false, powerPreference: 'low-power' }} style={{ position: 'absolute', inset: 0 }}>
      <Drift />
      <ambientLight color="#3a4a66" intensity={0.9} />
      <directionalLight color="#b4c6e2" intensity={1.6} position={[-20, 30, -10]} />
      <pointLight color="#ff3a2a" intensity={4} distance={8} position={[4.5, 2.3, -15.2]} />
      <Forest />
      <Watcher id={hunter} />
    </Canvas>
  );
}
