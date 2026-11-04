import { Client, type Room } from '@colyseus/sdk';
import {
  C2S,
  S2C,
  type ChatMsg,
  type ClientMessages,
  type FeedMsg,
  type FxMsg,
  type MatchResults,
  type NoiseMsg,
  type RevealMsg,
  type SkillCheckMsg,
  type SkillCheckResultMsg,
  type TrackMsg,
} from '@shadow-hunt/shared';
import { WS_URL } from '../services/api';
import { useRoom, type PlayerView, type RoomSnapshot } from '../stores/room';
import { useSession } from '../stores/session';
import { clearSamples, pushSample } from '../game/systems/interpolation';
import { bus } from './events';

const RESUME_KEY = 'sh.resume';

let client: Client | null = null;
let room: Room | null = null;
let lastSnap = 0;
let snapTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let rtt = 80;
/** Incremented on every state patch; the game loop uses it to trigger reconciliation. */
export const netStats = { patches: 0 };

function getClient() {
  client ??= new Client(WS_URL);
  return client;
}

export function currentRoom(): Room | null {
  return room;
}

// Test/debug hook (used by the e2e script). Read-only view of the live room.
if (typeof window !== 'undefined') {
  (window as any).__shadowHunt = {
    room: () => room,
    state: () => (room?.state as any)?.toJSON?.() ?? null,
    sessionId: () => room?.sessionId ?? null,
  };
}
export function roundTripMs() {
  return rtt;
}

/** Converts Colyseus errors into something a player can act on. */
function friendly(e: unknown): string {
  const err = e as { code?: number; message?: string };
  const msg = err?.message ?? String(e);
  if (/not found|no rooms found|invalid room/i.test(msg) || err?.code === 4212) return 'No room with that code. Check it and try again.';
  if (/locked|full/i.test(msg)) return 'That room is full or a match is in progress.';
  if (/ECONNREFUSED|failed to fetch|network|connect/i.test(msg)) return 'Cannot reach the game server.';
  return msg;
}

function toView(p: any): PlayerView {
  return {
    sessionId: p.sessionId, playerId: p.playerId, name: p.name, title: p.title, avatar: p.avatar, level: p.level,
    survivorChar: p.survivorChar, hunterChar: p.hunterChar, characterId: p.characterId, skinId: p.skinId, role: p.role,
    isHost: p.isHost, isBot: p.isBot, ready: p.ready, preferHunter: p.preferHunter, connected: p.connected,
    condition: p.condition, health: p.health, stamina: p.stamina, exhausted: p.exhausted, battery: p.battery,
    flashlight: p.flashlight, action: p.action, actionTarget: p.actionTarget, actionProgress: p.actionProgress,
    hiddenIn: p.hiddenIn, carryingKey: p.carryingKey, item: p.item, cageId: p.cageId, captureStage: p.captureStage,
    captureTimer: p.captureTimer, bleedTimer: p.bleedTimer, abilityCd: p.abilityCd, roarCd: p.roarCd, attackCd: p.attackCd,
    x: p.x, z: p.z,
  };
}

function buildSnapshot(s: any): RoomSnapshot {
  const players: PlayerView[] = [];
  s.players?.forEach((p: any) => players.push(toView(p)));
  const generators: RoomSnapshot['generators'] = {};
  s.generators?.forEach((g: any, id: string) => (generators[id] = { progress: g.progress, completed: g.completed, kicked: g.kicked, repairers: g.repairers }));
  return {
    code: s.roomCode, phase: s.phase, mapId: s.mapId, hostId: s.hostId, isPublic: s.isPublic, matchMinutes: s.matchMinutes,
    generatorsSetting: s.generatorsSetting, hunterMode: s.hunterMode, countdown: s.countdown, timeLeft: s.timeLeft,
    elapsed: s.elapsed, powerOn: s.powerOn, generatorsRequired: s.generatorsRequired, generatorsCompleted: s.generatorsCompleted,
    keysRequired: s.keysRequired, keysDeposited: s.keysDeposited, exitsOpen: s.exitsOpen, winner: s.winner, players, generators,
  };
}

function scheduleSnapshot(force = false) {
  const now = performance.now();
  const state = room?.state;
  if (!state) return;
  const prevPhase = useRoom.getState().snap?.phase;
  if (force || now - lastSnap > 100 || prevPhase !== (state as any).phase) {
    lastSnap = now;
    if (snapTimer) clearTimeout(snapTimer);
    snapTimer = null;
    useRoom.getState().set({ snap: buildSnapshot(state) });
  } else if (!snapTimer) {
    snapTimer = setTimeout(() => scheduleSnapshot(true), 100 - (now - lastSnap));
  }
}

function attach(r: Room) {
  room = r;
  const store = useRoom.getState();
  store.set({ connection: 'connected', error: null, sessionId: r.sessionId, results: null, chat: [] });
  try {
    sessionStorage.setItem(RESUME_KEY, JSON.stringify({ token: r.reconnectionToken, roomId: r.roomId, at: Date.now() }));
  } catch {
    /* ignore */
  }
  r.reconnection.maxRetries = 12;

  r.onStateChange((state: any) => {
    netStats.patches++;
    const now = performance.now();
    state.players?.forEach((p: any, id: string) => {
      if (id !== r.sessionId) pushSample(id, p.x, p.z, p.yaw, p.pitch, now);
    });
    if (state.resultsJson && !useRoom.getState().results) {
      try {
        useRoom.getState().set({ results: JSON.parse(state.resultsJson) as MatchResults });
      } catch {
        /* ignore */
      }
    }
    if (state.phase === 'lobby' && useRoom.getState().results) useRoom.getState().set({ results: null });
    scheduleSnapshot();
  });

  r.onMessage(S2C.fx, (m: FxMsg) => bus.emit('fx', m));
  r.onMessage(S2C.noise, (m: NoiseMsg) => bus.emit('noise', m));
  r.onMessage(S2C.track, (m: TrackMsg) => bus.emit('track', m));
  r.onMessage(S2C.reveal, (m: RevealMsg) => bus.emit('reveal', m));
  r.onMessage(S2C.skillCheck, (m: SkillCheckMsg) => bus.emit('skillCheck', m));
  r.onMessage(S2C.skillCheckResult, (m: SkillCheckResultMsg) => bus.emit('skillCheckResult', m));
  r.onMessage(S2C.feed, (m: FeedMsg) => useRoom.getState().pushFeed(m.text, m.tone));
  r.onMessage(S2C.notice, (m: { text: string }) => useRoom.getState().pushNotice(m.text));
  r.onMessage(S2C.chat, (m: ChatMsg) => useRoom.getState().pushChat(m));
  r.onMessage(S2C.results, (m: MatchResults) => {
    useRoom.getState().set({ results: m });
    void useSession.getState().refreshProfile();
  });
  r.onMessage(S2C.kicked, (m: { text: string }) => useRoom.getState().set({ error: m.text }));

  r.onDrop(() => useRoom.getState().set({ connection: 'reconnecting' }));
  r.onReconnect(() => {
    useRoom.getState().set({ connection: 'connected' });
    scheduleSnapshot(true);
  });
  r.onLeave((code: number) => {
    if (room !== r) return;
    room = null;
    clearSamples();
    if (pingTimer) clearInterval(pingTimer);
    try {
      sessionStorage.removeItem(RESUME_KEY);
    } catch {
      /* ignore */
    }
    const kicked = useRoom.getState().error;
    useRoom.getState().reset();
    if (code !== 4000) useRoom.getState().set({ error: kicked ?? 'Disconnected from the room.' });
  });
  r.onError((_code: number, message?: string) => useRoom.getState().set({ error: message ?? 'Connection error' }));

  if (pingTimer) clearInterval(pingTimer);
  pingTimer = setInterval(() => {
    if (room !== r) return;
    r.ping((ms: number) => {
      rtt = rtt * 0.7 + ms * 0.3;
      useRoom.getState().set({ ping: Math.round(rtt) });
    });
  }, 2000);
  scheduleSnapshot(true);
}

async function connect(fn: (c: Client, token: string) => Promise<Room>) {
  const token = useSession.getState().token;
  if (!token) throw new Error('Not signed in yet.');
  if (room) await leaveRoom();
  useRoom.getState().set({ connection: 'connecting', error: null });
  try {
    const r = await fn(getClient(), token);
    attach(r);
    return r;
  } catch (e) {
    const msg = friendly(e);
    useRoom.getState().set({ connection: 'error', error: msg });
    throw new Error(msg, { cause: e });
  }
}

export const createRoom = (isPublic = false) =>
  connect((c, token) => c.create('shadow_hunt', { token, mode: isPublic ? 'quick' : 'private', isPublic }));
export const joinRoom = (code: string) => connect((c, token) => c.joinById(code.toUpperCase(), { token }));
export const quickMatch = () => connect((c, token) => c.joinOrCreate('shadow_hunt', { token, mode: 'quick', isPublic: true }));

/** Re-attach after a page reload, if the server is still holding our seat. */
export async function tryResume(): Promise<boolean> {
  let saved: { token: string; at: number } | null;
  try {
    saved = JSON.parse(sessionStorage.getItem(RESUME_KEY) ?? 'null');
  } catch {
    saved = null;
  }
  if (!saved || Date.now() - saved.at > 1000 * 60 * 30) return false;
  try {
    useRoom.getState().set({ connection: 'connecting' });
    const r = await getClient().reconnect(saved.token);
    attach(r);
    return true;
  } catch {
    sessionStorage.removeItem(RESUME_KEY);
    useRoom.getState().set({ connection: 'idle' });
    return false;
  }
}

export async function leaveRoom() {
  const r = room;
  room = null;
  clearSamples();
  try {
    sessionStorage.removeItem(RESUME_KEY);
  } catch {
    /* ignore */
  }
  useRoom.getState().reset();
  if (r) await r.leave(true).catch(() => {});
}

export function send<K extends keyof ClientMessages>(type: K, payload: ClientMessages[K]) {
  room?.send(C2S[type], payload);
}
