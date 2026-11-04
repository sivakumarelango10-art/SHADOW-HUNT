import * as THREE from 'three';
import { CHARACTERS, getSkin, type CharacterDef, type CharacterId } from '@shadow-hunt/shared';

/**
 * Procedural articulated character rig. Every character is a hierarchy of joints
 * (hips → spine → chest → neck/shoulders/elbows, hips → knees) animated in code.
 * The `Rig` interface is the seam for swapping in skinned glTF models later:
 * anything that implements `update(pose, dt)` can replace it.
 */
export interface Pose {
  speed: number;
  crouching: boolean;
  sprinting: boolean;
  condition: string;
  action: string;
  attackSeq: number;
  hitSeq: number;
  pitch: number;
  carryingKey: boolean;
  flashlight: boolean;
}

export interface Rig {
  root: THREE.Group;
  /** World-space position of the flashlight / weapon hand. */
  hand: THREE.Object3D;
  /** Right shoulder joint (used for the first-person viewmodel). */
  arm: THREE.Object3D;
  head: THREE.Object3D;
  update(p: Pose, dt: number): void;
  dispose(): void;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function capsule(r: number, len: number) {
  const k = `c${r.toFixed(3)}_${len.toFixed(3)}`;
  let g = geoCache.get(k);
  if (!g) geoCache.set(k, (g = new THREE.CapsuleGeometry(r, len, 4, 10)));
  return g;
}
function sphere(r: number) {
  const k = `s${r.toFixed(3)}`;
  let g = geoCache.get(k);
  if (!g) geoCache.set(k, (g = new THREE.SphereGeometry(r, 16, 12)));
  return g;
}
function box(w: number, h: number, d: number) {
  const k = `b${w}_${h}_${d}`;
  let g = geoCache.get(k);
  if (!g) geoCache.set(k, (g = new THREE.BoxGeometry(w, h, d)));
  return g;
}

function mat(color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, ...opts });
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, shadows: boolean) {
  const x = new THREE.Mesh(g, m);
  x.castShadow = shadows;
  x.receiveShadow = false;
  return x;
}

/** A joint whose child segment hangs down -Y by `len`. Returns [joint, end]. */
function limb(parent: THREE.Object3D, at: [number, number, number], r: number, len: number, m: THREE.Material, shadows: boolean) {
  const joint = new THREE.Group();
  joint.position.set(...at);
  parent.add(joint);
  const seg = mesh(capsule(r, len), m, shadows);
  seg.position.y = -len / 2;
  joint.add(seg);
  const end = new THREE.Group();
  end.position.y = -len;
  joint.add(end);
  return [joint, end] as const;
}

const SKIN_TONES: Record<string, string> = {
  alex: '#c69a7a', mia: '#e2b99a', ethan: '#8d5f45', luna: '#e8c4a8', noah: '#6b4632', ava: '#d1a184',
};

export function createRig(characterId: CharacterId, skinId: string, shadows: boolean): Rig {
  const def = CHARACTERS[characterId];
  return def.role === 'hunter' ? hunterRig(def, skinId, shadows) : survivorRig(def, skinId, shadows);
}

function survivorRig(def: CharacterDef, skinId: string, shadows: boolean): Rig {
  const skin = getSkin(def.id, skinId);
  const H = def.build.height;
  const S = def.build.shoulders;
  const B = def.build.bulk;
  const jacket = mat(skin.primary);
  const pants = mat(skin.secondary);
  const accent = mat(skin.accent, { roughness: 0.6 });
  const flesh = mat(SKIN_TONES[def.id] ?? '#c8a080', { roughness: 0.7 });
  const hairM = mat(def.id === 'luna' ? '#2a1c16' : def.id === 'mia' ? '#4a2c1a' : '#1a1512', { roughness: 0.9 });

  const root = new THREE.Group();
  const body = new THREE.Group(); // tilts for downed/crawl
  root.add(body);
  const hips = new THREE.Group();
  hips.position.y = 0.95 * H;
  body.add(hips);
  const pelvis = mesh(box(0.32 * B, 0.18, 0.2 * B), pants, shadows);
  hips.add(pelvis);

  const spine = new THREE.Group();
  spine.position.y = 0.08;
  hips.add(spine);
  const torso = mesh(capsule(0.17 * B, 0.32 * H), jacket, shadows);
  torso.scale.set(1.15 * S, 1, 0.8);
  torso.position.y = 0.26 * H;
  spine.add(torso);
  const chest = new THREE.Group();
  chest.position.y = 0.48 * H;
  spine.add(chest);

  const neck = new THREE.Group();
  neck.position.y = 0.06;
  chest.add(neck);
  const head = mesh(sphere(0.115), flesh, shadows);
  head.position.y = 0.13;
  head.scale.set(0.92, 1.08, 1);
  neck.add(head);
  // eyes
  const eyeM = mat('#101010', { roughness: 0.3 });
  for (const sx of [-0.04, 0.04]) {
    const e = mesh(sphere(0.014), eyeM, false);
    e.position.set(sx, 0.015, -0.1);
    head.add(e);
  }
  // hair / headwear
  if (def.hair === 'cap') {
    const cap = mesh(sphere(0.122), accent, shadows);
    cap.scale.set(1, 0.55, 1);
    cap.position.y = 0.05;
    head.add(cap);
    const brim = mesh(box(0.16, 0.015, 0.12), accent, false);
    brim.position.set(0, 0.04, -0.12);
    head.add(brim);
  } else if (def.hair === 'hood') {
    const hood = mesh(sphere(0.14), jacket, shadows);
    hood.scale.set(1, 1.05, 1.05);
    hood.position.set(0, 0.02, 0.025);
    head.add(hood);
    const face = mesh(sphere(0.105), flesh, false);
    face.position.set(0, -0.005, -0.03);
    head.add(face);
  } else {
    const hair = mesh(sphere(0.12), hairM, shadows);
    hair.scale.set(1.02, 0.7, 1.05);
    hair.position.set(0, 0.04, 0.012);
    head.add(hair);
    if (def.hair === 'long') {
      const back = mesh(box(0.2, 0.28, 0.06), hairM, shadows);
      back.position.set(0, -0.1, 0.08);
      head.add(back);
    } else if (def.hair === 'bun') {
      const bun = mesh(sphere(0.055), hairM, shadows);
      bun.position.set(0, 0.07, 0.1);
      head.add(bun);
    }
  }

  const sw = 0.2 * S;
  const [shL, elL] = limb(chest, [-sw, -0.02, 0], 0.055 * B, 0.26 * H, jacket, shadows);
  const [shR, elR] = limb(chest, [sw, -0.02, 0], 0.055 * B, 0.26 * H, jacket, shadows);
  const [foreL, handL] = limb(elL, [0, 0, 0], 0.045 * B, 0.24 * H, jacket, shadows);
  const [foreR, handR] = limb(elR, [0, 0, 0], 0.045 * B, 0.24 * H, jacket, shadows);
  for (const h of [handL, handR]) {
    const m = mesh(sphere(0.045), flesh, false);
    m.position.y = -0.03;
    h.add(m);
  }
  // flashlight in right hand
  const torch = new THREE.Group();
  torch.position.set(0, -0.08, -0.03);
  handR.add(torch);
  const torchBody = mesh(new THREE.CylinderGeometry(0.028, 0.022, 0.2, 10), mat('#1d1f22', { metalness: 0.6, roughness: 0.4 }), false);
  torch.add(torchBody);
  const lens = mesh(new THREE.CircleGeometry(0.026, 12), new THREE.MeshBasicMaterial({ color: '#fff6dc' }), false);
  lens.position.y = -0.101;
  lens.rotation.x = Math.PI / 2;
  torch.add(lens);
  // Muzzle: local -Z points out of the lens (beam and light attach here).
  const muzzle = new THREE.Group();
  muzzle.position.y = -0.11;
  muzzle.rotation.x = -Math.PI / 2;
  torch.add(muzzle);

  const hw = 0.1 * B;
  const [thL, knL] = limb(hips, [-hw, -0.05, 0], 0.07 * B, 0.42 * H, pants, shadows);
  const [thR, knR] = limb(hips, [hw, -0.05, 0], 0.07 * B, 0.42 * H, pants, shadows);
  const [shinL, ftL] = limb(knL, [0, 0, 0], 0.058 * B, 0.4 * H, pants, shadows);
  const [shinR, ftR] = limb(knR, [0, 0, 0], 0.058 * B, 0.4 * H, pants, shadows);
  for (const f of [ftL, ftR]) {
    const shoe = mesh(box(0.1, 0.07, 0.24), accent, shadows);
    shoe.position.set(0, -0.02, -0.05);
    f.add(shoe);
  }
  // key on belt
  const keyMesh = mesh(box(0.03, 0.08, 0.01), mat('#d8b860', { emissive: '#7a5a10', emissiveIntensity: 1, metalness: 0.8 }), false);
  keyMesh.position.set(0.16 * B, -0.06, -0.1);
  hips.add(keyMesh);

  let phase = 0;
  let lastHit = -1;
  let hitT = 0;
  let downBlend = 0;
  let crouchBlend = 0;
  let t = 0;

  const update = (p: Pose, dt: number) => {
    t += dt;
    const moving = p.speed > 0.2;
    const sprint = p.sprinting && moving;
    phase += dt * (moving ? Math.min(14, 2.2 + p.speed * 2.1) : 0);
    if (p.hitSeq !== lastHit) {
      if (lastHit !== -1) hitT = 0.35;
      lastHit = p.hitSeq;
    }
    hitT = Math.max(0, hitT - dt);

    const downed = p.condition === 'downed';
    const captured = p.condition === 'captured';
    downBlend += ((downed ? 1 : 0) - downBlend) * Math.min(1, dt * 6);
    const working = ['repair', 'rescue', 'revive', 'heal', 'openExit', 'depositKey', 'pickupKey', 'pickup', 'selfheal'].includes(p.action);
    const kneel = captured || (working && p.action !== 'openExit' && p.action !== 'depositKey');
    crouchBlend += ((p.crouching || kneel ? 1 : 0) - crouchBlend) * Math.min(1, dt * 8);

    const sw = Math.sin(phase);
    const amp = moving ? (sprint ? 0.95 : p.crouching ? 0.45 : 0.6) : 0;
    const limp = p.condition === 'injured' ? 0.5 : 1;

    // Legs
    thL.rotation.x = sw * amp + crouchBlend * 1.1;
    thR.rotation.x = -sw * amp * limp + crouchBlend * 1.1;
    shinL.rotation.x = -Math.max(0, -Math.cos(phase)) * amp * 1.2 - crouchBlend * 1.9;
    shinR.rotation.x = -Math.max(0, Math.cos(phase)) * amp * 1.1 - crouchBlend * 1.9;
    // Arms
    shL.rotation.x = -sw * amp * 0.9;
    shR.rotation.x = sw * amp * 0.9;
    shL.rotation.z = -0.08;
    shR.rotation.z = 0.08;
    foreL.rotation.x = 0.25 + (sprint ? 0.9 : 0.15);
    foreR.rotation.x = 0.25 + (sprint ? 0.9 : 0.15);
    if (p.flashlight && !working) {
      shR.rotation.x = 1.3 + p.pitch * 0.7;
      foreR.rotation.x = 0.1;
    }
    if (working) {
      const w = Math.sin(t * 9) * 0.15;
      shL.rotation.x = 1.2 + w;
      shR.rotation.x = 1.2 - w;
      foreL.rotation.x = 0.5;
      foreR.rotation.x = 0.5;
    }
    if (p.condition === 'injured' && !working) {
      shL.rotation.x = 0.5;
      foreL.rotation.x = 1.6;
      shL.rotation.z = 0.5;
    }
    if (captured) {
      shL.rotation.x = 2.6;
      shR.rotation.x = 2.6;
      foreL.rotation.x = 0;
      foreR.rotation.x = 0;
      shL.rotation.z = 0.3;
      shR.rotation.z = -0.3;
    }

    const breathe = Math.sin(t * 1.8) * 0.012;
    spine.rotation.x = -(sprint ? 0.35 : moving ? 0.1 : 0) - crouchBlend * 0.35 + hitT * 1.2 + breathe;
    spine.rotation.z = p.condition === 'injured' ? 0.08 : 0;
    neck.rotation.x = -spine.rotation.x * 0.5 + p.pitch * 0.5;
    hips.position.y = 0.95 * H - crouchBlend * 0.38 * H + Math.abs(Math.cos(phase)) * amp * 0.04;

    // Downed: lie prone and crawl.
    body.rotation.x = -downBlend * 1.35;
    body.position.y = downBlend * 0.18;
    body.position.z = downBlend * 0.75;
    if (downBlend > 0.5) {
      const c = moving ? Math.sin(phase * 0.6) : 0;
      shL.rotation.x = 2.6 + c * 0.6;
      shR.rotation.x = 2.6 - c * 0.6;
      thL.rotation.x = c * 0.3;
      thR.rotation.x = -c * 0.3;
      shinL.rotation.x = -0.3;
      shinR.rotation.x = -0.3;
    }
    keyMesh.visible = p.carryingKey;
    torch.visible = p.condition !== 'downed' && p.condition !== 'captured';
    lens.visible = p.flashlight;
  };

  return {
    root,
    hand: muzzle,
    arm: shR,
    head,
    update,
    dispose: () => root.traverse((o) => (o as THREE.Mesh).material && ((o as THREE.Mesh).material as THREE.Material).dispose()),
  };
}

function hunterRig(def: CharacterDef, skinId: string, shadows: boolean): Rig {
  const skin = getSkin(def.id, skinId);
  const H = def.build.height;
  const S = def.build.shoulders;
  const B = def.build.bulk;
  const primary = mat(skin.primary, { roughness: 0.95 });
  const secondary = mat(skin.secondary, { roughness: 0.8 });
  const eyes = new THREE.MeshBasicMaterial({ color: skin.accent });
  const metal = mat('#8a8e92', { metalness: 0.85, roughness: 0.35 });
  const id = def.id;

  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 1.0 * H;
  root.add(hips);
  const spine = new THREE.Group();
  hips.add(spine);
  const torso = mesh(capsule(0.2 * B, 0.42 * H), primary, shadows);
  torso.scale.set(1.2 * S, 1, id === 'butcher' ? 1.15 : 0.75);
  torso.position.y = 0.32 * H;
  spine.add(torso);
  const chest = new THREE.Group();
  chest.position.y = 0.62 * H;
  spine.add(chest);
  const neck = new THREE.Group();
  neck.position.y = 0.08;
  chest.add(neck);
  const head = new THREE.Group();
  head.position.y = 0.14;
  neck.add(head);

  if (id === 'wraith') {
    const hood = mesh(new THREE.ConeGeometry(0.2, 0.45, 12, 1, true), primary, shadows);
    hood.position.y = 0.06;
    head.add(hood);
    const voidM = new THREE.MeshBasicMaterial({ color: '#000000' });
    const face = mesh(sphere(0.12), voidM, false);
    face.position.set(0, -0.04, -0.03);
    head.add(face);
    // cloak to the ground
    const cloak = mesh(new THREE.ConeGeometry(0.55 * S, 1.75 * H, 14, 4, true), primary, shadows);
    cloak.position.y = -0.55 * H;
    chest.add(cloak);
    (cloak.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  } else if (id === 'butcher') {
    const sack = mesh(sphere(0.17), secondary, shadows);
    sack.scale.set(1, 1.15, 1);
    head.add(sack);
    const apron = mesh(box(0.5 * S, 0.8 * H, 0.03), mat(skin.accent, { roughness: 0.5 }), shadows);
    apron.position.set(0, 0.15 * H, -0.22);
    spine.add(apron);
  } else {
    const skull = mesh(sphere(0.12), secondary, shadows);
    skull.scale.set(0.8, 1, 1.5);
    skull.position.z = -0.05;
    head.add(skull);
    const antlerM = secondary;
    for (const side of [-1, 1]) {
      const a = new THREE.Group();
      a.position.set(0.07 * side, 0.08, 0.02);
      a.rotation.z = -0.5 * side;
      head.add(a);
      const main = mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.55, 6), antlerM, shadows);
      main.position.y = 0.27;
      a.add(main);
      for (let k = 0; k < 3; k++) {
        const tine = mesh(new THREE.CylinderGeometry(0.008, 0.014, 0.22, 5), antlerM, false);
        tine.position.set(0.05 * side, 0.18 + k * 0.13, -0.04);
        tine.rotation.z = -0.8 * side;
        tine.rotation.x = -0.4;
        a.add(tine);
      }
    }
  }
  for (const sx of [-0.045, 0.045]) {
    const e = mesh(sphere(0.018), eyes, false);
    e.position.set(sx, 0, -0.13);
    head.add(e);
  }

  const armLen = id === 'butcher' ? 0.32 : 0.42;
  const [shL, elL] = limb(chest, [-0.26 * S, -0.03, 0], 0.07 * B, armLen * H, primary, shadows);
  const [shR, elR] = limb(chest, [0.26 * S, -0.03, 0], 0.07 * B, armLen * H, primary, shadows);
  const [foreL, handL] = limb(elL, [0, 0, 0], 0.055 * B, armLen * H, primary, shadows);
  const [foreR, handR] = limb(elR, [0, 0, 0], 0.055 * B, armLen * H, primary, shadows);
  const weapon = new THREE.Group();
  handR.add(weapon);
  if (id === 'butcher') {
    const handle = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 8), mat('#2a1a10'), false);
    handle.rotation.x = Math.PI / 2;
    handle.position.z = -0.05;
    weapon.add(handle);
    const blade = mesh(box(0.012, 0.18, 0.34), metal, shadows);
    blade.position.set(0, -0.06, -0.3);
    weapon.add(blade);
  } else {
    for (const h of [handL, handR]) {
      for (let k = -1; k <= 1; k++) {
        const claw = mesh(new THREE.ConeGeometry(0.012, 0.22, 5), id === 'hollow' ? secondary : metal, false);
        claw.position.set(k * 0.025, -0.11, -0.02);
        claw.rotation.x = Math.PI;
        h.add(claw);
      }
    }
  }

  let legs: { thL: THREE.Group; thR: THREE.Group; shinL: THREE.Group; shinR: THREE.Group } | null = null;
  if (id !== 'wraith') {
    const legLen = id === 'hollow' ? 0.5 : 0.45;
    const [thL, knL] = limb(hips, [-0.13 * B, -0.05, 0], 0.09 * B, legLen * H, secondary, shadows);
    const [thR, knR] = limb(hips, [0.13 * B, -0.05, 0], 0.09 * B, legLen * H, secondary, shadows);
    const [shinL] = limb(knL, [0, 0, 0], 0.07 * B, legLen * H, secondary, shadows);
    const [shinR] = limb(knR, [0, 0, 0], 0.07 * B, legLen * H, secondary, shadows);
    legs = { thL, thR, shinL, shinR };
    if (id === 'hollow') hips.position.y = 1.08 * H;
  }

  let phase = 0;
  let t = 0;
  let lastAttack = -1;
  let attackT = 0;

  const update = (p: Pose, dt: number) => {
    t += dt;
    const moving = p.speed > 0.2;
    phase += dt * (moving ? 2 + p.speed * 1.6 : 0);
    if (p.attackSeq !== lastAttack) {
      if (lastAttack !== -1) attackT = 0.45;
      lastAttack = p.attackSeq;
    }
    attackT = Math.max(0, attackT - dt);
    const sw = Math.sin(phase);
    const amp = moving ? 0.55 : 0;
    const stunned = p.action === 'stunned' || p.action === 'blinded';
    const charging = p.action === 'charging';

    if (legs) {
      legs.thL.rotation.x = sw * amp * (charging ? 1.6 : 1);
      legs.thR.rotation.x = -sw * amp * (charging ? 1.6 : 1);
      legs.shinL.rotation.x = -Math.max(0, -Math.cos(phase)) * amp * 1.3;
      legs.shinR.rotation.x = -Math.max(0, Math.cos(phase)) * amp * 1.3;
    } else {
      hips.position.y = 1.0 * H + Math.sin(t * 1.6) * 0.06 + 0.1;
    }
    const hunch = id === 'hollow' ? 0.45 : id === 'butcher' ? 0.2 : 0.12;
    spine.rotation.x = -hunch - (charging ? 0.5 : 0) + (stunned ? 0.4 : 0);
    neck.rotation.x = hunch * 0.8 + p.pitch * 0.6 + Math.sin(t * 0.7) * 0.05;
    neck.rotation.y = stunned ? Math.sin(t * 12) * 0.4 : 0;

    // Attack: right arm raises then slashes down across the body.
    const a = attackT > 0 ? 1 - attackT / 0.45 : 0;
    const raise = a < 0.35 ? a / 0.35 : 1 - (a - 0.35) / 0.65;
    shR.rotation.x = attackT > 0 ? (a < 0.35 ? 2.8 * raise : 2.8 - 3.4 * ((a - 0.35) / 0.65)) : -sw * amp * 0.6 + 0.25;
    shR.rotation.z = attackT > 0 ? 0.35 * raise : 0.15;
    foreR.rotation.x = attackT > 0 ? 0.8 * raise : 0.5;
    shL.rotation.x = sw * amp * 0.6 + 0.3 + (stunned ? 1.8 : 0);
    shL.rotation.z = -0.15;
    foreL.rotation.x = 0.6 + (stunned ? 1 : 0);
    if (p.action === 'capture' || p.action === 'break' || p.action === 'kick' || p.action === 'search') {
      const w = Math.sin(t * 8) * 0.3;
      shL.rotation.x = 1.4 + w;
      shR.rotation.x = 1.4 - w;
    }
    void weapon;
  };

  return {
    root,
    hand: handR,
    arm: shR,
    head,
    update,
    dispose: () => root.traverse((o) => (o as THREE.Mesh).material && ((o as THREE.Mesh).material as THREE.Material).dispose()),
  };
}
