import type { AbilityId, CharacterId, HunterId, Role, SurvivorId } from './types.ts';

export interface SkinDef {
  id: string;
  name: string;
  /** Level at which this skin unlocks (earned through play only). */
  unlockLevel: number;
  primary: string;
  secondary: string;
  accent: string;
}

export interface CharacterDef {
  id: CharacterId;
  role: Role;
  name: string;
  tagline: string;
  bio: string;
  unlockLevel: number;
  /** Body proportions consumed by the procedural rig. */
  build: { height: number; shoulders: number; bulk: number };
  hair: 'short' | 'long' | 'bun' | 'cap' | 'hood' | 'none';
  skins: SkinDef[];
  ability?: AbilityId;
  perk?: string;
}

const s = (
  id: string,
  name: string,
  unlockLevel: number,
  primary: string,
  secondary: string,
  accent: string,
): SkinDef => ({ id, name, unlockLevel, primary, secondary, accent });

export const SURVIVORS: Record<SurvivorId, CharacterDef> = {
  alex: {
    id: 'alex', role: 'survivor', name: 'Alex', tagline: 'The mechanic',
    bio: 'Fixed trucks for a living before the forest swallowed the highway. Steady hands under pressure.',
    unlockLevel: 1, build: { height: 1.0, shoulders: 1.05, bulk: 1.05 }, hair: 'cap',
    perk: 'Steady Hands — skill check great zones are wider.',
    skins: [s('default', 'Work Jacket', 1, '#4a5a3c', '#2a2a2e', '#c9a46a'), s('night', 'Night Shift', 4, '#22303f', '#16181c', '#7fa6c9')],
  },
  mia: {
    id: 'mia', role: 'survivor', name: 'Mia', tagline: 'The medic',
    bio: 'Third-year nursing student. Knows exactly how much blood a person can lose.',
    unlockLevel: 1, build: { height: 0.94, shoulders: 0.9, bulk: 0.9 }, hair: 'bun',
    perk: 'Field Medic — heals and revives teammates faster.',
    skins: [s('default', 'Scrubs', 1, '#3f6b6a', '#e2ded3', '#b33a3a'), s('ember', 'Ember', 5, '#5a2a24', '#2a2422', '#e0b080')],
  },
  ethan: {
    id: 'ethan', role: 'survivor', name: 'Ethan', tagline: 'The runner',
    bio: 'Cross-country captain. Never stops moving, never looks back.',
    unlockLevel: 1, build: { height: 1.05, shoulders: 1.0, bulk: 0.92 }, hair: 'short',
    perk: 'Second Wind — stamina recovers faster.',
    skins: [s('default', 'Track Kit', 1, '#7a2b2b', '#22262b', '#e0e0e0'), s('ghost', 'Ghost Grey', 6, '#5b5f63', '#2b2d30', '#a8c0c8')],
  },
  luna: {
    id: 'luna', role: 'survivor', name: 'Luna', tagline: 'The urbex photographer',
    bio: 'Breaks into abandoned places for the shot. Moves quietly, sees everything.',
    unlockLevel: 2, build: { height: 0.96, shoulders: 0.88, bulk: 0.88 }, hair: 'long',
    perk: 'Light Step — crouching is faster.',
    skins: [s('default', 'Field Coat', 2, '#2f3b2f', '#151719', '#9a8a6a'), s('crimson', 'Crimson', 8, '#5e1d24', '#151315', '#d7b38c')],
  },
  noah: {
    id: 'noah', role: 'survivor', name: 'Noah', tagline: 'The night guard',
    bio: 'Worked graveyard shifts at the asylum before it closed. Still has the keys — most of them.',
    unlockLevel: 4, build: { height: 1.08, shoulders: 1.12, bulk: 1.15 }, hair: 'short',
    perk: 'Night Watch — flashlight battery drains slower.',
    skins: [s('default', 'Security Uniform', 4, '#2c3646', '#1a1c20', '#c8b060'), s('storm', 'Storm', 9, '#3b4148', '#202326', '#8ab0d0')],
  },
  ava: {
    id: 'ava', role: 'survivor', name: 'Ava', tagline: 'The investigator',
    bio: 'Paranormal podcast host who finally found what she was looking for.',
    unlockLevel: 6, build: { height: 0.98, shoulders: 0.9, bulk: 0.9 }, hair: 'hood',
    perk: 'Keen Ear — the heartbeat warns you from further away.',
    skins: [s('default', 'Hoodie', 6, '#3d2f4a', '#18161a', '#c8c0d8'), s('moss', 'Moss', 10, '#3a4630', '#16180f', '#c0b890')],
  },
};

export const HUNTERS: Record<HunterId, CharacterDef> = {
  wraith: {
    id: 'wraith', role: 'hunter', name: 'The Wraith', tagline: 'It moves where light does not',
    bio: 'A shape stitched out of the dark between trees. It does not walk so much as arrive.',
    unlockLevel: 1, build: { height: 1.22, shoulders: 0.95, bulk: 0.85 }, hair: 'hood',
    ability: 'shadow_step',
    skins: [s('default', 'Shroud', 1, '#141518', '#2b2f35', '#9fd0ff'), s('ash', 'Ashen', 7, '#3a3836', '#1c1b1a', '#ffb070')],
  },
  butcher: {
    id: 'butcher', role: 'hunter', name: 'The Butcher', tagline: 'Heavy. Patient. Hungry.',
    bio: 'The asylum kitchen never closed. Neither did he.',
    unlockLevel: 3, build: { height: 1.18, shoulders: 1.35, bulk: 1.45 }, hair: 'none',
    ability: 'brutal_charge',
    skins: [s('default', 'Stained Apron', 3, '#4a3a32', '#2a2420', '#8a1a1a'), s('rust', 'Rust', 8, '#5a3220', '#251a14', '#c05020')],
  },
  hollow: {
    id: 'hollow', role: 'hunter', name: 'The Hollow', tagline: 'It hears your heart',
    bio: 'Something wearing an elk skull. It listens through the soil.',
    unlockLevel: 5, build: { height: 1.3, shoulders: 1.0, bulk: 0.8 }, hair: 'none',
    ability: 'echo_sense',
    skins: [s('default', 'Bone', 5, '#2a2520', '#d8cfbf', '#c03030'), s('moss', 'Lichen', 10, '#25301f', '#b8c0a0', '#60ff90')],
  },
};

export const CHARACTERS: Record<CharacterId, CharacterDef> = { ...SURVIVORS, ...HUNTERS };

export const SURVIVOR_IDS = Object.keys(SURVIVORS) as SurvivorId[];
export const HUNTER_IDS = Object.keys(HUNTERS) as HunterId[];

export function isSurvivorId(id: string): id is SurvivorId {
  return id in SURVIVORS;
}
export function isHunterId(id: string): id is HunterId {
  return id in HUNTERS;
}
export function isCharacterId(id: string): id is CharacterId {
  return id in CHARACTERS;
}

export function getSkin(characterId: CharacterId, skinId: string | undefined): SkinDef {
  const def = CHARACTERS[characterId];
  return def.skins.find((k) => k.id === skinId) ?? def.skins[0]!;
}

/** Perk modifiers, applied server-side and mirrored in client prediction. */
export const PERKS = {
  alex: { greatZoneMul: 1.5 },
  mia: { healSpeedMul: 1.35 },
  ethan: { staminaRegenMul: 1.3 },
  luna: { crouchSpeedMul: 1.3 },
  noah: { batteryDrainMul: 0.65 },
  ava: { heartbeatRangeMul: 1.35 },
} as const;
