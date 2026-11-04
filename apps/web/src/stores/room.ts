import { create } from 'zustand';
import type { ChatMsg, FeedMsg, GamePhase, MapId, MatchResults } from '@shadow-hunt/shared';

/** Plain-object snapshot of replicated state, refreshed ~10×/s for React UI. */
export interface PlayerView {
  sessionId: string;
  playerId: string;
  name: string;
  title: string;
  avatar: string;
  level: number;
  survivorChar: string;
  hunterChar: string;
  characterId: string;
  skinId: string;
  role: 'survivor' | 'hunter';
  isHost: boolean;
  isBot: boolean;
  ready: boolean;
  preferHunter: boolean;
  connected: boolean;
  condition: string;
  health: number;
  stamina: number;
  exhausted: boolean;
  battery: number;
  flashlight: boolean;
  action: string;
  actionTarget: string;
  actionProgress: number;
  hiddenIn: string;
  carryingKey: boolean;
  item: string;
  cageId: string;
  captureStage: number;
  captureTimer: number;
  bleedTimer: number;
  abilityCd: number;
  roarCd: number;
  attackCd: number;
  x: number;
  z: number;
}

export interface RoomSnapshot {
  code: string;
  phase: GamePhase;
  mapId: MapId;
  hostId: string;
  isPublic: boolean;
  matchMinutes: number;
  generatorsSetting: number;
  hunterMode: 'player' | 'bot';
  countdown: number;
  timeLeft: number;
  elapsed: number;
  powerOn: boolean;
  generatorsRequired: number;
  generatorsCompleted: number;
  keysRequired: number;
  keysDeposited: number;
  exitsOpen: number;
  winner: string;
  players: PlayerView[];
  generators: Record<string, { progress: number; completed: boolean; kicked: boolean; repairers: number }>;
}

export interface Toast {
  id: number;
  text: string;
  tone: FeedMsg['tone'] | 'notice';
}

interface RoomStore {
  connection: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';
  error: string | null;
  sessionId: string | null;
  snap: RoomSnapshot | null;
  results: MatchResults | null;
  chat: ChatMsg[];
  feed: Toast[];
  notices: Toast[];
  ping: number;
  set: (patch: Partial<Omit<RoomStore, 'set' | 'pushFeed' | 'pushNotice' | 'pushChat' | 'reset'>>) => void;
  pushFeed: (text: string, tone: FeedMsg['tone']) => void;
  pushNotice: (text: string) => void;
  pushChat: (m: ChatMsg) => void;
  reset: () => void;
}

let toastId = 1;

export const useRoom = create<RoomStore>((set, get) => ({
  connection: 'idle',
  error: null,
  sessionId: null,
  snap: null,
  results: null,
  chat: [],
  feed: [],
  notices: [],
  ping: 0,
  set: (patch) => set(patch),
  pushFeed: (text, tone) => {
    const t = { id: toastId++, text, tone };
    set({ feed: [...get().feed.slice(-5), t] });
    setTimeout(() => set({ feed: get().feed.filter((f) => f.id !== t.id) }), 7000);
  },
  pushNotice: (text) => {
    const t = { id: toastId++, text, tone: 'notice' as const };
    set({ notices: [...get().notices.slice(-2), t] });
    setTimeout(() => set({ notices: get().notices.filter((f) => f.id !== t.id) }), 3200);
  },
  pushChat: (m) => set({ chat: [...get().chat.slice(-60), m] }),
  reset: () =>
    set({ connection: 'idle', error: null, sessionId: null, snap: null, results: null, chat: [], feed: [], notices: [] }),
}));

export function selfView(): PlayerView | undefined {
  const { snap, sessionId } = useRoom.getState();
  return snap?.players.find((p) => p.sessionId === sessionId);
}
