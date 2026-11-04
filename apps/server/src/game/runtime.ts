import { emptyMatchStats, type InteractKind, type MoveInput, type PlayerMatchStats } from '@shadow-hunt/shared';
import type { BotController } from './Bot.ts';

export type ActionKind = InteractKind | 'selfheal' | 'shadowstep' | 'stunned' | 'charging';

export interface ActiveAction {
  kind: ActionKind;
  id: string;
  elapsed: number;
  duration: number;
  continuous: boolean;
}

export interface PendingSkillCheck {
  id: number;
  sentAt: number;
  duration: number;
  zoneStart: number;
  zoneEnd: number;
  greatEnd: number;
}

/** Server-only per-player data that is never replicated. */
export interface Runtime {
  inputs: MoveInput[];
  budget: number;
  violations: number;
  history: { t: number; x: number; z: number }[];
  stats: PlayerMatchStats;
  action: ActiveAction | null;
  skill: PendingSkillCheck | null;
  nextSkillAt: number;
  boostUntil: number;
  slowUntil: number;
  protectUntil: number;
  stunUntil: number;
  blindUntil: number;
  chargeUntil: number;
  chargeYaw: number;
  chargeHit: boolean;
  echoUntil: number;
  nextEchoPulse: number;
  hideStart: number;
  nextBreath: number;
  nextStepNoise: number;
  nextTrack: number;
  lastMoveAt: number;
  movedRecently: number;
  bot: BotController | null;
  /** Seconds this player spent connected-but-idle or disconnected (for abandon handling). */
  disconnectedAt: number;
}

export function newRuntime(): Runtime {
  return {
    inputs: [],
    budget: 0,
    violations: 0,
    history: [],
    stats: emptyMatchStats(),
    action: null,
    skill: null,
    nextSkillAt: 0,
    boostUntil: 0,
    slowUntil: 0,
    protectUntil: 0,
    stunUntil: 0,
    blindUntil: 0,
    chargeUntil: 0,
    chargeYaw: 0,
    chargeHit: false,
    echoUntil: 0,
    nextEchoPulse: 0,
    hideStart: 0,
    nextBreath: 0,
    nextStepNoise: 0,
    nextTrack: 0,
    lastMoveAt: 0,
    movedRecently: 0,
    bot: null,
    disconnectedAt: 0,
  };
}
