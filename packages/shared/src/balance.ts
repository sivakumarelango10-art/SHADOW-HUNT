/**
 * Every gameplay tunable lives here so balance changes never require touching
 * systems code. Server and client both import these values, which keeps client
 * prediction identical to the authoritative simulation.
 */
export const NET = {
  /** Server simulation tick (ms). */
  tickMs: 1000 / 30,
  /** State patch broadcast interval (ms). */
  patchMs: 50,
  /** How far behind "now" remote entities are rendered (ms). */
  interpolationDelayMs: 110,
  /** Client input send interval (ms). */
  inputSendMs: 33,
  /** Max inputs accepted in one batch. */
  maxInputsPerBatch: 12,
  /** Max seconds of simulated movement a client may bank (anti speed-hack). */
  maxTimeBudget: 0.35,
  /** Seconds a dropped client may reconnect during a match. */
  reconnectSeconds: 45,
  /** Seconds a dropped client may reconnect in the lobby. */
  lobbyReconnectSeconds: 15,
  /** Rate limit for all room messages. */
  maxMessagesPerSecond: 90,
  /** Lag compensation: maximum rewind for hunter attacks (ms). */
  maxRewindMs: 250,
} as const;

export const PLAYER = {
  survivorRadius: 0.38,
  hunterRadius: 0.5,
  eyeHeight: 1.62,
  crouchEyeHeight: 1.05,
  downedEyeHeight: 0.45,
  hunterEyeHeight: 2.05,
  walkSpeed: 3.3,
  sprintSpeed: 5.7,
  crouchSpeed: 1.55,
  downedSpeed: 0.65,
  hunterSpeed: 5.0,
  hunterCarrySlow: 0.9,
  staminaMax: 100,
  staminaDrain: 15,
  staminaRegen: 11,
  staminaRegenDelay: 0.9,
  exhaustedRecoverAt: 30,
  hitSpeedBoost: 1.45,
  hitSpeedBoostSeconds: 2.2,
  rescuedProtectionSeconds: 2.5,
  maxHealth: 2,
  bleedOutSeconds: 100,
} as const;

export const FLASHLIGHT = {
  drainPerSecond: 1.1,
  batteryPickupAmount: 55,
  max: 100,
} as const;

export const HUNTER = {
  attackRange: 2.5,
  attackConeDeg: 55,
  attackCooldownMiss: 1.2,
  attackCooldownHit: 2.6,
  /** Hunter is slowed briefly after landing a hit (wipes blade). */
  postHitSlowSeconds: 1.8,
  postHitSlowMul: 0.55,
  captureDuration: 1.6,
  breakPalletDuration: 2.2,
  kickGeneratorDuration: 1.8,
  searchLockerDuration: 1.2,
  palletStunSeconds: 2.2,
  blindSeconds: 2.0,
  roarCooldown: 32,
  roarRadius: 24,
} as const;

export const ABILITIES = {
  shadow_step: { cooldown: 24, range: 20, coneDeg: 50, channel: 0.6 },
  brutal_charge: { cooldown: 18, duration: 1.15, speedMul: 2.3, wallStunSeconds: 1.6 },
  echo_sense: { cooldown: 30, radius: 30, duration: 4.5 },
} as const;

export const OBJECTIVES = {
  generatorSoloSeconds: 48,
  /** Each extra repairer adds this fraction of a solo repairer's speed. */
  coopEfficiency: 0.75,
  skillCheckMinGap: 3.5,
  skillCheckMaxGap: 8.5,
  skillCheckNeedleSeconds: 1.15,
  skillCheckLatencyGrace: 0.45,
  skillCheckFailPenalty: 0.07,
  skillCheckGreatBonus: 0.02,
  kickRegressionPerSecond: 1 / 120,
  keyPickupDuration: 0.8,
  keyDepositDuration: 1.2,
  exitOpenDuration: 9,
  rescueDuration: 2.4,
  reviveDuration: 6,
  healDuration: 7,
  medkitDuration: 6,
  pickupDuration: 0.7,
  palletDropDuration: 0.25,
  doorDuration: 0.35,
  hatchDuration: 1.4,
  hideDuration: 0.6,
  /** Seconds a survivor can hide before breathing starts emitting noise. */
  hideQuietSeconds: 14,
  /** Hard limit: survivor is forced out after this many seconds. */
  hideMaxSeconds: 32,
  captureFirstSeconds: 60,
  captureSecondSeconds: 30,
  interactRange: 2.0,
} as const;

export const NOISE = {
  sprintRadius: 18,
  walkRadius: 7,
  sprintInterval: 0.45,
  skillFailRadius: 45,
  palletRadius: 30,
  doorRadius: 14,
  breathingRadius: 10,
  firecrackerRadius: 40,
  /** Random offset applied to noise pings so the hunter gets a direction, not a coordinate. */
  jitter: 2.2,
} as const;

export const MATCH = {
  countdownSeconds: 5,
  defaultMinutes: 12,
  minuteOptions: [8, 10, 12, 15] as readonly number[],
  minPlayers: 2,
  maxPlayers: 9,
  resultsHoldSeconds: 0,
} as const;

export const ITEMS = {
  firecrackerRange: 14,
  firecrackerBlindRadius: 5,
} as const;

export const XP = {
  participation: 50,
  escape: 120,
  generatorFull: 60,
  skillGreat: 4,
  rescue: 60,
  revive: 45,
  heal: 30,
  keyDeposit: 30,
  exitOpened: 40,
  hunterHit: 15,
  hunterDown: 25,
  hunterCapture: 40,
  hunterElimination: 70,
  win: 150,
} as const;
