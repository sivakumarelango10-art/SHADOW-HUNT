import type { CharacterId, InteractKind, MapId, MatchResults, MatchSettings, MoveInput } from './types.ts';

/** Client → server message names. Payload types are in `ClientMessages`. */
export const C2S = {
  input: 'input',
  interact: 'interact',
  interactStop: 'interactStop',
  attack: 'attack',
  ability: 'ability',
  roar: 'roar',
  flashlight: 'flashlight',
  useItem: 'useItem',
  skillCheck: 'skillCheck',
  setCharacter: 'setCharacter',
  setSkin: 'setSkin',
  setReady: 'setReady',
  setPreferHunter: 'setPreferHunter',
  setMap: 'setMap',
  setSettings: 'setSettings',
  startMatch: 'startMatch',
  kick: 'kick',
  returnToLobby: 'returnToLobby',
  chat: 'chat',
} as const;

export interface ClientMessages {
  input: { inputs: MoveInput[] };
  interact: { kind: InteractKind; id: string };
  interactStop: Record<string, never>;
  /** `viewDelayMs` = how far behind real time the attacker's view of others was. */
  attack: { viewDelayMs: number };
  ability: Record<string, never>;
  roar: Record<string, never>;
  flashlight: { on: boolean };
  useItem: Record<string, never>;
  skillCheck: { id: number; ratio: number };
  setCharacter: { characterId: CharacterId };
  setSkin: { characterId: CharacterId; skinId: string };
  setReady: { ready: boolean };
  setPreferHunter: { prefer: boolean };
  setMap: { mapId: MapId };
  setSettings: Partial<MatchSettings>;
  startMatch: Record<string, never>;
  kick: { sessionId: string };
  returnToLobby: Record<string, never>;
  chat: { text: string };
}

/** Server → client message names. */
export const S2C = {
  skillCheck: 'skillCheck',
  skillCheckResult: 'skillCheckResult',
  noise: 'noise',
  track: 'track',
  reveal: 'reveal',
  fx: 'fx',
  feed: 'feed',
  notice: 'notice',
  results: 'results',
  chat: 'chat',
  kicked: 'kicked',
} as const;

export interface SkillCheckMsg {
  id: number;
  /** Needle sweep duration in seconds. */
  duration: number;
  zoneStart: number;
  zoneEnd: number;
  /** Great zone is the first part of the zone, up to `greatEnd`. */
  greatEnd: number;
}

export interface SkillCheckResultMsg {
  id: number;
  result: 'great' | 'good' | 'fail';
}

export interface NoiseMsg {
  x: number;
  z: number;
  kind: 'step' | 'sprint' | 'skill_fail' | 'pallet' | 'door' | 'breath' | 'firecracker' | 'roar_flinch' | 'locker';
}

export interface TrackMsg {
  x: number;
  z: number;
  kind: 'scratch' | 'blood';
}

export interface RevealMsg {
  targets: { id: string; x: number; z: number }[];
  duration: number;
}

export type FxKind =
  | 'swing'
  | 'hit'
  | 'down'
  | 'capture'
  | 'rescue'
  | 'eliminated'
  | 'escape'
  | 'roar'
  | 'gen_fail'
  | 'gen_done'
  | 'power_on'
  | 'pallet_drop'
  | 'pallet_stun'
  | 'pallet_break'
  | 'door'
  | 'exit_open'
  | 'key_pickup'
  | 'key_deposit'
  | 'shadow_step'
  | 'charge_start'
  | 'charge_wall'
  | 'echo_sense'
  | 'firecracker'
  | 'hatch'
  | 'locker'
  | 'gen_kick';

export interface FxMsg {
  kind: FxKind;
  x: number;
  z: number;
  /** Optional destination for movement effects. */
  x2?: number;
  z2?: number;
  by?: string;
  target?: string;
}

export interface FeedMsg {
  text: string;
  tone: 'info' | 'danger' | 'success';
}

export interface NoticeMsg {
  text: string;
}

export interface ChatMsg {
  from: string;
  name: string;
  text: string;
}

export type ResultsMsg = MatchResults;

/** Options passed when creating/joining a room. */
export interface JoinOptions {
  token: string;
  /** Room creation only. */
  isPublic?: boolean;
  mode?: 'quick' | 'private';
  characterId?: CharacterId;
}
