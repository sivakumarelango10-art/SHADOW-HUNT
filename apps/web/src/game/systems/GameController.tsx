import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getInteractions, NET, PERKS, PLAYER, type InteractKind, type MapId } from '@shadow-hunt/shared';
import { currentRoom, netStats, roundTripMs, send } from '../../multiplayer/net';
import { useHud } from '../../stores/hud';
import { useRoom } from '../../stores/room';
import { useSettings } from '../../stores/settings';
import { audio } from '../audio/audio';
import { attachDesktopInput, input } from '../controls/input';
import { prediction } from './prediction';
import { sampleRemote } from './interpolation';
import { dynamicBlockers, interactWorld, staticWorld } from './worldView';
import { skillCheckHook } from './skillHook';

/** Actions that continue only while the button is held. */
const HOLD: ReadonlySet<InteractKind> = new Set(['repair', 'rescue', 'revive', 'heal', 'openExit']);

const tmp = new THREE.Vector3();

export function GameController({ mapId }: { mapId: MapId }) {
  const { camera, gl, scene } = useThree();
  const world = staticWorld(mapId);
  const flash = useRef<THREE.SpotLight>(null);
  const hunterSight = useRef<THREE.PointLight>(null);
  const st = useRef({
    yaw: 0,
    pitch: 0,
    eye: 1.6,
    bob: 0,
    stepAcc: 0,
    lastPhase: '',
    holding: null as InteractKind | null,
    hudAt: 0,
    fpsFrames: 0,
    fpsAt: 0,
    spectate: 0,
    lastPos: { x: 0, z: 0 },
    shake: 0,
    slowSeconds: 0,
  });

  useEffect(() => {
    input.enabled = true;
    const detach = attachDesktopInput(gl.domElement);
    return () => {
      input.enabled = false;
      input.reset();
      detach();
      prediction.ready = false;
    };
  }, [gl]);

  // Lights that travel with the camera: the camera must be part of the scene graph.
  useEffect(() => {
    scene.add(camera);
    // Aim the beam slightly below the crosshair so it pools on the ground ahead.
    const target = new THREE.Object3D();
    target.position.set(0.05, -0.75, -8);
    camera.add(target);
    const f = flash.current;
    const h = hunterSight.current;
    if (f) {
      camera.add(f);
      f.target = target;
    }
    if (h) camera.add(h);
    return () => {
      camera.remove(target);
      if (f) camera.remove(f);
      if (h) camera.remove(h);
      scene.remove(camera);
    };
  }, [camera, scene]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const r = currentRoom();
    const s = r?.state as any;
    const me = s?.players?.get(r!.sessionId);
    const L = st.current;
    if (!s || !me) return;
    const settings = useSettings.getState();
    const hud = useHud.getState();
    const phase = s.phase as string;
    const playing = phase === 'playing';
    const alive = me.condition !== 'escaped' && me.condition !== 'eliminated';

    // New match: snap prediction to the server's spawn.
    if (L.lastPhase !== phase) {
      if (phase === 'countdown' || !prediction.ready) {
        prediction.reset(me.x, me.z, me.yaw);
        L.yaw = me.yaw;
        L.pitch = 0;
      }
      L.lastPhase = phase;
    }

    // ---- Look
    const sens = (input.usingTouch ? settings.touchSensitivity * 0.0045 : settings.sensitivity * 0.0022) * (settings.fov / 75);
    if (!hud.paused) {
      L.yaw -= input.lookDX * sens;
      L.pitch -= input.lookDY * sens * (settings.invertY ? -1 : 1);
    }
    input.lookDX = input.lookDY = 0;
    L.pitch = Math.max(-1.35, Math.min(1.35, L.pitch));
    if (me.hiddenIn) {
      // Peek through the locker vents only.
      const base = me.yaw;
      let d = L.yaw - base;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      L.yaw = base + Math.max(-0.7, Math.min(0.7, d));
      L.pitch = Math.max(-0.4, Math.min(0.3, L.pitch));
    }

    // ---- Prediction & reconciliation
    const dyn = dynamicBlockers(mapId, s);
    if (netStats.patches !== prediction.lastPatch) {
      prediction.lastPatch = netStats.patches;
      if (playing && alive) prediction.reconcile(world, dyn, me);
      else {
        prediction.s.x = me.x;
        prediction.s.z = me.z;
      }
    }
    if (playing && alive) {
      const ax = hud.paused ? { mx: 0, mz: 0 } : input.axes();
      prediction.s.yaw = L.yaw;
      // Slow frames are split into ≤100 ms inputs (the server's per-input cap) so low-FPS
      // devices still move at full speed instead of being clamped.
      let remaining = Math.min(delta, 0.3);
      while (remaining > 1e-4) {
        const stepDt = Math.min(remaining, 0.1);
        remaining -= stepDt;
        prediction.apply(
          world,
          dyn,
          { seq: ++prediction.seq, dt: stepDt, mx: ax.mx, mz: ax.mz, yaw: L.yaw, pitch: L.pitch, sprint: input.sprinting(), crouch: input.crouching() },
          me,
        );
      }
    }
    prediction.flush(performance.now(), (inputs) => send('input', { inputs }));
    prediction.smooth(dt);

    // ---- One-shot actions
    for (const a of input.drain()) {
      if (a === 'pause') {
        const paused = !useHud.getState().paused;
        useHud.getState().set({ paused });
        if (paused) document.exitPointerLock?.();
        continue;
      }
      if (hud.paused || !playing) continue;
      if (a === 'skill' && skillCheckHook.handle()) continue;
      switch (a) {
        case 'interactDown': {
          const opt = currentOption(mapId, s, me);
          if (!opt) break;
          if (opt.disabled) {
            useRoom.getState().pushNotice(opt.disabled);
            break;
          }
          send('interact', { kind: opt.kind, id: opt.id });
          L.holding = opt.kind;
          break;
        }
        case 'interactUp':
          if (L.holding && HOLD.has(L.holding)) send('interactStop', {});
          L.holding = null;
          break;
        case 'attack':
          if (me.role === 'hunter' && me.attackCd <= 0 && me.action === 'none') {
            send('attack', { viewDelayMs: NET.interpolationDelayMs + roundTripMs() / 2 });
            audio.play('swing', 0.9, 0.9 + Math.random() * 0.2);
          }
          break;
        case 'ability':
          if (me.role === 'hunter') send('ability', {});
          break;
        case 'roar':
          if (me.role === 'hunter') send('roar', {});
          break;
        case 'flashlight':
          if (me.role === 'survivor') {
            send('flashlight', { on: !me.flashlight });
            audio.play('flashlight', 0.6);
          }
          break;
        case 'item':
          if (me.role === 'survivor' && me.item) send('useItem', {});
          break;
        case 'spectateNext':
          if (!alive) L.spectate++;
          break;
      }
    }
    // Releasing the touch interact button works the same as releasing E.
    if (L.holding && !input.interacting()) {
      if (HOLD.has(L.holding)) send('interactStop', {});
      L.holding = null;
    }

    // ---- Camera
    let camX = prediction.s.x + prediction.offset.x;
    let camZ = prediction.s.z + prediction.offset.z;
    let targetEye: number = me.role === 'hunter' ? PLAYER.hunterEyeHeight : prediction.s.crouching ? PLAYER.crouchEyeHeight : PLAYER.eyeHeight;
    if (me.condition === 'downed') targetEye = PLAYER.downedEyeHeight;
    if (me.condition === 'captured') targetEye = 1.15;
    if (['repair', 'rescue', 'revive', 'heal', 'pickup', 'pickupKey', 'selfheal'].includes(me.action) && me.role === 'survivor') targetEye = 1.2;
    let spectating: string | null = null;
    if (!alive) {
      const others: any[] = [];
      s.players.forEach((p: any) => {
        if (p.sessionId !== me.sessionId && p.condition !== 'escaped' && p.condition !== 'eliminated') others.push(p);
      });
      others.sort((a, b) => (a.role === b.role ? a.sessionId.localeCompare(b.sessionId) : a.role === 'survivor' ? -1 : 1));
      const target = others.length ? others[L.spectate % others.length] : null;
      if (target) {
        spectating = target.name;
        const smp = sampleRemote(target.sessionId) ?? target;
        const back = 3.6;
        camX = smp.x + Math.sin(L.yaw) * back;
        camZ = smp.z + Math.cos(L.yaw) * back;
        targetEye = 2.3;
        camera.position.set(camX, targetEye, camZ);
        camera.lookAt(tmp.set(smp.x, 1.4, smp.z));
      }
    }
    L.eye += (targetEye - L.eye) * Math.min(1, dt * 10);
    const moved = Math.hypot(prediction.s.x - L.lastPos.x, prediction.s.z - L.lastPos.z);
    L.lastPos = { x: prediction.s.x, z: prediction.s.z };
    const speed = moved / Math.max(dt, 1e-3);
    if (speed > 0.3 && alive) L.bob += dt * (prediction.s.sprinting ? 13 : 9);
    const bobAmt = speed > 0.3 ? (prediction.s.sprinting ? 0.06 : 0.035) : 0;
    L.shake = Math.max(0, L.shake - dt * 2);
    if (!spectating) {
      camera.position.set(
        camX + (Math.random() - 0.5) * L.shake * 0.1,
        L.eye + Math.sin(L.bob * 2) * bobAmt + (me.hiddenIn ? -0.05 : 0),
        camZ + (Math.random() - 0.5) * L.shake * 0.1,
      );
      camera.rotation.set(L.pitch, L.yaw, Math.sin(L.bob) * bobAmt * 0.3, 'YXZ');
    }
    const cam = camera as THREE.PerspectiveCamera;
    const fovTarget = settings.fov + (prediction.s.sprinting ? 6 : 0) + (me.action === 'charging' ? 14 : 0);
    if (Math.abs(cam.fov - fovTarget) > 0.05) {
      cam.fov += (fovTarget - cam.fov) * Math.min(1, dt * 6);
      cam.updateProjectionMatrix();
    }
    if (cam.far !== settings.renderDistance) {
      cam.far = settings.renderDistance;
      cam.updateProjectionMatrix();
    }

    // ---- Flashlight & hunter sight
    if (flash.current) {
      const on = me.role === 'survivor' && me.flashlight && alive && !me.hiddenIn;
      flash.current.visible = on;
      const flick = me.battery < 15 ? (Math.random() < 0.08 ? 0.2 : 1) : 1;
      flash.current.intensity = on ? 80 * flick * Math.min(1, 0.4 + me.battery / 60) : 0;
      flash.current.castShadow = settings.shadows;
    }
    if (hunterSight.current) hunterSight.current.visible = me.role === 'hunter' && playing;

    // ---- Audio: listener, footsteps, heartbeat & music
    audio.listener(camera.position.x, camera.position.y, camera.position.z, L.yaw);
    if (playing && alive && moved > 0) {
      L.stepAcc += moved;
      const stride = me.role === 'hunter' ? 1.9 : prediction.s.sprinting ? 1.9 : prediction.s.crouching ? 1.1 : 1.45;
      if (L.stepAcc > stride) {
        L.stepAcc = 0;
        const indoor = mapId === 'asylum';
        if (me.role === 'hunter') audio.play('step_heavy', 0.35);
        else audio.play(indoor ? 'step_hard' : 'step_soft', prediction.s.crouching ? 0.12 : prediction.s.sprinting ? 0.5 : 0.28, 0.9 + Math.random() * 0.2);
      }
    }
    let terror = 0;
    if (me.role === 'survivor' && playing && alive) {
      let hunter: any = null;
      s.players.forEach((p: any) => p.role === 'hunter' && (hunter = p));
      if (hunter) {
        const h = sampleRemote(hunter.sessionId) ?? hunter;
        const radius = 24 * (me.characterId === 'ava' ? PERKS.ava.heartbeatRangeMul : 1);
        const d = Math.hypot(h.x - prediction.s.x, h.z - prediction.s.z);
        terror = Math.max(0, Math.min(1, 1 - d / radius));
      }
    }
    audio.bed(mapId === 'asylum' ? 'ambient_asylum' : 'ambient_forest', phase === 'playing' || phase === 'countdown' ? 0.55 : 0.25);
    audio.bed('heartbeat', terror > 0 ? 0.25 + terror * 0.75 : 0, 0.75 + terror * 0.85);
    const chase = me.role === 'survivor' ? Math.max(0, Math.min(1, (terror - 0.45) / 0.35)) : 0;
    audio.bed('music_chase', playing ? chase * 0.7 : 0);
    audio.bed('music_tension', playing ? (1 - chase) * 0.4 : 0.15);
    s.generators?.forEach((g: any, id: string) => {
      const def = worldGen(mapId, id);
      if (g.repairers > 0 && !g.completed && def) audio.loopAt(`gen:${id}`, 'gen_loop', def.x, def.z, 0.7);
      else audio.stopLoop(`gen:${id}`);
    });

    // ---- HUD (15 Hz)
    const now = performance.now();
    L.fpsFrames++;
    if (now - L.hudAt > 66) {
      L.hudAt = now;
      let fps = hud.fps;
      if (now - L.fpsAt > 1000) {
        fps = Math.round((L.fpsFrames * 1000) / (now - L.fpsAt));
        L.fpsFrames = 0;
        L.fpsAt = now;
        // Adaptive quality: sustained low frame rate steps the preset down once per level.
        L.slowSeconds = playing && fps < 24 ? L.slowSeconds + 1 : 0;
        if (L.slowSeconds >= 8 && settings.quality !== 'low') {
          L.slowSeconds = 0;
          settings.applyPreset(settings.quality === 'high' ? 'medium' : 'low');
          useRoom.getState().pushNotice('Graphics lowered to keep the game smooth (Settings → Graphics).');
        }
      }
      const opt = playing && alive ? currentOption(mapId, s, me) : null;
      useHud.getState().set({
        prompt: opt,
        holding: !!L.holding,
        stamina: prediction.s.stamina,
        exhausted: prediction.s.exhausted,
        terror,
        spectating,
        showStatus: input.showStatus,
        fps,
      });
    }
  });

  return (
    <>
      <spotLight
        ref={flash}
        position={[0.22, -0.22, -0.55]}
        angle={0.42}
        penumbra={0.6}
        distance={34}
        decay={1.3}
        color="#fff1d6"
        intensity={0}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0004}
        shadow-camera-near={0.2}
        shadow-camera-far={30}
      />
      <pointLight ref={hunterSight} color="#7a3030" intensity={6} distance={14} decay={1.2} position={[0, 0.3, 0]} visible={false} />
    </>
  );
}

function worldGen(mapId: MapId, id: string) {
  return staticWorld(mapId).map.generators.find((g) => g.id === id);
}

function currentOption(mapId: MapId, s: any, me: any) {
  const view = {
    id: me.sessionId,
    role: me.role,
    characterId: me.characterId,
    condition: me.condition,
    x: prediction.s.x,
    z: prediction.s.z,
    yaw: prediction.s.yaw,
    hiddenIn: me.hiddenIn,
    carryingKey: me.carryingKey,
    item: me.item,
    cageId: me.cageId,
    busy: me.action !== 'none',
  };
  const opts = getInteractions(interactWorld(mapId, s), view);
  return opts[0] ?? null;
}
