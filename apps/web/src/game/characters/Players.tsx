import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { CharacterId } from '@shadow-hunt/shared';
import { currentRoom } from '../../multiplayer/net';
import { useRoom } from '../../stores/room';
import { sampleRemote } from '../systems/interpolation';
import { tex } from '../textures';
import { createRig, type Pose } from './rig';
import { audio } from '../audio/audio';

/** Renders every other player using interpolated positions and their replicated pose. */
export function Players({ shadows }: { shadows: boolean }) {
  const snap = useRoom((s) => s.snap);
  const sessionId = useRoom((s) => s.sessionId);
  const list = useMemo(
    () => (snap?.players ?? []).filter((p) => p.sessionId !== sessionId).map((p) => `${p.sessionId}|${p.characterId}|${p.skinId}`),
    [snap?.players, sessionId],
  );
  const keys = [...new Set(list)];
  return (
    <>
      {keys.map((k) => {
        const [id, ch, skin] = k.split('|') as [string, CharacterId, string];
        return <RemotePlayer key={k} sessionId={id} characterId={ch} skinId={skin} shadows={shadows} />;
      })}
    </>
  );
}

function RemotePlayer({ sessionId, characterId, skinId, shadows }: { sessionId: string; characterId: CharacterId; skinId: string; shadows: boolean }) {
  const rig = useMemo(() => createRig(characterId, skinId, shadows), [characterId, skinId, shadows]);
  useEffect(() => () => rig.dispose(), [rig]);
  const beam = useMemo(() => {
    const g = new THREE.ConeGeometry(1.6, 9, 24, 1, true);
    g.translate(0, -4.5, 0);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshBasicMaterial({
      color: '#fff0cc',
      transparent: true,
      opacity: 0.07,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      alphaMap: tex.beam(),
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.rotation.x = Math.PI;
    return mesh;
  }, []);
  const spot = useRef<THREE.SpotLight>(null);
  const pose = useRef<Pose>({
    speed: 0, crouching: false, sprinting: false, condition: 'healthy', action: 'none', attackSeq: 0, hitSeq: 0, pitch: 0,
    carryingKey: false, flashlight: false,
  });
  const step = useRef(0);

  useEffect(() => {
    rig.hand.add(beam);
    beam.position.set(0, 0, -0.1);
    return () => {
      rig.hand.remove(beam);
      beam.geometry.dispose();
      (beam.material as THREE.Material).dispose();
    };
  }, [rig, beam]);

  useFrame((_, dt) => {
    const s = currentRoom()?.state as any;
    const p = s?.players?.get(sessionId);
    if (!p) {
      rig.root.visible = false;
      return;
    }
    const smp = sampleRemote(sessionId);
    const visible = !p.hiddenIn && p.condition !== 'escaped' && p.condition !== 'eliminated' && s.phase !== 'lobby';
    rig.root.visible = visible;
    if (!visible) return;
    const x = smp?.x ?? p.x;
    const z = smp?.z ?? p.z;
    rig.root.position.set(x, 0, z);
    rig.root.rotation.y = smp?.yaw ?? p.yaw;
    const P = pose.current;
    P.speed = smp?.speed ?? 0;
    P.crouching = p.crouching;
    P.sprinting = p.sprinting;
    P.condition = p.condition;
    P.action = p.action;
    P.attackSeq = p.attackSeq;
    P.hitSeq = p.hitSeq;
    P.pitch = smp?.pitch ?? p.pitch;
    P.carryingKey = p.carryingKey;
    P.flashlight = p.flashlight;
    rig.update(P, dt);
    beam.visible = p.flashlight;
    if (spot.current) {
      spot.current.visible = p.flashlight;
    }
    // Remote footsteps
    if (P.speed > 0.4 && p.condition !== 'downed') {
      step.current += P.speed * dt;
      const stride = p.role === 'hunter' ? 1.9 : p.sprinting ? 1.9 : 1.45;
      if (step.current > stride) {
        step.current = 0;
        const vol = p.role === 'hunter' ? 0.9 : p.crouching ? 0.08 : p.sprinting ? 0.6 : 0.3;
        audio.at(p.role === 'hunter' ? 'step_heavy' : 'step_soft', x, z, vol, 0.9 + Math.random() * 0.2, 0.1);
      }
    }
  });

  return <primitive object={rig.root} />;
}
