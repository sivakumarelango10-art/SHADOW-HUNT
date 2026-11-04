import { Suspense, useEffect, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, Bloom, Vignette, Noise, ChromaticAberration } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import * as THREE from 'three';
import { MAPS, type CharacterId, type MapId } from '@shadow-hunt/shared';
import { useSettings } from '../stores/settings';
import { useHud } from '../stores/hud';
import { currentRoom } from '../multiplayer/net';
import { buildStaticMap } from './scenes/staticMap';
import { Props } from './scenes/Props';
import { Effects } from './scenes/Effects';
import { Atmosphere } from './scenes/Atmosphere';
import { HorrorEvents } from './scenes/HorrorEvents';
import { Players } from './characters/Players';
import { GameController } from './systems/GameController';
import { createRig, type Pose } from './characters/rig';
import { setTextureQuality } from './textures';

function StaticMap({ mapId, shadows, detail }: { mapId: MapId; shadows: boolean; detail: 'low' | 'high' }) {
  const built = useMemo(() => buildStaticMap(MAPS[mapId], { shadows, detail }), [mapId, shadows, detail]);
  useEffect(() => () => built.dispose(), [built]);
  return <primitive object={built.group} />;
}

/** First-person hands: a flashlight for survivors, the weapon for hunters. */
function Viewmodel({ characterId, skinId }: { characterId: CharacterId; skinId: string }) {
  const { camera } = useThree();
  const rig = useMemo(() => createRig(characterId, skinId, false), [characterId, skinId]);
  const holder = useMemo(() => new THREE.Group(), []);
  const pose = useMemo<Pose>(
    () => ({
      speed: 0,
      crouching: false,
      sprinting: false,
      condition: 'healthy',
      action: 'none',
      attackSeq: 0,
      hitSeq: 0,
      pitch: 0,
      carryingKey: false,
      flashlight: true,
    }),
    [],
  );
  useEffect(() => {
    // Only the right arm of the rig is shown, parented to the camera.
    const arm = rig.arm;
    const shoulder = arm.parent!;
    const rest = arm.position.clone();
    holder.add(arm);
    arm.position.set(0, 0, 0);
    holder.position.set(0.26, -0.3, -0.2);
    holder.rotation.set(-0.12, 0.12, 0);
    holder.scale.setScalar(0.62);
    arm.rotation.set(1.42, 0, 0.06);
    arm.traverse((o) => {
      o.renderOrder = 100;
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.depthTest = true;
    });
    camera.add(holder);
    return () => {
      camera.remove(holder);
      shoulder.add(arm);
      arm.position.copy(rest);
      rig.dispose();
    };
  }, [rig, camera, holder]);
  const swing = useMemo(() => ({ seq: -1, t: 0, bob: 0 }), []);
  useFrame((_, dt) => {
    const r = currentRoom();
    const me = (r?.state as any)?.players?.get(r?.sessionId);
    if (!me) return;
    const alive =
      me.condition !== 'escaped' &&
      me.condition !== 'eliminated' &&
      me.condition !== 'downed' &&
      me.condition !== 'captured' &&
      !me.hiddenIn;
    holder.visible = alive && (me.role === 'hunter' || me.flashlight);
    if (swing.seq !== me.attackSeq) {
      if (swing.seq !== -1) swing.t = 0.4;
      swing.seq = me.attackSeq;
    }
    swing.t = Math.max(0, swing.t - dt);
    const a = swing.t > 0 ? 1 - swing.t / 0.4 : 0;
    swing.bob += dt * (me.sprinting ? 12 : 7);
    holder.position.y = -0.3 + Math.sin(swing.bob) * (me.sprinting ? 0.02 : 0.006);
    holder.rotation.x = -0.15 - (a > 0 ? Math.sin(a * Math.PI) * 1.1 : 0);
    holder.rotation.z = a > 0 ? -Math.sin(a * Math.PI) * 0.8 : 0;
    pose.flashlight = me.flashlight;
  });
  return null;
}

function Renderer() {
  const { gl, scene } = useThree();
  useEffect(() => {
    if (import.meta.env.DEV) (window as any).__shadowHuntScene = scene;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.05;
    gl.outputColorSpace = THREE.SRGBColorSpace;
  }, [gl, scene]);
  return null;
}

function PostFx() {
  const terror = useHud((s) => s.terror);
  return (
    <EffectComposer multisampling={0}>
      <Bloom intensity={0.7} luminanceThreshold={0.55} luminanceSmoothing={0.3} mipmapBlur />
      <ChromaticAberration
        offset={new THREE.Vector2(0.0006 + terror * 0.002, 0.0004)}
        blendFunction={BlendFunction.NORMAL}
        radialModulation={false}
        modulationOffset={0}
      />
      <Noise opacity={0.06} blendFunction={BlendFunction.OVERLAY} />
      <Vignette eskil={false} offset={0.25} darkness={0.75 + terror * 0.2} />
    </EffectComposer>
  );
}

export function GameWorld({ mapId, characterId, skinId }: { mapId: MapId; characterId: CharacterId; skinId: string }) {
  const s = useSettings();
  const map = MAPS[mapId];
  setTextureQuality(s.textureQuality === 'low');
  const role = characterId === 'wraith' || characterId === 'butcher' || characterId === 'hollow' ? 'hunter' : 'survivor';
  const dpr = Math.min(2, (typeof window !== 'undefined' ? window.devicePixelRatio : 1) * s.renderScale);
  return (
    <Canvas
      key={`${s.shadows}-${s.antialias}`}
      shadows={s.shadows ? { type: THREE.PCFSoftShadowMap } : false}
      dpr={dpr}
      gl={{ antialias: s.antialias, powerPreference: 'high-performance', stencil: false }}
      camera={{ fov: s.fov, near: 0.05, far: s.renderDistance, position: [0, 1.6, 0] }}
      style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
    >
      <Renderer />
      <Suspense fallback={null}>
        <StaticMap mapId={mapId} shadows={s.shadows} detail={s.quality === 'low' ? 'low' : 'high'} />
        <Props map={map} shadows={s.shadows} />
        <Players shadows={s.shadows && s.quality === 'high'} />
        <Effects map={map} />
        <Atmosphere map={map} role={role} />
        <HorrorEvents map={map} />
        <GameController mapId={mapId} />
        <Viewmodel characterId={characterId} skinId={skinId} />
        {s.postFx && <PostFx />}
      </Suspense>
    </Canvas>
  );
}
