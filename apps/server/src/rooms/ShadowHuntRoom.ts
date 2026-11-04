import { randomInt } from 'node:crypto';
import { Room, ServerError, type Client } from 'colyseus';
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
  type ChatMsg,
  type CharacterId,
  type HunterId,
  type InteractKind,
  type MapId,
  type Profile,
} from '@shadow-hunt/shared';
import { verifyToken, type Identity } from '../auth/tokens.ts';
import { finalizeMatch } from '../game/results.ts';
import { Game } from '../game/Game.ts';
import { presence } from '../services/presence.ts';
import { getStore } from '../services/store.ts';
import { log } from '../utils/log.ts';
import { GameState, PlayerState } from './schema.ts';

interface AuthData {
  identity: Identity;
  profile: Profile;
}

function generateCode(): string {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) s += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return s;
}

const titleName = (id: string) => TITLES.find((t) => t.id === id)?.name ?? '';

export class ShadowHuntRoom extends Room<{ state: GameState }> {
  override maxClients = MATCH.maxPlayers;
  override maxMessagesPerSecond = NET.maxMessagesPerSecond;
  override state = new GameState();

  private game: Game | null = null;
  private profiles = new Map<string, Profile>();
  private playerIds = new Map<string, string>();
  private kicked = new Set<string>();
  private lastChat = new Map<string, number>();
  private botSeq = 0;

  override async onCreate(options: { mode?: 'quick' | 'private'; isPublic?: boolean } = {}) {
    let code = generateCode();
    while (!presence.claimCode(code)) code = generateCode();
    this.roomId = code;
    this.state.roomCode = code;
    this.state.isPublic = options.mode === 'quick' || options.isPublic === true;
    this.state.matchMinutes = MATCH.defaultMinutes;
    if (!this.state.isPublic) await this.setPrivate(true);
    this.setPatchRate(NET.patchMs);
    this.setSimulationInterval((dtMs) => this.tick(dtMs / 1000), NET.tickMs);
    this.registerHandlers();
    await this.updateMetadata();
    log.info('room created', { code, public: this.state.isPublic });
  }

  override async onAuth(_client: Client, options: { token?: string }): Promise<AuthData> {
    const identity = await verifyToken(options?.token);
    if (!identity) throw new ServerError(401, 'Please sign in or continue as a guest.');
    if (this.kicked.has(identity.playerId)) throw new ServerError(403, 'You were removed from this room.');
    for (const [sid, pid] of this.playerIds) {
      const p = this.state.players.get(sid);
      if (pid === identity.playerId && p?.connected) throw new ServerError(409, 'You are already in this room in another tab.');
    }
    if (this.state.phase !== 'lobby' && this.state.phase !== 'results') {
      throw new ServerError(423, 'A match is in progress in this room.');
    }
    const profile = await getStore().ensureProfile(identity);
    return { identity, profile };
  }

  override onJoin(client: Client, _options: unknown, auth: AuthData) {
    const prof = auth.profile;
    const p = new PlayerState();
    p.sessionId = client.sessionId;
    p.playerId = prof.id;
    p.name = prof.username;
    p.title = titleName(prof.title);
    p.avatar = prof.avatar;
    p.level = prof.level;
    p.survivorChar = 'alex';
    p.hunterChar = 'wraith';
    p.characterId = 'alex';
    p.skinId = getSkin('alex', prof.equippedSkins.alex).id;
    p.connected = true;
    const hasHost = [...this.state.players.values()].some((x) => x.isHost && x.connected);
    if (!hasHost) {
      for (const x of this.state.players.values()) x.isHost = false;
      p.isHost = true;
      p.ready = true;
      this.state.hostId = client.sessionId;
    }
    this.state.players.set(client.sessionId, p);
    this.profiles.set(client.sessionId, prof);
    this.playerIds.set(client.sessionId, prof.id);
    presence.join(prof.id, this.state.roomCode, true);
    this.chatSystem(`${p.name} joined.`);
    void this.updateMetadata();
  }

  override onDrop(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    p.connected = false;
    const seconds = this.state.phase === 'playing' || this.state.phase === 'countdown' ? NET.reconnectSeconds : NET.lobbyReconnectSeconds;
    this.allowReconnection(client, seconds);
    log.info('client dropped, awaiting reconnection', { session: client.sessionId, seconds });
  }

  override onReconnect(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (p) p.connected = true;
    log.info('client reconnected', { session: client.sessionId });
  }

  override onLeave(client: Client) {
    const sid = client.sessionId;
    const p = this.state.players.get(sid);
    const pid = this.playerIds.get(sid);
    if (pid) presence.leave(pid, this.state.roomCode);
    if (!p) return;
    p.connected = false;
    const inMatch = this.game && (this.state.phase === 'playing' || this.state.phase === 'countdown');
    if (inMatch) {
      this.game!.abandon(sid);
    } else {
      this.state.players.delete(sid);
      this.profiles.delete(sid);
      this.playerIds.delete(sid);
    }
    this.chatSystem(`${p.name} left.`);
    if (p.isHost) this.transferHost();
    void this.updateMetadata();
  }

  override onDispose() {
    presence.releaseCode(this.state.roomCode);
    log.info('room disposed', { code: this.state.roomCode });
  }

  // ------------------------------------------------------------------ internals
  private tick(dt: number) {
    if (this.game) this.game.update(Math.min(dt, 0.1));
  }

  private host(): PlayerState | undefined {
    return this.state.players.get(this.state.hostId);
  }

  private isHost(client: Client) {
    return this.state.hostId === client.sessionId;
  }

  private transferHost() {
    const next = [...this.state.players.values()].find((x) => x.connected && !x.isBot);
    for (const x of this.state.players.values()) x.isHost = false;
    if (next) {
      next.isHost = true;
      next.ready = true;
      this.state.hostId = next.sessionId;
      this.chatSystem(`${next.name} is now the host.`);
    } else {
      this.state.hostId = '';
    }
  }

  private async updateMetadata() {
    const joinable = this.state.phase === 'lobby' || this.state.phase === 'results';
    presence.setJoinable(this.state.roomCode, joinable);
    await this.setMetadata({
      code: this.state.roomCode,
      mapId: this.state.mapId,
      phase: this.state.phase,
      host: this.host()?.name ?? '',
      mode: this.state.isPublic ? 'quick' : 'private',
    });
  }

  private chatSystem(text: string) {
    this.broadcast(S2C.chat, { from: '', name: '', text } satisfies ChatMsg);
  }

  private registerHandlers() {
    const inLobby = () => this.state.phase === 'lobby' || this.state.phase === 'results';
    const me = (c: Client) => this.state.players.get(c.sessionId);

    // ---- Lobby
    this.onMessage(C2S.setCharacter, (c, msg: { characterId?: string }) => {
      const p = me(c);
      const id = msg?.characterId;
      if (!p || !inLobby() || typeof id !== 'string' || !isCharacterId(id)) return;
      const prof = this.profiles.get(c.sessionId);
      if (!prof || !isCharacterUnlocked(id, prof.level)) {
        c.send(S2C.notice, { text: `${CHARACTERS[id].name} unlocks at level ${CHARACTERS[id].unlockLevel}.` });
        return;
      }
      if (isSurvivorId(id)) p.survivorChar = id;
      if (isHunterId(id)) p.hunterChar = id;
      p.characterId = id;
      p.skinId = getSkin(id, prof.equippedSkins[id]).id;
    });
    this.onMessage(C2S.setSkin, (c, msg: { characterId?: string; skinId?: string }) => {
      const p = me(c);
      const prof = this.profiles.get(c.sessionId);
      if (!p || !prof || !inLobby() || typeof msg?.characterId !== 'string' || typeof msg?.skinId !== 'string') return;
      if (!isCharacterId(msg.characterId) || !isSkinUnlocked(msg.characterId, msg.skinId, prof.level)) return;
      prof.equippedSkins[msg.characterId] = msg.skinId;
      if (p.characterId === msg.characterId) p.skinId = msg.skinId;
    });
    this.onMessage(C2S.setReady, (c, msg: { ready?: boolean }) => {
      const p = me(c);
      if (p && inLobby()) p.ready = msg?.ready === true || p.isHost;
    });
    this.onMessage(C2S.setPreferHunter, (c, msg: { prefer?: boolean }) => {
      const p = me(c);
      if (p && inLobby()) p.preferHunter = msg?.prefer === true;
    });
    this.onMessage(C2S.setMap, (c, msg: { mapId?: string }) => {
      if (!this.isHost(c) || !inLobby() || typeof msg?.mapId !== 'string' || !isMapId(msg.mapId)) return;
      this.state.mapId = msg.mapId;
      void this.updateMetadata();
    });
    this.onMessage(C2S.setSettings, (c, msg: Record<string, unknown>) => {
      if (!this.isHost(c) || !inLobby() || !msg) return;
      if (typeof msg.matchMinutes === 'number' && MATCH.minuteOptions.includes(msg.matchMinutes)) {
        this.state.matchMinutes = msg.matchMinutes;
      }
      if (typeof msg.generatorsRequired === 'number' && msg.generatorsRequired >= 0 && msg.generatorsRequired <= 7) {
        this.state.generatorsSetting = Math.floor(msg.generatorsRequired);
      }
      if (msg.hunterMode === 'player' || msg.hunterMode === 'bot') this.state.hunterMode = msg.hunterMode;
    });
    this.onMessage(C2S.kick, (c, msg: { sessionId?: string }) => {
      if (!this.isHost(c) || typeof msg?.sessionId !== 'string' || msg.sessionId === c.sessionId) return;
      const target = this.clients.find((x) => x.sessionId === msg.sessionId);
      const pid = this.playerIds.get(msg.sessionId);
      if (!target) return;
      if (pid) this.kicked.add(pid);
      target.send(S2C.kicked, { text: 'The host removed you from the room.' });
      target.leave(4100);
    });
    this.onMessage(C2S.startMatch, (c) => this.startMatch(c));
    this.onMessage(C2S.returnToLobby, (c) => {
      if (!this.isHost(c) || this.state.phase !== 'results') return;
      this.resetToLobby();
    });
    this.onMessage(C2S.chat, (c, msg: { text?: string }) => {
      const p = me(c);
      if (!p || typeof msg?.text !== 'string') return;
      const now = Date.now();
      if (now - (this.lastChat.get(c.sessionId) ?? 0) < 600) return;
      this.lastChat.set(c.sessionId, now);
      const text = msg.text.replace(/\p{Cc}/gu, '').trim().slice(0, 140);
      if (!text) return;
      this.broadcast(S2C.chat, { from: c.sessionId, name: p.name, text } satisfies ChatMsg);
    });

    // ---- Gameplay (all validated inside Game)
    this.onMessage(C2S.input, (c, msg: { inputs?: unknown }) => this.game?.queueInputs(c.sessionId, msg?.inputs));
    this.onMessage(C2S.interact, (c, msg: { kind?: string; id?: string }) => {
      if (typeof msg?.kind === 'string' && typeof msg?.id === 'string') this.game?.requestInteract(c.sessionId, msg.kind as InteractKind, msg.id);
    });
    this.onMessage(C2S.interactStop, (c) => this.game?.stopInteract(c.sessionId));
    this.onMessage(C2S.attack, (c, msg: { viewDelayMs?: number }) => this.game?.attack(c.sessionId, Number(msg?.viewDelayMs) || 0));
    this.onMessage(C2S.ability, (c) => this.game?.useAbility(c.sessionId));
    this.onMessage(C2S.roar, (c) => this.game?.roar(c.sessionId));
    this.onMessage(C2S.flashlight, (c, msg: { on?: boolean }) => this.game?.setFlashlight(c.sessionId, msg?.on === true));
    this.onMessage(C2S.useItem, (c) => this.game?.useItem(c.sessionId));
    this.onMessage(C2S.skillCheck, (c, msg: { id?: number; ratio?: number }) => {
      if (typeof msg?.id === 'number') this.game?.answerSkillCheck(c.sessionId, msg.id, Number(msg.ratio));
    });
    this.onMessage('*', (c, type) => log.debug('unknown message', { type: String(type), session: c.sessionId }));
  }

  private startMatch(c: Client) {
    const s = this.state;
    if (!this.isHost(c) || (s.phase !== 'lobby' && s.phase !== 'results')) return;
    if (s.phase === 'results') this.resetToLobby(true);
    const humans = [...s.players.values()].filter((p) => !p.isBot && p.connected);
    const botMode = s.hunterMode === 'bot';
    const min = botMode ? 1 : MATCH.minPlayers;
    if (humans.length < min) {
      c.send(S2C.notice, { text: `Need at least ${min} players${botMode ? '' : ' (or enable the bot hunter)'}.` });
      return;
    }
    const notReady = humans.filter((p) => !p.ready && !p.isHost);
    if (notReady.length) {
      c.send(S2C.notice, { text: `Waiting for ${notReady.map((p) => p.name).join(', ')} to ready up.` });
      return;
    }
    // Validate character unlocks once more (levels may have changed).
    for (const p of humans) {
      const prof = this.profiles.get(p.sessionId);
      const lvl = prof?.level ?? 1;
      if (!isCharacterUnlocked(p.survivorChar as CharacterId, lvl)) p.survivorChar = 'alex';
      if (!isCharacterUnlocked(p.hunterChar as CharacterId, lvl)) p.hunterChar = 'wraith';
    }

    let hunterId: string | null = null;
    let bot: PlayerState | null = null;
    if (botMode) {
      bot = new PlayerState();
      const hc: HunterId = HUNTER_IDS[randomInt(HUNTER_IDS.length)]!;
      bot.sessionId = `bot-${++this.botSeq}`;
      bot.playerId = '';
      bot.name = CHARACTERS[hc].name;
      bot.isBot = true;
      bot.hunterChar = hc;
      bot.characterId = hc;
      bot.level = 1;
      bot.connected = true;
      bot.ready = true;
    } else {
      const prefer = humans.filter((p) => p.preferHunter);
      const pool = prefer.length ? prefer : humans;
      hunterId = pool[randomInt(pool.length)]!.sessionId;
    }

    this.game = new Game(
      {
        send: (sid, type, msg) => this.clients.find((x) => x.sessionId === sid)?.send(type, msg),
        broadcast: (type, msg) => this.broadcast(type, msg),
      },
      s,
      s.mapId as MapId,
    );
    this.game.onEnd = (winner) => void this.onMatchEnd(winner);
    this.game.setup(hunterId, bot);
    for (const p of s.players.values()) {
      const prof = this.profiles.get(p.sessionId);
      if (prof) p.skinId = getSkin(p.characterId as CharacterId, prof.equippedSkins[p.characterId as CharacterId]).id;
    }
    s.countdown = MATCH.countdownSeconds;
    s.phase = 'countdown';
    void this.lock();
    void this.updateMetadata();
    const hunter = [...s.players.values()].find((p) => p.role === 'hunter');
    log.info('match started', { code: s.roomCode, map: s.mapId, players: humans.length, hunter: hunter?.name });
  }

  private async onMatchEnd(winner: 'survivors' | 'hunter') {
    const s = this.state;
    const game = this.game;
    if (!game) return;
    s.phase = 'results';
    void this.updateMetadata();
    try {
      const results = await finalizeMatch(game, winner, this.playerIds);
      // Refresh cached profiles so the next lobby uses new levels/unlocks.
      for (const [sid, pid] of this.playerIds) {
        const prof = await getStore().getProfile(pid);
        if (prof) this.profiles.set(sid, prof);
      }
      if (this.state.matchId !== results.matchId) return; // a rematch already started
      s.resultsJson = JSON.stringify(results);
      this.broadcast(S2C.results, results);
      log.info('match ended', { code: s.roomCode, winner, persisted: results.persisted });
    } catch (e) {
      log.error('failed to finalize match', { error: String(e) });
    }
  }

  private resetToLobby(keepReady = false) {
    const s = this.state;
    this.game = null;
    for (const [sid, p] of [...s.players.entries()]) {
      const connected = this.clients.some((c) => c.sessionId === sid);
      if (p.isBot || !connected) {
        s.players.delete(sid);
        this.profiles.delete(sid);
        this.playerIds.delete(sid);
        continue;
      }
      p.role = 'survivor';
      p.condition = 'healthy';
      p.action = 'none';
      p.characterId = p.survivorChar;
      p.ready = keepReady || p.isHost;
      p.locked = false;
      p.flashlight = false;
      p.level = this.profiles.get(sid)?.level ?? p.level;
    }
    if (!s.players.get(s.hostId)) this.transferHost();
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
    void this.unlock();
    void this.updateMetadata();
  }
}
