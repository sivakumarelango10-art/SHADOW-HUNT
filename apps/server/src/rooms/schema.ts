import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * Replicated state. Colyseus sends only changed fields (delta patches) at the
 * room patch rate, so this is never a full world snapshot per frame.
 */
export const PlayerState = schema(
  {
    sessionId: t.string().default(''),
    playerId: t.string().default(''),
    name: t.string().default(''),
    title: t.string().default(''),
    avatar: t.string().default('moth'),
    level: t.uint8().default(1),
    survivorChar: t.string().default('alex'),
    hunterChar: t.string().default('wraith'),
    characterId: t.string().default('alex'),
    skinId: t.string().default('default'),
    role: t.string().default('survivor'),
    isHost: t.boolean().default(false),
    isBot: t.boolean().default(false),
    ready: t.boolean().default(false),
    preferHunter: t.boolean().default(false),
    connected: t.boolean().default(true),

    x: t.float32().default(0),
    z: t.float32().default(0),
    yaw: t.float32().default(0),
    pitch: t.float32().default(0),
    lastSeq: t.uint32().default(0),
    crouching: t.boolean().default(false),
    sprinting: t.boolean().default(false),
    stamina: t.float32().default(100),
    staminaDelay: t.float32().default(0),
    exhausted: t.boolean().default(false),
    speedMul: t.float32().default(1),
    locked: t.boolean().default(false),

    condition: t.string().default('healthy'),
    health: t.uint8().default(2),
    flashlight: t.boolean().default(false),
    battery: t.float32().default(100),
    action: t.string().default('none'),
    actionTarget: t.string().default(''),
    actionProgress: t.float32().default(0),
    hiddenIn: t.string().default(''),
    carryingKey: t.boolean().default(false),
    item: t.string().default(''),
    cageId: t.string().default(''),
    captureStage: t.uint8().default(0),
    captureTimer: t.float32().default(0),
    bleedTimer: t.float32().default(0),
    abilityCd: t.float32().default(0),
    roarCd: t.float32().default(0),
    attackCd: t.float32().default(0),
    /** Increments on every swing / hit so clients can trigger one-shot animations. */
    attackSeq: t.uint16().default(0),
    hitSeq: t.uint16().default(0),
  },
  'PlayerState',
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const GeneratorState = schema(
  {
    progress: t.float32().default(0),
    completed: t.boolean().default(false),
    kicked: t.boolean().default(false),
    repairers: t.uint8().default(0),
  },
  'GeneratorState',
);
export type GeneratorState = SchemaType<typeof GeneratorState>;

export const ExitState = schema(
  {
    progress: t.float32().default(0),
    open: t.boolean().default(false),
  },
  'ExitState',
);
export type ExitState = SchemaType<typeof ExitState>;

export const KeyState = schema(
  {
    x: t.float32().default(0),
    z: t.float32().default(0),
    carriedBy: t.string().default(''),
    deposited: t.boolean().default(false),
  },
  'KeyState',
);
export type KeyState = SchemaType<typeof KeyState>;

export const DoorState = schema(
  {
    open: t.boolean().default(true),
    locked: t.boolean().default(false),
  },
  'DoorState',
);
export type DoorState = SchemaType<typeof DoorState>;

export const GameState = schema(
  {
    phase: t.string().default('lobby'),
    mapId: t.string().default('blackwood'),
    roomCode: t.string().default(''),
    hostId: t.string().default(''),
    isPublic: t.boolean().default(false),
    matchMinutes: t.uint8().default(12),
    generatorsSetting: t.uint8().default(0),
    hunterMode: t.string().default('player'),
    matchId: t.string().default(''),

    countdown: t.float32().default(0),
    timeLeft: t.float32().default(0),
    elapsed: t.float32().default(0),
    powerOn: t.boolean().default(false),
    generatorsRequired: t.uint8().default(5),
    generatorsCompleted: t.uint8().default(0),
    keysRequired: t.uint8().default(2),
    keysDeposited: t.uint8().default(0),
    exitsOpen: t.uint8().default(0),

    players: t.map(PlayerState),
    generators: t.map(GeneratorState),
    exits: t.map(ExitState),
    keys: t.map(KeyState),
    doors: t.map(DoorState),
    pallets: t.map('string'),
    pickups: t.map('boolean'),
    cages: t.map('string'),

    winner: t.string().default(''),
    resultsJson: t.string().default(''),
  },
  'GameState',
);
export type GameState = SchemaType<typeof GameState>;
