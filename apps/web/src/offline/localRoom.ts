/**
 * Offline (artifact) build: runs the real authoritative server simulation in the page.
 *
 * `Game`, `BotController`, the schema and `finalizeMatch` are imported straight from
 * apps/server; Vite swaps the server's store, logger and node:crypto for browser shims
 * (see vite.config.ts). This class mirrors the solo-relevant parts of ShadowHuntRoom and
 * exposes the subset of the Colyseus client `Room` API that net.ts and the game use.
 */
import {
  C2S,
  CHARACTERS,
  HUNTER_IDS,
  MATCH,
  NET,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  S2C,
  TITLES,
  getSkin,
  isCharacterId,
  isCharacterUnlocked,
  isHunterId,
  isMapId,
  isSkinUnlocked,
  isSurvivorId,
  type CharacterId,
  type ChatMsg,
  type HunterId,
  type InteractKind,
  type MapId,
  type Profile,
} from '@shadow-hunt/shared';
import { Game } from '../../../server/src/game/Game.ts';
import { finalizeMatch } from '../../../server/src/game/results.ts';
import { GameState, PlayerState } from '../../../server/src/rooms/schema.ts';
import { getStore } from './localStore';

type Handler = (msg: any) => void;
const SID = 'local';
const titleName = (id: string) => TITLES.find((t) => t.id === id)?.name ?? '';

export class LocalRoom {
  readonly sessionId = SID;
  readonly roomId: string;
  readonly reconnectionToken = '';
  readonly reconnection = { maxRetries: 0 };
  readonly state = new GameState();

  private game: Game | null = null;
  private profile: Profile;
  private handlers = new Map<string, Handler[]>();
  private stateCbs: ((s: GameState) => void)[] = [];
  private leaveCbs: ((code: number) => void)[] = [];
  private tickTimer: ReturnType<typeof setInterval>;
  private patchTimer: ReturnType<typeof setInterval>;
  private last = performance.now();
  private botSeq = 0;
  private closed = false;

  constructor(profile: Profile) {
    this.profile = profile;
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
    this.roomId = code;
    const s = this.state;
    s.roomCode = code;
    s.isPublic = false;
    s.matchMinutes = MATCH.defaultMinutes;
    s.hunterMode = 'bot';

    const p = new PlayerState();
    p.sessionId = SID;
    p.playerId = profile.id;
    p.name = profile.username;
    p.title = titleName(profile.title);
    p.avatar = profile.avatar;
    p.level = profile.level;
    p.survivorChar = 'alex';
    p.hunterChar = 'wraith';
    p.characterId = 'alex';
    p.skinId = getSkin('alex', profile.equippedSkins.alex).id;
    p.connected = true;
    p.isHost = true;
    p.ready = true;
    s.hostId = SID;
    s.players.set(SID, p);

    // The renderer shares this thread, so timers fire late on slow devices: step the
    // simulation in fixed slices until it has caught up with real time.
    this.tickTimer = setInterval(() => {
      const now = performance.now();
      let behind = Math.min((now - this.last) / 1000, 0.5);
      this.last = now;
      const step = NET.tickMs / 1000;
      while (behind > 1e-4) {
        const dt = Math.min(step, behind);
        this.game?.update(dt);
        behind -= dt;
      }
    }, NET.tickMs);
    this.patchTimer = setInterval(() => this.emitState(), NET.patchMs);
    queueMicrotask(() =>
      this.deliver(S2C.chat, { from: '', name: '', text: 'Solo room. The bot hunter is waiting in the dark.' }),
    );
  }

  // ---------------------------------------------------------------- client Room API
  onStateChange(cb: (s: GameState) => void) {
    this.stateCbs.push(cb);
  }
  onMessage(type: string, cb: Handler) {
    const list = this.handlers.get(type) ?? [];
    list.push(cb);
    this.handlers.set(type, list);
  }
  onLeave(cb: (code: number) => void) {
    this.leaveCbs.push(cb);
  }
  onDrop(_cb: () => void) {}
  onReconnect(_cb: () => void) {}
  onError(_cb: (code: number, message?: string) => void) {}
  ping(cb: (ms: number) => void) {
    cb(0);
  }
  async leave(_consented = true) {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.tickTimer);
    clearInterval(this.patchTimer);
    for (const cb of this.leaveCbs) cb(4000);
  }
  send(type: string, msg: any) {
    if (this.closed) return;
    this.receive(type, msg ?? {});
  }

  // ---------------------------------------------------------------- internals
  private emitState() {
    for (const cb of this.stateCbs) cb(this.state);
  }
  private deliver(type: string, msg: unknown) {
    for (const cb of this.handlers.get(type) ?? []) cb(msg);
  }
  private notice(text: string) {
    this.deliver(S2C.notice, { text });
  }
  private me() {
    return this.state.players.get(SID);
  }
  private inLobby() {
    return this.state.phase === 'lobby' || this.state.phase === 'results';
  }

  private receive(type: string, msg: any) {
    const s = this.state;
    const p = this.me();
    const g = this.game;
    switch (type) {
      case C2S.setCharacter: {
        const id = msg.characterId;
        if (!p || !this.inLobby() || typeof id !== 'string' || !isCharacterId(id)) return;
        if (!isCharacterUnlocked(id, this.profile.level)) {
          this.notice(`${CHARACTERS[id].name} unlocks at level ${CHARACTERS[id].unlockLevel}.`);
          return;
        }
        if (isSurvivorId(id)) p.survivorChar = id;
        if (isHunterId(id)) p.hunterChar = id;
        p.characterId = id;
        p.skinId = getSkin(id, this.profile.equippedSkins[id]).id;
        return;
      }
      case C2S.setSkin: {
        if (!p || !this.inLobby() || typeof msg.characterId !== 'string' || typeof msg.skinId !== 'string') return;
        if (!isCharacterId(msg.characterId) || !isSkinUnlocked(msg.characterId, msg.skinId, this.profile.level)) return;
        this.profile.equippedSkins[msg.characterId as CharacterId] = msg.skinId;
        if (p.characterId === msg.characterId) p.skinId = msg.skinId;
        return;
      }
      case C2S.setMap:
        if (this.inLobby() && typeof msg.mapId === 'string' && isMapId(msg.mapId)) s.mapId = msg.mapId;
        return;
      case C2S.setSettings:
        if (!this.inLobby()) return;
        if (typeof msg.matchMinutes === 'number' && MATCH.minuteOptions.includes(msg.matchMinutes))
          s.matchMinutes = msg.matchMinutes;
        if (typeof msg.generatorsRequired === 'number' && msg.generatorsRequired >= 0 && msg.generatorsRequired <= 7)
          s.generatorsSetting = Math.floor(msg.generatorsRequired);
        if (msg.hunterMode === 'player') this.notice('Playing as the Hunter needs survivors, so it is online only.');
        return;
      case C2S.startMatch:
        this.startMatch();
        return;
      case C2S.returnToLobby:
        if (s.phase === 'results') this.resetToLobby();
        return;
      case C2S.chat: {
        const text =
          typeof msg.text === 'string'
            ? msg.text
                .replace(/\p{Cc}/gu, '')
                .trim()
                .slice(0, 140)
            : '';
        if (p && text) this.deliver(S2C.chat, { from: SID, name: p.name, text } satisfies ChatMsg);
        return;
      }
      case C2S.input:
        g?.queueInputs(SID, msg.inputs);
        return;
      case C2S.interact:
        if (typeof msg.kind === 'string' && typeof msg.id === 'string') g?.requestInteract(SID, msg.kind as InteractKind, msg.id);
        return;
      case C2S.interactStop:
        g?.stopInteract(SID);
        return;
      case C2S.attack:
        g?.attack(SID, Number(msg.viewDelayMs) || 0);
        return;
      case C2S.ability:
        g?.useAbility(SID);
        return;
      case C2S.roar:
        g?.roar(SID);
        return;
      case C2S.flashlight:
        g?.setFlashlight(SID, msg.on === true);
        return;
      case C2S.useItem:
        g?.useItem(SID);
        return;
      case C2S.skillCheck:
        if (typeof msg.id === 'number') g?.answerSkillCheck(SID, msg.id, Number(msg.ratio));
        return;
      default:
        return; // setReady, setPreferHunter, kick: nothing to do alone
    }
  }

  private startMatch() {
    const s = this.state;
    if (!this.inLobby()) return;
    if (s.phase === 'results') this.resetToLobby();
    const p = this.me();
    if (!p) return;
    if (!isCharacterUnlocked(p.survivorChar as CharacterId, this.profile.level)) p.survivorChar = 'alex';

    const bot = new PlayerState();
    const hc: HunterId = HUNTER_IDS[Math.floor(Math.random() * HUNTER_IDS.length)]!;
    bot.sessionId = `bot-${++this.botSeq}`;
    bot.playerId = '';
    bot.name = CHARACTERS[hc].name;
    bot.isBot = true;
    bot.hunterChar = hc;
    bot.characterId = hc;
    bot.level = 1;
    bot.connected = true;
    bot.ready = true;

    this.game = new Game(
      {
        send: (sid, type, msg) => sid === SID && this.deliver(type, msg),
        broadcast: (type, msg) => this.deliver(type, msg),
      },
      s,
      s.mapId as MapId,
    );
    this.game.onEnd = (winner) => void this.onMatchEnd(winner);
    this.game.setup(null, bot);
    p.skinId = getSkin(p.characterId as CharacterId, this.profile.equippedSkins[p.characterId as CharacterId]).id;
    s.countdown = MATCH.countdownSeconds;
    s.phase = 'countdown';
    this.emitState();
  }

  private async onMatchEnd(winner: 'survivors' | 'hunter') {
    const s = this.state;
    const game = this.game;
    if (!game) return;
    s.phase = 'results';
    try {
      const results = await finalizeMatch(game as any, winner, new Map([[SID, this.profile.id]]));
      this.profile = (await getStore().getProfile(this.profile.id)) ?? this.profile;
      if (s.matchId !== results.matchId) return;
      s.resultsJson = JSON.stringify(results);
      this.deliver(S2C.results, results);
    } catch (e) {
      console.error('[shadow-hunt] could not finish the match', e);
    }
    this.emitState();
  }

  private resetToLobby() {
    const s = this.state;
    this.game = null;
    for (const [sid, p] of [...s.players.entries()]) {
      if (p.isBot) {
        s.players.delete(sid);
        continue;
      }
      p.role = 'survivor';
      p.condition = 'healthy';
      p.action = 'none';
      p.characterId = p.survivorChar;
      p.ready = true;
      p.locked = false;
      p.flashlight = false;
      p.level = this.profile.level;
    }
    s.phase = 'lobby';
    s.winner = '';
    s.resultsJson = '';
    s.generators.clear();
    s.exits.clear();
    s.keys.clear();
    s.doors.clear();
    s.pallets.clear();
    s.pickups.clear();
    s.cages.clear();
    this.emitState();
  }
}
