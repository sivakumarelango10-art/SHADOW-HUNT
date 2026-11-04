export type Role = 'survivor' | 'hunter';

/** Survivor state machine (see `stateMachine.ts`). Hunters stay `healthy`. */
export type Condition =
  | 'healthy'
  | 'injured'
  | 'downed'
  | 'captured'
  | 'rescued'
  | 'escaped'
  | 'eliminated';

export type GamePhase = 'lobby' | 'countdown' | 'playing' | 'results';

export type MapId = 'blackwood' | 'asylum';

export type SurvivorId = 'alex' | 'mia' | 'ethan' | 'luna' | 'noah' | 'ava';
export type HunterId = 'wraith' | 'butcher' | 'hollow';
export type CharacterId = SurvivorId | HunterId;

export type AbilityId = 'shadow_step' | 'brutal_charge' | 'echo_sense';

export type ItemKind = 'firecracker' | 'medkit' | 'battery';

export type HunterMode = 'player' | 'bot';

/** Things a player can be doing that other players should see. */
export type ActionKind =
  | 'none'
  | 'repair'
  | 'rescue'
  | 'revive'
  | 'heal'
  | 'selfheal'
  | 'pickupKey'
  | 'depositKey'
  | 'openExit'
  | 'hide'
  | 'unhide'
  | 'hidden'
  | 'pallet'
  | 'door'
  | 'hatch'
  | 'pickup'
  | 'capture'
  | 'break'
  | 'kick'
  | 'search'
  | 'attack'
  | 'stunned'
  | 'blinded'
  | 'charging'
  | 'shadowstep'
  | 'roar';

export type InteractKind =
  | 'repair'
  | 'rescue'
  | 'revive'
  | 'heal'
  | 'pickupKey'
  | 'depositKey'
  | 'openExit'
  | 'hide'
  | 'unhide'
  | 'pallet'
  | 'door'
  | 'hatch'
  | 'pickup'
  | 'capture'
  | 'break'
  | 'kick'
  | 'search';

export interface Vec2 {
  x: number;
  z: number;
}

export interface MatchSettings {
  matchMinutes: number;
  /** 0 = use map default. */
  generatorsRequired: number;
  hunterMode: HunterMode;
  isPublic: boolean;
}

/** One movement command produced by the client every frame. */
export interface MoveInput {
  seq: number;
  /** Seconds simulated by this input. */
  dt: number;
  /** Strafe axis -1..1 (right positive). */
  mx: number;
  /** Forward axis -1..1 (forward positive). */
  mz: number;
  yaw: number;
  pitch: number;
  sprint: boolean;
  crouch: boolean;
}

export type GameOutcome = 'escaped' | 'eliminated' | 'survived_timeout' | 'hunter_win' | 'hunter_loss';

export interface PlayerMatchStats {
  generatorProgress: number;
  skillGreats: number;
  skillFails: number;
  rescues: number;
  revives: number;
  heals: number;
  keysDeposited: number;
  exitsOpened: number;
  timesHit: number;
  timesCaptured: number;
  hits: number;
  downs: number;
  captures: number;
  eliminations: number;
  palletsStunned: number;
  sprintSeconds: number;
  hideSeconds: number;
}

export interface PlayerResult {
  sessionId: string;
  playerId: string;
  name: string;
  role: Role;
  characterId: CharacterId;
  outcome: GameOutcome;
  stats: PlayerMatchStats;
  xpGained: number;
  xpBreakdown: { label: string; xp: number }[];
  newAchievements: string[];
  levelBefore: number;
  levelAfter: number;
  unlocked: string[];
  isBot: boolean;
}

export interface MatchResults {
  matchId: string;
  mapId: MapId;
  winner: 'survivors' | 'hunter';
  durationSeconds: number;
  survivorsEscaped: number;
  survivorsTotal: number;
  generatorsCompleted: number;
  generatorsRequired: number;
  hunterCaptures: number;
  players: PlayerResult[];
  persisted: boolean;
}

export interface ProfileStats {
  totalMatches: number;
  wins: number;
  losses: number;
  survivorMatches: number;
  hunterMatches: number;
  escapes: number;
  captures: number;
  eliminations: number;
  rescues: number;
  generatorsRepaired: number;
  playtimeSeconds: number;
}

export interface Profile {
  id: string;
  username: string;
  avatar: string;
  isGuest: boolean;
  xp: number;
  level: number;
  title: string;
  stats: ProfileStats;
  achievements: string[];
  equippedSkins: Partial<Record<CharacterId, string>>;
  createdAt: string;
}

export interface MatchHistoryEntry {
  matchId: string;
  mapId: MapId;
  role: Role;
  characterId: CharacterId;
  outcome: GameOutcome;
  won: boolean;
  xpGained: number;
  durationSeconds: number;
  playedAt: string;
}

export interface FriendEntry {
  id: string;
  username: string;
  avatar: string;
  level: number;
  online: boolean;
  /** Room code if the friend is in a joinable lobby. */
  roomCode: string | null;
}

export function emptyStats(): ProfileStats {
  return {
    totalMatches: 0,
    wins: 0,
    losses: 0,
    survivorMatches: 0,
    hunterMatches: 0,
    escapes: 0,
    captures: 0,
    eliminations: 0,
    rescues: 0,
    generatorsRepaired: 0,
    playtimeSeconds: 0,
  };
}

export function emptyMatchStats(): PlayerMatchStats {
  return {
    generatorProgress: 0,
    skillGreats: 0,
    skillFails: 0,
    rescues: 0,
    revives: 0,
    heals: 0,
    keysDeposited: 0,
    exitsOpened: 0,
    timesHit: 0,
    timesCaptured: 0,
    hits: 0,
    downs: 0,
    captures: 0,
    eliminations: 0,
    palletsStunned: 0,
    sprintSeconds: 0,
    hideSeconds: 0,
  };
}
