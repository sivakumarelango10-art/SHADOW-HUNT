import { randomUUID } from 'node:crypto';
import {
  ABILITIES,
  FLASHLIGHT,
  HUNTER,
  ITEMS,
  MAPS,
  NET,
  NOISE,
  OBJECTIVES,
  PERKS,
  PLAYER,
  S2C,
  angleDiff,
  buildDynamicBlockers,
  buildStaticWorld,
  canTransition,
  clampInput,
  forwardVector,
  getInteractions,
  hasLineOfSight,
  healthFor,
  isAliveInMatch,
  isFree,
  isStanding,
  radiusFor,
  resolveCircle,
  stepMovement,
  yawTowards,
  type Condition,
  type DynamicBlockers,
  type FeedMsg,
  type FxMsg,
  type InteractKind,
  type InteractWorld,
  type MapDef,
  type MapId,
  type MoveInput,
  type NoiseMsg,
  type StaticWorld,
} from '@shadow-hunt/shared';
import { log } from '../utils/log.ts';
import { ExitState, GeneratorState, KeyState, DoorState, type GameState, type PlayerState } from '../rooms/schema.ts';
import { newRuntime, type ActionKind, type Runtime } from './runtime.ts';
import { BotController } from './Bot.ts';

export interface RoomApi {
  send(sessionId: string, type: string, message: unknown): void;
  broadcast(type: string, message: unknown): void;
}

const worldCache = new Map<MapId, StaticWorld>();
export function staticWorldFor(mapId: MapId): StaticWorld {
  let w = worldCache.get(mapId);
  if (!w) worldCache.set(mapId, (w = buildStaticWorld(MAPS[mapId])));
  return w;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Authoritative match simulation. Owns every gameplay rule: movement validation,
 * combat, objectives, abilities and win conditions. Clients only send intents.
 */
export class Game {
  readonly map: MapDef;
  readonly world: StaticWorld;
  dyn: DynamicBlockers = { boxes: [] };
  private dynDirty = true;
  readonly rt = new Map<string, Runtime>();
  time = 0;
  ended = false;
  private skillSeq = 1;
  private lockerOccupants = new Map<string, string>();
  private interactWorld: InteractWorld;

  constructor(
    private room: RoomApi,
    public state: GameState,
    mapId: MapId,
  ) {
    this.map = MAPS[mapId];
    this.world = staticWorldFor(mapId);
    const s = this.state;
    this.interactWorld = {
      map: this.map,
      get powerOn() {
        return s.powerOn;
      },
      get keysDeposited() {
        return s.keysDeposited;
      },
      get keysRequired() {
        return s.keysRequired;
      },
      generator: (id) => s.generators.get(id),
      exit: (id) => s.exits.get(id),
      keys: [],
      pallet: (id) => (s.pallets.get(id) as 'up' | 'down' | 'broken') ?? 'broken',
      door: (id) => s.doors.get(id),
      pickupTaken: (id) => s.pickups.get(id) === true,
      players: [],
      lockerOccupied: (id) => this.lockerOccupants.has(id),
    };
  }

  // ------------------------------------------------------------------ setup
  setup(hunterSessionId: string | null, botHunter: PlayerState | null): void {
    const s = this.state;
    const map = this.map;
    s.generators.clear();
    s.exits.clear();
    s.keys.clear();
    s.doors.clear();
    s.pallets.clear();
    s.pickups.clear();
    s.cages.clear();
    this.lockerOccupants.clear();
    for (const g of map.generators) s.generators.set(g.id, new GeneratorState());
    for (const e of map.exits) s.exits.set(e.id, new ExitState());
    for (const d of map.doors) s.doors.set(d.id, new DoorState({ open: d.startsOpen && !d.locked, locked: d.locked }));
    for (const p of map.pallets) s.pallets.set(p.id, 'up');
    for (const p of map.pickups) s.pickups.set(p.id, false);
    for (const c of map.cages) s.cages.set(c.id, '');
    shuffle(map.keySpawns)
      .slice(0, map.keysSpawned)
      .forEach((k, i) => s.keys.set(`key${i}`, new KeyState({ x: k.x, z: k.z })));

    if (botHunter) s.players.set(botHunter.sessionId, botHunter);
    const survivors = [...s.players.values()].filter((p) => p.sessionId !== (botHunter?.sessionId ?? hunterSessionId));
    const spawns = shuffle(map.survivorSpawns);
    survivors.forEach((p, i) => {
      const sp = spawns[i % spawns.length]!;
      this.resetPlayer(p, 'survivor', sp.x, sp.z);
      p.characterId = p.survivorChar;
    });
    const hunter = botHunter ?? (hunterSessionId ? s.players.get(hunterSessionId) : undefined);
    if (hunter) {
      this.resetPlayer(hunter, 'hunter', map.hunterSpawn.x, map.hunterSpawn.z);
      hunter.characterId = hunter.hunterChar;
      hunter.yaw = yawTowards(hunter.x, hunter.z, 0, 0);
    }
    for (const p of s.players.values()) {
      const rt = newRuntime();
      if (p.isBot && p.role === 'hunter') rt.bot = new BotController(this, p.sessionId);
      this.rt.set(p.sessionId, rt);
    }

    const survivorCount = survivors.length;
    const req = s.generatorsSetting || Math.max(3, Math.min(map.generatorsRequired, survivorCount + 2));
    s.generatorsRequired = Math.min(req, map.generators.length);
    s.generatorsCompleted = 0;
    s.keysRequired = map.keysRequired;
    s.keysDeposited = 0;
    s.exitsOpen = 0;
    s.powerOn = false;
    s.timeLeft = s.matchMinutes * 60;
    s.elapsed = 0;
    s.winner = '';
    s.resultsJson = '';
    s.matchId = randomUUID();
    this.dynDirty = true;
  }

  private resetPlayer(p: PlayerState, role: 'survivor' | 'hunter', x: number, z: number) {
    p.role = role;
    p.x = x;
    p.z = z;
    p.yaw = role === 'survivor' ? yawTowards(x, z, 0, 0) : 0;
    p.pitch = 0;
    p.lastSeq = 0;
    p.condition = 'healthy';
    p.health = 2;
    p.stamina = PLAYER.staminaMax;
    p.staminaDelay = 0;
    p.exhausted = false;
    p.crouching = false;
    p.sprinting = false;
    p.speedMul = 1;
    p.locked = false;
    p.flashlight = false;
    p.battery = FLASHLIGHT.max;
    p.action = 'none';
    p.actionTarget = '';
    p.actionProgress = 0;
    p.hiddenIn = '';
    p.carryingKey = false;
    p.item = '';
    p.cageId = '';
    p.captureStage = 0;
    p.captureTimer = 0;
    p.bleedTimer = 0;
    p.abilityCd = 0;
    p.roarCd = role === 'hunter' ? 10 : 0;
    p.attackCd = 0;
    p.attackSeq = 0;
    p.hitSeq = 0;
  }

  // ------------------------------------------------------------------ helpers
  private players(): PlayerState[] {
    return [...this.state.players.values()];
  }
  hunter(): PlayerState | undefined {
    return this.players().find((p) => p.role === 'hunter');
  }
  survivors(): PlayerState[] {
    return this.players().filter((p) => p.role === 'survivor');
  }
  runtime(id: string): Runtime | undefined {
    return this.rt.get(id);
  }
  private fx(msg: FxMsg) {
    this.room.broadcast(S2C.fx, msg);
  }
  private feed(text: string, tone: FeedMsg['tone'] = 'info') {
    this.room.broadcast(S2C.feed, { text, tone } satisfies FeedMsg);
  }
  private notice(id: string, text: string) {
    this.room.send(id, S2C.notice, { text });
  }

  /** Noise is only sent to the hunter, jittered, and only if within earshot. */
  noise(x: number, z: number, kind: NoiseMsg['kind'], radius: number) {
    const h = this.hunter();
    if (!h) return;
    if (Math.hypot(h.x - x, h.z - z) > radius) return;
    const j = NOISE.jitter;
    const msg: NoiseMsg = { x: x + (Math.random() - 0.5) * j * 2, z: z + (Math.random() - 0.5) * j * 2, kind };
    const rt = this.rt.get(h.sessionId);
    rt?.bot?.hear(msg.x, msg.z, kind);
    if (!h.isBot) this.room.send(h.sessionId, S2C.noise, msg);
  }

  private track(x: number, z: number, kind: 'scratch' | 'blood') {
    const h = this.hunter();
    if (!h || h.isBot || Math.hypot(h.x - x, h.z - z) > 40) return;
    this.room.send(h.sessionId, S2C.track, { x, z, kind });
  }

  refreshDynamic() {
    if (!this.dynDirty) return;
    const s = this.state;
    this.dyn = buildDynamicBlockers(this.map, {
      doorOpen: (id) => s.doors.get(id)?.open ?? true,
      palletDown: (id) => s.pallets.get(id) === 'down',
      exitOpen: (id) => s.exits.get(id)?.open ?? false,
    });
    this.dynDirty = false;
  }

  private interact(): InteractWorld {
    const w = this.interactWorld;
    w.keys = [...this.state.keys.entries()].map(([id, k]) => ({
      id,
      x: k.x,
      z: k.z,
      carriedBy: k.carriedBy,
      deposited: k.deposited,
    }));
    w.players = this.players().map((p) => ({
      id: p.sessionId,
      role: p.role as 'survivor' | 'hunter',
      characterId: p.characterId as never,
      condition: p.condition as Condition,
      x: p.x,
      z: p.z,
      yaw: p.yaw,
      hiddenIn: p.hiddenIn,
      carryingKey: p.carryingKey,
      item: p.item,
      cageId: p.cageId,
      busy: p.action !== 'none',
    }));
    return w;
  }

  private viewOf(p: PlayerState) {
    return this.interactWorld.players.find((x) => x.id === p.sessionId)!;
  }

  private setCondition(p: PlayerState, to: Condition, force = false): boolean {
    const from = p.condition as Condition;
    if (from === to) return true;
    if (!force && !canTransition(from, to)) {
      log.warn('rejected condition transition', { from, to, player: p.sessionId });
      return false;
    }
    p.condition = to;
    p.health = healthFor(to);
    return true;
  }

  // ------------------------------------------------------------------ inputs
  queueInputs(sessionId: string, inputs: unknown) {
    const rt = this.rt.get(sessionId);
    const p = this.state.players.get(sessionId);
    if (!rt || !p || !Array.isArray(inputs)) return;
    for (const raw of inputs.slice(0, NET.maxInputsPerBatch)) {
      if (!raw || typeof raw !== 'object') continue;
      const inp = clampInput(raw as MoveInput);
      if (inp.seq <= p.lastSeq) continue;
      rt.inputs.push(inp);
    }
    if (rt.inputs.length > 60) rt.inputs.splice(0, rt.inputs.length - 60);
  }

  private isLocked(p: PlayerState, rt: Runtime): boolean {
    if (this.state.phase !== 'playing') return true;
    if (!isAliveInMatch(p.condition as Condition)) return true;
    if (p.condition === 'captured') return true;
    if (p.hiddenIn) return true;
    if (rt.chargeUntil > this.time) return true;
    if (rt.stunUntil > this.time) return true;
    if (rt.action && rt.action.kind !== 'pallet') return true;
    return false;
  }

  private speedMulFor(p: PlayerState, rt: Runtime): number {
    let m = 1;
    if (p.role === 'survivor') {
      if (rt.boostUntil > this.time) m *= PLAYER.hitSpeedBoost;
    } else {
      if (rt.slowUntil > this.time) m *= HUNTER.postHitSlowMul;
      if (p.isBot) m *= 0.94;
    }
    return m;
  }

  private applyInputs(p: PlayerState, rt: Runtime, dt: number) {
    rt.budget = Math.min(NET.maxTimeBudget, rt.budget + dt);
    if (!p.connected && !p.isBot) rt.inputs.length = 0;
    const params = {
      role: p.role as 'survivor' | 'hunter',
      condition: p.condition as Condition,
      characterId: p.characterId as never,
      speedMul: p.speedMul,
      locked: this.isLocked(p, rt),
    };
    p.locked = params.locked;
    let moved = 0;
    for (const inp of rt.inputs) {
      if (inp.dt > rt.budget + 1e-4) {
        // Client is sending more simulated time than real time has passed.
        rt.violations++;
        p.lastSeq = inp.seq;
        continue;
      }
      rt.budget -= inp.dt;
      // Moving cancels hold interactions (except continuous repair which the client stops explicitly).
      if (rt.action && Math.hypot(inp.mx, inp.mz) > 0.3 && this.isCancellable(rt.action.kind)) {
        this.cancelAction(p, rt);
        params.locked = this.isLocked(p, rt);
      }
      const r = stepMovement(this.world, this.dyn, p, inp, params);
      moved += r.distance;
      p.lastSeq = inp.seq;
      if (p.sprinting) rt.stats.sprintSeconds += inp.dt;
    }
    rt.inputs.length = 0;
    if (rt.violations > 300) {
      log.warn('excessive input timing violations', { player: p.sessionId });
      rt.violations = 0;
    }
    if (moved > 0.01) {
      rt.lastMoveAt = this.time;
      rt.movedRecently = this.time;
    }
    if (p.role === 'survivor' && moved > 0.01 && isStanding(p.condition as Condition)) {
      if (p.sprinting && this.time >= rt.nextStepNoise) {
        rt.nextStepNoise = this.time + NOISE.sprintInterval;
        this.noise(p.x, p.z, 'sprint', NOISE.sprintRadius);
      } else if (!p.crouching && !p.sprinting && this.time >= rt.nextStepNoise) {
        rt.nextStepNoise = this.time + 0.7;
        this.noise(p.x, p.z, 'step', NOISE.walkRadius);
      }
      if (this.time >= rt.nextTrack) {
        if (p.sprinting) {
          rt.nextTrack = this.time + 0.35;
          this.track(p.x, p.z, 'scratch');
        } else if (p.condition === 'injured') {
          rt.nextTrack = this.time + 0.9;
          this.track(p.x, p.z, 'blood');
        }
      }
    }
  }

  private isCancellable(kind: ActionKind) {
    return kind !== 'stunned' && kind !== 'charging' && kind !== 'shadowstep' && kind !== 'capture';
  }

  // ------------------------------------------------------------------ tick
  update(dt: number) {
    if (this.ended) return;
    const s = this.state;
    this.time += dt;
    this.refreshDynamic();

    if (s.phase === 'countdown') {
      s.countdown = Math.max(0, s.countdown - dt);
      for (const p of this.players()) this.rt.get(p.sessionId)!.inputs.length = 0;
      if (s.countdown <= 0) {
        s.phase = 'playing';
        this.feed('The hunt has begun.', 'danger');
      }
      return;
    }
    if (s.phase !== 'playing') return;

    s.elapsed += dt;
    s.timeLeft = Math.max(0, s.timeLeft - dt);
    this.interact();

    for (const p of this.players()) {
      const rt = this.rt.get(p.sessionId)!;
      p.speedMul = this.speedMulFor(p, rt);
      if (rt.bot) rt.bot.update(dt);
      if (rt.chargeUntil > this.time) this.tickCharge(p, rt, dt);
      else this.applyInputs(p, rt, dt);
      rt.history.push({ t: this.time, x: p.x, z: p.z });
      if (rt.history.length > 45) rt.history.shift();
      this.tickTimers(p, rt, dt);
      this.tickAction(p, rt, dt);
    }
    this.tickGenerators(dt);
    this.checkEscapes();
    this.checkEnd();
  }

  private tickTimers(p: PlayerState, rt: Runtime, dt: number) {
    const t = this.time;
    if (p.role === 'hunter') {
      p.attackCd = Math.max(0, p.attackCd - dt);
      p.abilityCd = Math.max(0, p.abilityCd - dt);
      p.roarCd = Math.max(0, p.roarCd - dt);
      if (rt.stunUntil > t) {
        p.action = rt.blindUntil > t ? 'blinded' : 'stunned';
      } else if (p.action === 'stunned') {
        p.action = 'none';
      }
      if (rt.blindUntil <= t && p.action === 'blinded') p.action = 'none';
      if (rt.echoUntil > t && t >= rt.nextEchoPulse) {
        rt.nextEchoPulse = t + 0.5;
        this.echoPulse(p);
      }
      return;
    }
    // Flashlight battery
    if (p.flashlight) {
      const mul = p.characterId === 'noah' ? PERKS.noah.batteryDrainMul : 1;
      p.battery = Math.max(0, p.battery - FLASHLIGHT.drainPerSecond * mul * dt);
      if (p.battery <= 0) p.flashlight = false;
    }
    switch (p.condition) {
      case 'downed':
        p.bleedTimer = Math.max(0, p.bleedTimer - dt);
        if (p.bleedTimer <= 0) this.eliminate(p, 'bled out');
        break;
      case 'captured':
        p.captureTimer = Math.max(0, p.captureTimer - dt);
        if (p.captureTimer <= 0) this.eliminate(p, 'was taken');
        break;
      case 'rescued':
        if (rt.protectUntil <= t) this.setCondition(p, 'injured');
        break;
    }
    if (p.hiddenIn) {
      rt.stats.hideSeconds += dt;
      const hidden = t - rt.hideStart;
      if (hidden > OBJECTIVES.hideQuietSeconds && t >= rt.nextBreath) {
        rt.nextBreath = t + 2;
        this.noise(p.x, p.z, 'breath', NOISE.breathingRadius);
      }
      if (hidden > OBJECTIVES.hideMaxSeconds) {
        this.notice(p.sessionId, 'You cannot hold your breath any longer.');
        this.leaveLocker(p);
      }
    }
  }

  // ------------------------------------------------------------------ actions
  requestInteract(sessionId: string, kind: InteractKind, id: string) {
    const p = this.state.players.get(sessionId);
    const rt = this.rt.get(sessionId);
    if (!p || !rt || this.state.phase !== 'playing') return;
    if (typeof kind !== 'string' || typeof id !== 'string') return;
    if (rt.action || rt.stunUntil > this.time || rt.chargeUntil > this.time) return;
    this.interact();
    const opt = getInteractions(this.interactWorld, this.viewOf(p), 0.5).find((o) => o.kind === kind && o.id === id);
    if (!opt) return;
    if (opt.disabled) {
      this.notice(sessionId, opt.disabled);
      return;
    }
    rt.action = { kind, id, elapsed: 0, duration: opt.duration, continuous: opt.continuous };
    p.action = kind;
    p.actionTarget = id;
    p.actionProgress = 0;
    if (kind === 'repair') {
      rt.nextSkillAt = this.time + this.randomGap();
    }
    if (opt.duration === 0 && !opt.continuous) this.completeAction(p, rt);
  }

  stopInteract(sessionId: string) {
    const p = this.state.players.get(sessionId);
    const rt = this.rt.get(sessionId);
    if (!p || !rt || !rt.action || !this.isCancellable(rt.action.kind)) return;
    this.cancelAction(p, rt);
  }

  private cancelAction(p: PlayerState, rt: Runtime) {
    rt.action = null;
    rt.skill = null;
    if (!p.hiddenIn) p.action = 'none';
    else p.action = 'hidden';
    p.actionTarget = '';
    p.actionProgress = 0;
  }

  private randomGap() {
    return OBJECTIVES.skillCheckMinGap + Math.random() * (OBJECTIVES.skillCheckMaxGap - OBJECTIVES.skillCheckMinGap);
  }

  private tickAction(p: PlayerState, rt: Runtime, dt: number) {
    const a = rt.action;
    if (!a) return;
    if (a.kind === 'stunned' || a.kind === 'charging') return;
    if (a.kind === 'shadowstep') {
      a.elapsed += dt;
      p.actionProgress = Math.min(1, a.elapsed / a.duration);
      if (a.elapsed >= a.duration) this.finishShadowStep(p, rt);
      return;
    }
    if (a.kind === 'selfheal') {
      if (p.condition !== 'injured') return this.cancelAction(p, rt);
      a.elapsed += dt;
      p.actionProgress = Math.min(1, a.elapsed / a.duration);
      if (a.elapsed >= a.duration) {
        this.setCondition(p, 'healthy');
        p.item = '';
        this.cancelAction(p, rt);
      }
      return;
    }
    // Re-validate every tick: target still valid and still in range.
    const opt = getInteractions(this.interactWorld, this.viewOf(p), 0.6).find((o) => o.kind === a.kind && o.id === a.id);
    if (!opt || opt.disabled) return this.cancelAction(p, rt);
    if (a.continuous) {
      // Generator repair: progress handled in tickGenerators; here we drive skill checks.
      this.tickSkillCheck(p, rt);
      return;
    }
    a.elapsed += dt;
    if (a.kind === 'openExit') {
      const ex = this.state.exits.get(a.id)!;
      ex.progress = Math.min(1, ex.progress + dt / a.duration);
      p.actionProgress = ex.progress;
      if (ex.progress >= 1) this.completeAction(p, rt);
      return;
    }
    p.actionProgress = Math.min(1, a.elapsed / Math.max(0.001, a.duration));
    if (a.elapsed >= a.duration) this.completeAction(p, rt);
  }

  private completeAction(p: PlayerState, rt: Runtime) {
    const a = rt.action!;
    const s = this.state;
    const map = this.map;
    rt.action = null;
    p.action = 'none';
    p.actionTarget = '';
    p.actionProgress = 0;
    switch (a.kind) {
      case 'pickupKey': {
        const k = s.keys.get(a.id);
        if (!k || k.carriedBy || k.deposited || p.carryingKey) return;
        k.carriedBy = p.sessionId;
        p.carryingKey = true;
        this.fx({ kind: 'key_pickup', x: k.x, z: k.z, by: p.sessionId });
        this.feed(`${p.name} found an access key.`, 'success');
        return;
      }
      case 'depositKey': {
        const key = [...s.keys.entries()].find(([, k]) => k.carriedBy === p.sessionId);
        if (!key) return;
        key[1].carriedBy = '';
        key[1].deposited = true;
        p.carryingKey = false;
        s.keysDeposited++;
        rt.stats.keysDeposited++;
        const ex = map.exits.find((e) => e.id === a.id)!;
        this.fx({ kind: 'key_deposit', x: ex.panel.x, z: ex.panel.z, by: p.sessionId });
        this.feed(`Access key inserted (${s.keysDeposited}/${s.keysRequired}).`, 'success');
        return;
      }
      case 'openExit': {
        const ex = s.exits.get(a.id)!;
        if (ex.open) return;
        ex.open = true;
        s.exitsOpen++;
        rt.stats.exitsOpened++;
        this.dynDirty = true;
        const def = map.exits.find((e) => e.id === a.id)!;
        this.fx({ kind: 'exit_open', x: def.gate.x, z: def.gate.z });
        this.feed(`${def.name} is OPEN. Run!`, 'success');
        return;
      }
      case 'hide': {
        if (this.lockerOccupants.has(a.id)) return this.notice(p.sessionId, 'Occupied');
        const l = map.lockers.find((x) => x.id === a.id)!;
        this.lockerOccupants.set(l.id, p.sessionId);
        p.hiddenIn = l.id;
        p.x = l.x;
        p.z = l.z;
        p.yaw = l.rot + Math.PI;
        p.flashlight = false;
        p.action = 'hidden';
        rt.hideStart = this.time;
        rt.nextBreath = this.time + OBJECTIVES.hideQuietSeconds;
        this.noise(l.x, l.z, 'locker', 9);
        this.fx({ kind: 'locker', x: l.x, z: l.z });
        return;
      }
      case 'unhide':
        return this.leaveLocker(p);
      case 'pallet':
        return this.dropPallet(p, rt, a.id);
      case 'door': {
        const d = s.doors.get(a.id);
        if (!d || d.locked) return;
        d.open = !d.open;
        this.dynDirty = true;
        const def = map.doors.find((x) => x.id === a.id)!;
        if (!d.open) this.ejectFromDoorway(def);
        this.fx({ kind: 'door', x: def.x, z: def.z, target: d.open ? 'open' : 'close' });
        if (p.role === 'survivor') this.noise(def.x, def.z, 'door', NOISE.doorRadius);
        return;
      }
      case 'hatch': {
        const h = map.hatches.find((x) => x.id === a.id)!;
        const dest = map.hatches.find((x) => x.id === h.to)!;
        const pos = this.freeSpotNear(dest.x, dest.z, radiusFor(p.role as 'survivor'));
        this.fx({ kind: 'hatch', x: h.x, z: h.z, x2: pos.x, z2: pos.z, by: p.sessionId });
        p.x = pos.x;
        p.z = pos.z;
        if (p.role === 'survivor') this.noise(h.x, h.z, 'door', NOISE.doorRadius);
        return;
      }
      case 'pickup': {
        if (s.pickups.get(a.id)) return;
        const def = map.pickups.find((x) => x.id === a.id)!;
        if (def.kind === 'battery') {
          p.battery = Math.min(FLASHLIGHT.max, p.battery + FLASHLIGHT.batteryPickupAmount);
        } else {
          if (p.item) return;
          p.item = def.kind;
        }
        s.pickups.set(a.id, true);
        return;
      }
      case 'rescue': {
        const t = s.players.get(a.id);
        if (!t || t.condition !== 'captured') return;
        if (!this.setCondition(t, 'rescued')) return;
        const trt = this.rt.get(t.sessionId)!;
        trt.protectUntil = this.time + PLAYER.rescuedProtectionSeconds;
        trt.boostUntil = this.time + PLAYER.hitSpeedBoostSeconds;
        s.cages.set(t.cageId, '');
        const cage = map.cages.find((c) => c.id === t.cageId);
        t.cageId = '';
        t.captureTimer = 0;
        if (cage) {
          const pos = this.freeSpotNear(cage.x + 1, cage.z, PLAYER.survivorRadius);
          t.x = pos.x;
          t.z = pos.z;
        }
        rt.stats.rescues++;
        this.fx({ kind: 'rescue', x: t.x, z: t.z, by: p.sessionId, target: t.sessionId });
        this.feed(`${p.name} rescued ${t.name}.`, 'success');
        return;
      }
      case 'revive': {
        const t = s.players.get(a.id);
        if (!t || t.condition !== 'downed') return;
        this.setCondition(t, 'injured');
        t.bleedTimer = 0;
        rt.stats.revives++;
        this.feed(`${p.name} helped ${t.name} up.`, 'success');
        return;
      }
      case 'heal': {
        const t = s.players.get(a.id);
        if (!t || t.condition !== 'injured') return;
        this.setCondition(t, 'healthy');
        rt.stats.heals++;
        return;
      }
      case 'capture':
        return this.capture(p, a.id);
      case 'break': {
        if (s.pallets.get(a.id) !== 'down') return;
        s.pallets.set(a.id, 'broken');
        this.dynDirty = true;
        const def = map.pallets.find((x) => x.id === a.id)!;
        this.fx({ kind: 'pallet_break', x: def.x, z: def.z });
        return;
      }
      case 'kick': {
        const g = s.generators.get(a.id);
        if (!g || g.completed) return;
        g.kicked = true;
        const def = map.generators.find((x) => x.id === a.id)!;
        this.fx({ kind: 'gen_kick', x: def.x, z: def.z });
        return;
      }
      case 'search': {
        const occupant = this.lockerOccupants.get(a.id);
        const l = map.lockers.find((x) => x.id === a.id)!;
        this.fx({ kind: 'locker', x: l.x, z: l.z });
        if (!occupant) return;
        const t = s.players.get(occupant);
        if (!t) return;
        this.leaveLocker(t);
        this.setCondition(t, 'downed', t.condition === 'healthy' || t.condition === 'injured' || t.condition === 'rescued');
        this.onDowned(t, p);
        this.feed(`${p.name} dragged ${t.name} out of hiding.`, 'danger');
        return;
      }
    }
  }

  private freeSpotNear(x: number, z: number, r: number): { x: number; z: number } {
    for (let ring = 0; ring < 6; ring++) {
      const rad = 0.9 + ring * 0.6;
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2;
        const px = x + Math.cos(ang) * rad;
        const pz = z + Math.sin(ang) * rad;
        if (isFree(this.world, this.dyn, px, pz, r)) return { x: px, z: pz };
      }
    }
    const p = { x, z };
    resolveCircle(this.world, this.dyn, p, r);
    return p;
  }

  private ejectFromDoorway(def: MapDef['doors'][number]) {
    this.refreshDynamicNow();
    for (const p of this.players()) {
      if (Math.hypot(p.x - def.x, p.z - def.z) < def.width) {
        const pos = { x: p.x, z: p.z };
        resolveCircle(this.world, this.dyn, pos, radiusFor(p.role as 'survivor'));
        p.x = pos.x;
        p.z = pos.z;
      }
    }
  }

  private refreshDynamicNow() {
    this.dynDirty = true;
    this.refreshDynamic();
  }

  private leaveLocker(p: PlayerState) {
    const l = this.map.lockers.find((x) => x.id === p.hiddenIn);
    if (l) {
      this.lockerOccupants.delete(l.id);
      const f = { x: Math.sin(l.rot), z: Math.cos(l.rot) };
      const pos = this.freeSpotNear(l.x + f.x * 0.85, l.z + f.z * 0.85, PLAYER.survivorRadius);
      p.x = pos.x;
      p.z = pos.z;
      this.noise(l.x, l.z, 'locker', 9);
      this.fx({ kind: 'locker', x: l.x, z: l.z });
    }
    p.hiddenIn = '';
    const rt = this.rt.get(p.sessionId);
    if (rt) rt.action = null;
    p.action = 'none';
  }

  private dropPallet(p: PlayerState, rt: Runtime, id: string) {
    const s = this.state;
    if (s.pallets.get(id) !== 'up') return;
    s.pallets.set(id, 'down');
    const def = this.map.pallets.find((x) => x.id === id)!;
    this.noise(def.x, def.z, 'pallet', NOISE.palletRadius);
    this.fx({ kind: 'pallet_drop', x: def.x, z: def.z, by: p.sessionId });
    const h = this.hunter();
    if (h) {
      const half = def.length / 2 + 0.4;
      const inZone =
        def.axis === 'x'
          ? Math.abs(h.x - def.x) < half && Math.abs(h.z - def.z) < 1.25
          : Math.abs(h.z - def.z) < half && Math.abs(h.x - def.x) < 1.25;
      if (inZone) {
        const hrt = this.rt.get(h.sessionId)!;
        this.stun(h, hrt, HUNTER.palletStunSeconds);
        rt.stats.palletsStunned++;
        this.fx({ kind: 'pallet_stun', x: h.x, z: h.z, target: h.sessionId });
        this.feed(`${p.name} stunned the hunter!`, 'success');
      }
    }
    this.refreshDynamicNow();
    // Push anyone standing where the pallet landed off to the nearest side.
    for (const o of this.players()) {
      const pos = { x: o.x, z: o.z };
      resolveCircle(this.world, this.dyn, pos, radiusFor(o.role as 'survivor'));
      o.x = pos.x;
      o.z = pos.z;
    }
  }

  private stun(h: PlayerState, rt: Runtime, seconds: number) {
    rt.stunUntil = Math.max(rt.stunUntil, this.time + seconds);
    rt.chargeUntil = 0;
    if (rt.action && rt.action.kind !== 'stunned') rt.action = null;
    h.action = 'stunned';
    h.actionTarget = '';
    h.actionProgress = 0;
  }

  // ------------------------------------------------------------------ combat
  attack(sessionId: string, viewDelayMs: number) {
    const h = this.state.players.get(sessionId);
    const rt = this.rt.get(sessionId);
    if (!h || !rt || h.role !== 'hunter' || this.state.phase !== 'playing') return;
    if (h.attackCd > 0 || rt.action || rt.stunUntil > this.time || rt.chargeUntil > this.time) return;
    h.attackCd = HUNTER.attackCooldownMiss;
    h.attackSeq = (h.attackSeq + 1) % 65535;
    this.fx({ kind: 'swing', x: h.x, z: h.z, by: h.sessionId });
    const delay = Math.max(0, Math.min(NET.maxRewindMs, Number(viewDelayMs) || 0)) / 1000;
    const target = this.findAttackTarget(h, delay, HUNTER.attackRange, HUNTER.attackConeDeg);
    if (target) this.hit(h, rt, target, false);
  }

  /** Lag compensation: test against where survivors were `delay` seconds ago. */
  private positionAt(id: string, delay: number): { x: number; z: number } {
    const rt = this.rt.get(id)!;
    const p = this.state.players.get(id)!;
    if (delay <= 0 || !rt.history.length) return { x: p.x, z: p.z };
    const t = this.time - delay;
    for (let i = rt.history.length - 1; i > 0; i--) {
      const a = rt.history[i - 1]!;
      const b = rt.history[i]!;
      if (a.t <= t && b.t >= t) {
        const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
        return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
      }
    }
    return { x: rt.history[0]!.x, z: rt.history[0]!.z };
  }

  findAttackTarget(h: PlayerState, delay: number, range: number, coneDeg: number): PlayerState | null {
    let best: PlayerState | null = null;
    let bestD = Infinity;
    for (const s of this.survivors()) {
      if (s.hiddenIn) continue;
      if (!(s.condition === 'healthy' || s.condition === 'injured')) continue;
      const pos = this.positionAt(s.sessionId, delay);
      const d = Math.hypot(pos.x - h.x, pos.z - h.z);
      if (d > range + PLAYER.survivorRadius) continue;
      const ang = Math.abs(angleDiff(yawTowards(h.x, h.z, pos.x, pos.z), h.yaw));
      if (d > 0.8 && ang > ((coneDeg / 2) * Math.PI) / 180) continue;
      if (!hasLineOfSight(this.world, this.dyn, h.x, h.z, pos.x, pos.z, { minHeight: 0.95 })) continue;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  private hit(h: PlayerState, hrt: Runtime, s: PlayerState, fromCharge: boolean) {
    const srt = this.rt.get(s.sessionId)!;
    if (srt.protectUntil > this.time) return;
    h.attackCd = HUNTER.attackCooldownHit;
    hrt.slowUntil = this.time + HUNTER.postHitSlowSeconds;
    hrt.stats.hits++;
    srt.stats.timesHit++;
    s.hitSeq = (s.hitSeq + 1) % 65535;
    if (srt.action) this.cancelAction(s, srt);
    if (s.condition === 'healthy') {
      this.setCondition(s, 'injured');
      srt.boostUntil = this.time + PLAYER.hitSpeedBoostSeconds;
      this.fx({ kind: 'hit', x: s.x, z: s.z, by: h.sessionId, target: s.sessionId });
    } else {
      this.setCondition(s, 'downed');
      this.onDowned(s, h);
    }
    if (fromCharge) hrt.chargeHit = true;
  }

  private onDowned(s: PlayerState, h: PlayerState) {
    const srt = this.rt.get(s.sessionId)!;
    const hrt = this.rt.get(h.sessionId);
    s.bleedTimer = PLAYER.bleedOutSeconds;
    s.flashlight = false;
    if (hrt) hrt.stats.downs++;
    if (s.carryingKey) {
      const key = [...this.state.keys.values()].find((k) => k.carriedBy === s.sessionId);
      if (key) {
        key.carriedBy = '';
        key.x = s.x;
        key.z = s.z;
      }
      s.carryingKey = false;
    }
    srt.action = null;
    s.action = 'none';
    this.fx({ kind: 'down', x: s.x, z: s.z, by: h.sessionId, target: s.sessionId });
    this.feed(`${s.name} is down!`, 'danger');
  }

  private capture(h: PlayerState, targetId: string) {
    const s = this.state.players.get(targetId);
    if (!s || s.condition !== 'downed') return;
    const hrt = this.rt.get(h.sessionId)!;
    s.captureStage++;
    if (s.captureStage >= 3) {
      hrt.stats.captures++;
      this.eliminate(s, 'was sacrificed', h);
      return;
    }
    const free = this.map.cages
      .filter((c) => !this.state.cages.get(c.id))
      .sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z));
    const cage = free[0];
    if (!cage) {
      hrt.stats.captures++;
      this.eliminate(s, 'was taken', h);
      return;
    }
    const from = { x: s.x, z: s.z };
    this.setCondition(s, 'captured');
    this.state.cages.set(cage.id, s.sessionId);
    s.cageId = cage.id;
    s.x = cage.x;
    s.z = cage.z;
    s.bleedTimer = 0;
    s.captureTimer = s.captureStage === 1 ? OBJECTIVES.captureFirstSeconds : OBJECTIVES.captureSecondSeconds;
    this.rt.get(s.sessionId)!.stats.timesCaptured++;
    hrt.stats.captures++;
    this.fx({ kind: 'capture', x: from.x, z: from.z, x2: cage.x, z2: cage.z, by: h.sessionId, target: s.sessionId });
    this.feed(`${s.name} has been caged. Rescue them!`, 'danger');
  }

  private eliminate(s: PlayerState, why: string, by?: PlayerState) {
    if (s.cageId) this.state.cages.set(s.cageId, '');
    s.cageId = '';
    if (s.hiddenIn) this.lockerOccupants.delete(s.hiddenIn);
    s.hiddenIn = '';
    if (s.carryingKey) {
      const key = [...this.state.keys.values()].find((k) => k.carriedBy === s.sessionId);
      if (key) {
        key.carriedBy = '';
        key.x = s.x;
        key.z = s.z;
      }
      s.carryingKey = false;
    }
    this.setCondition(s, 'eliminated', true);
    s.action = 'none';
    s.flashlight = false;
    const h = by ?? this.hunter();
    if (h) this.rt.get(h.sessionId)!.stats.eliminations++;
    this.fx({ kind: 'eliminated', x: s.x, z: s.z, target: s.sessionId });
    this.feed(`${s.name} ${why}.`, 'danger');
  }

  // ------------------------------------------------------------------ abilities
  useAbility(sessionId: string) {
    const h = this.state.players.get(sessionId);
    const rt = this.rt.get(sessionId);
    if (!h || !rt || h.role !== 'hunter' || this.state.phase !== 'playing') return;
    if (h.abilityCd > 0 || rt.action || rt.stunUntil > this.time || rt.chargeUntil > this.time) return;
    switch (h.characterId) {
      case 'wraith': {
        const cfg = ABILITIES.shadow_step;
        const fwd = forwardVector(h.yaw);
        let best: { x: number; z: number } | null = null;
        let bestScore = Infinity;
        for (const sp of this.map.shadowPoints) {
          const dx = sp.x - h.x;
          const dz = sp.z - h.z;
          const d = Math.hypot(dx, dz);
          if (d < 4 || d > cfg.range) continue;
          const ang = Math.abs(angleDiff(yawTowards(h.x, h.z, sp.x, sp.z), h.yaw));
          if (ang > ((cfg.coneDeg / 2) * Math.PI) / 180) continue;
          const score = ang * 6 - d * 0.2 + Math.abs(dx * fwd.z - dz * fwd.x) * 0.05;
          if (score < bestScore) {
            bestScore = score;
            best = sp;
          }
        }
        if (!best) return this.notice(sessionId, 'No shadows in that direction.');
        rt.action = { kind: 'shadowstep', id: `${best.x},${best.z}`, elapsed: 0, duration: cfg.channel, continuous: false };
        h.action = 'shadowstep';
        h.abilityCd = cfg.cooldown;
        this.fx({ kind: 'shadow_step', x: h.x, z: h.z, x2: best.x, z2: best.z, by: h.sessionId, target: 'start' });
        return;
      }
      case 'butcher': {
        const cfg = ABILITIES.brutal_charge;
        rt.chargeUntil = this.time + cfg.duration;
        rt.chargeYaw = h.yaw;
        rt.chargeHit = false;
        h.abilityCd = cfg.cooldown;
        h.action = 'charging';
        this.fx({ kind: 'charge_start', x: h.x, z: h.z, by: h.sessionId });
        return;
      }
      case 'hollow': {
        const cfg = ABILITIES.echo_sense;
        rt.echoUntil = this.time + cfg.duration;
        rt.nextEchoPulse = this.time;
        h.abilityCd = cfg.cooldown;
        this.fx({ kind: 'echo_sense', x: h.x, z: h.z, by: h.sessionId });
        return;
      }
    }
  }

  private finishShadowStep(h: PlayerState, rt: Runtime) {
    const [sx, sz] = rt.action!.id.split(',').map(Number) as [number, number];
    rt.action = null;
    h.action = 'none';
    h.actionProgress = 0;
    const pos = this.freeSpotNear(sx, sz, PLAYER.hunterRadius);
    const free = isFree(this.world, this.dyn, sx, sz, PLAYER.hunterRadius) ? { x: sx, z: sz } : pos;
    this.fx({ kind: 'shadow_step', x: h.x, z: h.z, x2: free.x, z2: free.z, by: h.sessionId, target: 'end' });
    h.x = free.x;
    h.z = free.z;
  }

  private tickCharge(h: PlayerState, rt: Runtime, dt: number) {
    const cfg = ABILITIES.brutal_charge;
    rt.inputs.length = 0;
    rt.budget = 0;
    const before = { x: h.x, z: h.z };
    const fwd = forwardVector(rt.chargeYaw);
    const speed = 5.0 * cfg.speedMul;
    const p = { x: h.x, z: h.z };
    const dist = speed * dt;
    const steps = Math.ceil(dist / 0.15);
    for (let i = 0; i < steps; i++) {
      p.x += (fwd.x * dist) / steps;
      p.z += (fwd.z * dist) / steps;
      resolveCircle(this.world, this.dyn, p, PLAYER.hunterRadius);
    }
    h.x = p.x;
    h.z = p.z;
    h.yaw = rt.chargeYaw;
    if (!rt.chargeHit) {
      const t = this.findAttackTarget(h, 0, 1.6, 90);
      if (t) {
        this.hit(h, rt, t, true);
        rt.chargeUntil = this.time;
        h.action = 'none';
        return;
      }
    }
    const moved = Math.hypot(h.x - before.x, h.z - before.z);
    if (moved < dist * 0.35) {
      // Slammed into a wall.
      rt.chargeUntil = 0;
      this.stun(h, rt, cfg.wallStunSeconds);
      this.fx({ kind: 'charge_wall', x: h.x, z: h.z, by: h.sessionId });
      return;
    }
    if (this.time >= rt.chargeUntil) {
      rt.chargeUntil = 0;
      h.action = 'none';
    }
  }

  private echoPulse(h: PlayerState) {
    const cfg = ABILITIES.echo_sense;
    const targets: { id: string; x: number; z: number }[] = [];
    for (const s of this.survivors()) {
      if (!isAliveInMatch(s.condition as Condition) || s.condition === 'captured' || s.hiddenIn) continue;
      const rt = this.rt.get(s.sessionId)!;
      const active = this.time - rt.movedRecently < 1.0 || s.action === 'repair' || s.action === 'openExit';
      if (!active) continue;
      if (Math.hypot(s.x - h.x, s.z - h.z) > cfg.radius) continue;
      targets.push({ id: s.sessionId, x: s.x, z: s.z });
    }
    const hrt = this.rt.get(h.sessionId);
    if (hrt?.bot) hrt.bot.reveal(targets);
    if (!h.isBot) this.room.send(h.sessionId, S2C.reveal, { targets, duration: 0.7 });
  }

  roar(sessionId: string) {
    const h = this.state.players.get(sessionId);
    const rt = this.rt.get(sessionId);
    if (!h || !rt || h.role !== 'hunter' || this.state.phase !== 'playing') return;
    if (h.roarCd > 0 || rt.stunUntil > this.time) return;
    h.roarCd = HUNTER.roarCooldown;
    this.fx({ kind: 'roar', x: h.x, z: h.z, by: h.sessionId });
    for (const s of this.survivors()) {
      if (!isStanding(s.condition as Condition) || s.hiddenIn || s.crouching) continue;
      if (Math.hypot(s.x - h.x, s.z - h.z) > HUNTER.roarRadius) continue;
      // Startled survivors flinch audibly, giving away a rough position.
      this.noise(s.x, s.z, 'roar_flinch', HUNTER.roarRadius + 2);
    }
  }

  // ------------------------------------------------------------------ items
  setFlashlight(sessionId: string, on: boolean) {
    const p = this.state.players.get(sessionId);
    if (!p || p.role !== 'survivor' || this.state.phase !== 'playing') return;
    if (on && (p.battery <= 0 || p.hiddenIn || !isStanding(p.condition as Condition))) return;
    p.flashlight = !!on;
  }

  useItem(sessionId: string) {
    const p = this.state.players.get(sessionId);
    const rt = this.rt.get(sessionId);
    if (!p || !rt || p.role !== 'survivor' || this.state.phase !== 'playing') return;
    if (!isStanding(p.condition as Condition) || p.hiddenIn || rt.action) return;
    if (p.item === 'medkit') {
      if (p.condition !== 'injured') return this.notice(sessionId, 'You are not injured.');
      rt.action = { kind: 'selfheal', id: '', elapsed: 0, duration: OBJECTIVES.medkitDuration, continuous: false };
      p.action = 'selfheal';
      return;
    }
    if (p.item === 'firecracker') {
      p.item = '';
      const fwd = forwardVector(p.yaw);
      let dist: number = ITEMS.firecrackerRange;
      // Stop the throw at the first wall.
      for (let d = 1; d <= ITEMS.firecrackerRange; d += 0.5) {
        if (!hasLineOfSight(this.world, this.dyn, p.x, p.z, p.x + fwd.x * d, p.z + fwd.z * d, { minHeight: 1.2 })) {
          dist = Math.max(0.5, d - 0.6);
          break;
        }
      }
      const x = p.x + fwd.x * dist;
      const z = p.z + fwd.z * dist;
      this.fx({ kind: 'firecracker', x, z, by: p.sessionId });
      this.noise(x, z, 'firecracker', NOISE.firecrackerRadius);
      const h = this.hunter();
      if (
        h &&
        Math.hypot(h.x - x, h.z - z) < ITEMS.firecrackerBlindRadius &&
        hasLineOfSight(this.world, this.dyn, h.x, h.z, x, z)
      ) {
        const hrt = this.rt.get(h.sessionId)!;
        hrt.blindUntil = this.time + HUNTER.blindSeconds;
        this.stun(h, hrt, HUNTER.blindSeconds * 0.5);
        h.action = 'blinded';
        this.feed(`${p.name} blinded the hunter!`, 'success');
      }
    }
  }

  // ------------------------------------------------------------------ objectives
  private recountRepairers() {
    for (const [id, g] of this.state.generators) {
      g.repairers = this.players().filter((p) => p.action === 'repair' && p.actionTarget === id).length;
    }
  }

  private tickGenerators(dt: number) {
    const s = this.state;
    this.recountRepairers();
    for (const [id, g] of s.generators) {
      if (g.completed) continue;
      const repairers = this.players().filter((p) => p.action === 'repair' && p.actionTarget === id);
      if (repairers.length > 0) {
        g.kicked = false;
        const rate = (1 + (repairers.length - 1) * 0.75) / 48;
        const inc = rate * dt;
        g.progress = Math.min(1, g.progress + inc);
        for (const r of repairers) {
          this.rt.get(r.sessionId)!.stats.generatorProgress += inc / repairers.length;
          r.actionProgress = g.progress;
        }
        if (g.progress >= 1) this.completeGenerator(id);
      } else if (g.kicked) {
        g.progress = Math.max(0, g.progress - OBJECTIVES.kickRegressionPerSecond * dt);
        if (g.progress <= 0) g.kicked = false;
      }
    }
  }

  private completeGenerator(id: string) {
    const s = this.state;
    const g = s.generators.get(id)!;
    g.completed = true;
    g.progress = 1;
    g.kicked = false;
    s.generatorsCompleted++;
    const def = this.map.generators.find((x) => x.id === id)!;
    for (const p of this.players()) {
      if (p.action === 'repair' && p.actionTarget === id) this.cancelAction(p, this.rt.get(p.sessionId)!);
    }
    this.fx({ kind: 'gen_done', x: def.x, z: def.z });
    if (s.generatorsCompleted >= s.generatorsRequired && !s.powerOn) {
      s.powerOn = true;
      for (const d of s.doors.values()) {
        if (d.locked) {
          d.locked = false;
          d.open = true;
        }
      }
      this.dynDirty = true;
      for (const p of this.players()) {
        if (p.action === 'repair') this.cancelAction(p, this.rt.get(p.sessionId)!);
      }
      this.fx({ kind: 'power_on', x: 0, z: 0 });
      this.feed('POWER RESTORED. Find the keys and open an exit.', 'success');
    } else {
      this.feed(`Generator repaired (${s.generatorsCompleted}/${s.generatorsRequired}).`, 'info');
    }
  }

  private tickSkillCheck(p: PlayerState, rt: Runtime) {
    if (p.isBot) return;
    const t = this.time;
    if (rt.skill) {
      if (t > rt.skill.sentAt + rt.skill.duration + OBJECTIVES.skillCheckLatencyGrace) {
        this.resolveSkillCheck(p, rt, 'fail');
      }
      return;
    }
    if (t < rt.nextSkillAt) return;
    const great = p.characterId === 'alex' ? 0.06 * PERKS.alex.greatZoneMul : 0.06;
    const zoneStart = 0.4 + Math.random() * 0.4;
    const check = {
      id: this.skillSeq++,
      sentAt: t,
      duration: OBJECTIVES.skillCheckNeedleSeconds,
      zoneStart,
      zoneEnd: Math.min(0.98, zoneStart + 0.16),
      greatEnd: zoneStart + great,
    };
    rt.skill = check;
    this.room.send(p.sessionId, S2C.skillCheck, {
      id: check.id,
      duration: check.duration,
      zoneStart: check.zoneStart,
      zoneEnd: check.zoneEnd,
      greatEnd: check.greatEnd,
    });
  }

  answerSkillCheck(sessionId: string, id: number, ratio: number) {
    const p = this.state.players.get(sessionId);
    const rt = this.rt.get(sessionId);
    if (!p || !rt || !rt.skill || rt.skill.id !== id) return;
    const sk = rt.skill;
    const r = Number(ratio);
    const elapsed = this.time - sk.sentAt;
    // The client cannot claim a needle position the needle has not reached yet.
    const plausible = Number.isFinite(r) && r >= 0 && r <= 1.05 && r * sk.duration <= elapsed + 0.08;
    let result: 'great' | 'good' | 'fail' = 'fail';
    if (plausible && r >= sk.zoneStart && r <= sk.zoneEnd) result = r <= sk.greatEnd ? 'great' : 'good';
    this.resolveSkillCheck(p, rt, result);
  }

  private resolveSkillCheck(p: PlayerState, rt: Runtime, result: 'great' | 'good' | 'fail') {
    const sk = rt.skill;
    if (!sk) return;
    rt.skill = null;
    rt.nextSkillAt = this.time + this.randomGap();
    this.room.send(p.sessionId, S2C.skillCheckResult, { id: sk.id, result });
    const genId = p.actionTarget;
    const g = this.state.generators.get(genId);
    if (!g || g.completed) return;
    const def = this.map.generators.find((x) => x.id === genId)!;
    if (result === 'fail') {
      rt.stats.skillFails++;
      g.progress = Math.max(0, g.progress - OBJECTIVES.skillCheckFailPenalty);
      this.noise(def.x, def.z, 'skill_fail', NOISE.skillFailRadius);
      this.fx({ kind: 'gen_fail', x: def.x, z: def.z, by: p.sessionId });
    } else if (result === 'great') {
      rt.stats.skillGreats++;
      g.progress = Math.min(1, g.progress + OBJECTIVES.skillCheckGreatBonus);
    }
  }

  private checkEscapes() {
    for (const p of this.survivors()) {
      if (!isStanding(p.condition as Condition)) continue;
      for (const e of this.map.exits) {
        if (!this.state.exits.get(e.id)?.open) continue;
        const z = e.zone;
        if (p.x >= z.minX && p.x <= z.maxX && p.z >= z.minZ && p.z <= z.maxZ) {
          if (p.carryingKey) {
            const key = [...this.state.keys.values()].find((k) => k.carriedBy === p.sessionId);
            if (key) key.carriedBy = '';
            p.carryingKey = false;
          }
          this.setCondition(p, 'escaped');
          p.flashlight = false;
          p.action = 'none';
          this.fx({ kind: 'escape', x: p.x, z: p.z, target: p.sessionId });
          this.feed(`${p.name} escaped!`, 'success');
          break;
        }
      }
    }
  }

  private checkEnd() {
    const s = this.state;
    const survivors = this.survivors();
    const alive = survivors.filter((p) => isAliveInMatch(p.condition as Condition));
    const hunter = this.hunter();
    if (!hunter) return this.end('survivors');
    if (survivors.length === 0) return this.end('hunter');
    if (alive.length === 0) {
      const escaped = survivors.filter((p) => p.condition === 'escaped').length;
      return this.end(escaped >= Math.ceil(survivors.length / 2) ? 'survivors' : 'hunter');
    }
    if (s.timeLeft <= 0) {
      for (const p of alive) this.eliminate(p, 'was lost to the night');
      const escaped = survivors.filter((p) => p.condition === 'escaped').length;
      return this.end(escaped >= Math.ceil(survivors.length / 2) ? 'survivors' : 'hunter');
    }
  }

  onEnd: ((winner: 'survivors' | 'hunter') => void) | null = null;

  private end(winner: 'survivors' | 'hunter') {
    if (this.ended) return;
    this.ended = true;
    this.state.winner = winner;
    for (const p of this.players()) {
      p.flashlight = false;
      p.locked = true;
    }
    this.onEnd?.(winner);
  }

  // ------------------------------------------------------------------ connection lifecycle
  /** A participant left for good mid-match. */
  abandon(sessionId: string) {
    const p = this.state.players.get(sessionId);
    if (!p) return;
    if (p.role === 'survivor') {
      if (isAliveInMatch(p.condition as Condition)) this.eliminate(p, 'disconnected');
    } else if (p.role === 'hunter' && !this.ended) {
      // Keep the match going: a bot takes over the hunter.
      p.isBot = true;
      p.connected = true;
      p.name = `${p.name} (bot)`;
      this.rt.get(sessionId)!.bot = new BotController(this, sessionId);
      this.feed('The hunter disconnected — something else has taken its place.', 'danger');
    }
  }
}
