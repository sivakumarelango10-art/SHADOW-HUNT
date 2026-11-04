import { useEffect, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { CharacterId } from '@shadow-hunt/shared';
import { createRig, type Pose } from '../game/characters/rig';

function Model({ id, skin, pose }: { id: CharacterId; skin: string; pose: Partial<Pose> }) {
  const rig = useMemo(() => createRig(id, skin, false), [id, skin]);
  useEffect(() => () => rig.dispose(), [rig]);
  const p = useMemo<Pose>(
    () => ({ speed: 0, crouching: false, sprinting: false, condition: 'healthy', action: 'none', attackSeq: 0, hitSeq: 0, pitch: 0, carryingKey: false, flashlight: false, ...pose }),
    [pose],
  );
  useFrame((st, dt) => {
    rig.root.rotation.y = Math.PI + Math.sin(st.clock.elapsedTime * 0.5) * 0.6;
    p.attackSeq = Math.floor(st.clock.elapsedTime / 3);
    rig.update(p, dt);
  });
  return <primitive object={rig.root} />;
}

function Aim({ y }: { y: number }) {
  const { camera } = useThree();
  useEffect(() => camera.lookAt(0, y, 0), [camera, y]);
  return null;
}

/** Turntable preview of a character rig (same rig used in-game). */
export function CharacterPreview({ id, skin = 'default', className = '' }: { id: CharacterId; skin?: string; className?: string }) {
  const hunter = id === 'wraith' || id === 'butcher' || id === 'hollow';
  return (
    <div className={`relative ${className}`}>
      <Canvas dpr={[1, 1.5]} camera={{ fov: 30, position: [0, hunter ? 1.6 : 1.3, hunter ? 6.4 : 5] }} gl={{ antialias: true, alpha: true }}>
        <Aim y={hunter ? 1.25 : 0.95} />
        <ambientLight intensity={0.5} color="#8090a8" />
        <directionalLight position={[2, 4, 3]} intensity={1.8} color="#d8e0ff" />
        <pointLight position={[-2, 1.5, -1]} intensity={8} color={hunter ? '#ff3020' : '#ffb070'} distance={8} />
        <Model id={id} skin={skin} pose={{}} />
        <mesh rotation-x={-Math.PI / 2} position-y={0}>
          <circleGeometry args={[1.3, 48]} />
          <meshStandardMaterial color="#0d0f12" roughness={0.6} />
        </mesh>
      </Canvas>
    </div>
  );
}
