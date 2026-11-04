import {
  angleDiff,
  buildNavGraph,
  findPath,
  hasLineOfSight,
  isStanding,
  nearestNode,
  yawTowards,
  type Condition,
  type MapId,
  type NavGraph,
} from '@shadow-hunt/shared';
import type { Game } from './Game.ts';

const graphs = new Map<MapId, NavGraph>();

interface Memory {
  x: number;
  z: number;
  t: number;
  kind: string;
}

/**
 * Optional bot Hunter. Used only when the host picks "Bot hunter" or when a human
 * hunter disconnects mid-match. It plays by the same rules as a human: it sends
 * movement inputs through the same validation, only hears jittered noise, and only
 * sees survivors it has line of sight to.
 */
export class BotController {
  private graph: NavGraph;
  private path: { x: number; z: number }[] = [];
  private repathAt = 0;
  private goal: { x: number; z: number } | null = null;
  private memory: Memory | null = null;
  private patrolUntil = 0;
  private lastPos = { x: 0, z: 0, t: 0 };
  private searchedLockers = new Set<string>();
  private thinkAt = 0;
  private targetId: string | null = null;
  private yaw = 0;

  constructor(
    private game: Game,
    private id: string,
  ) {
    const mapId = game.map.id;
    let g = graphs.get(mapId);
    if (!g) graphs.set(mapId, (g = buildNavGraph(game.world)));
    this.graph = g;
    const me = game.state.players.get(id);
    if (me) this.yaw = me.yaw;
  }

  hear(x: number, z: number, kind: string) {
    if (!this.memory || kind !== 'step' || this.game.time - this.memory.t > 3) {
      this.memory = { x, z, t: this.game.time, kind };
    }
  }

  reveal(targets: { id: string; x: number; z: number }[]) {
    const me = this.me();
    if (!me || !targets.length) return;
    targets.sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
    const t = targets[0]!;
    this.memory = { x: t.x, z: t.z, t: this.game.time, kind: 'reveal' };
  }

  private me() {
    return this.game.state.players.get(this.id);
  }

  private visible(me: { x: number; z: number; yaw: number }, s: { x: number; z: number }, range: number) {
    const d = Math.hypot(s.x - me.x, s.z - me.z);
    if (d > range) return false;
    const ang = Math.abs(angleDiff(yawTowards(me.x, me.z, s.x, s.z), me.yaw));
    if (d > 5 && ang > 1.15) return false;
    return hasLineOfSight(this.game.world, this.game.dyn, me.x, me.z, s.x, s.z, {
      minHeight: 1.3,
      includeCircles: true,
      minCircleRadius: 0.8,
    });
  }

  update(dt: number) {
    const game = this.game;
    const me = this.me();
    const rt = game.runtime(this.id);
    if (!me || !rt || game.state.phase !== 'playing') return;
    const t = game.time;

    if (t >= this.thinkAt) {
      this.thinkAt = t + 0.25;
      this.think(me);
    }

    // Stuck detection: open doors / break pallets in the way, else re-plan.
    if (t - this.lastPos.t > 1.2) {
      const moved = Math.hypot(me.x - this.lastPos.x, me.z - this.lastPos.z);
      if (moved < 0.4 && this.goal && !rt.action && rt.stunUntil <= t) this.unstick(me);
      this.lastPos = { x: me.x, z: me.z, t };
    }

    if (rt.action || rt.stunUntil > t || rt.chargeUntil > t) return;

    // Steering
    let mz = 0;
    if (this.goal) {
      const direct =
        Math.hypot(this.goal.x - me.x, this.goal.z - me.z) < 14 &&
        hasLineOfSight(game.world, game.dyn, me.x, me.z, this.goal.x, this.goal.z, { minHeight: 0, includeCircles: true });
      let wp = this.goal;
      if (!direct) {
        while (this.path.length && Math.hypot(this.path[0]!.x - me.x, this.path[0]!.z - me.z) < 0.8) this.path.shift();
        if (!this.path.length || t >= this.repathAt) this.plan(me, this.goal);
        wp = this.path[0] ?? this.goal;
        // Hatch hop
        const hatch = game.map.hatches.find((h) => Math.hypot(h.x - me.x, h.z - me.z) < 1.4);
        const dest = hatch && game.map.hatches.find((o) => o.id === hatch.to);
        if (hatch && dest && this.path.some((p) => Math.hypot(p.x - dest.x, p.z - dest.z) < 3)) {
          game.requestInteract(this.id, 'hatch', hatch.id);
          this.path = [];
          return;
        }
      }
      const desired = yawTowards(me.x, me.z, wp.x, wp.z);
      const diff = angleDiff(desired, this.yaw);
      const maxTurn = 5.5 * dt;
      this.yaw += Math.max(-maxTurn, Math.min(maxTurn, diff));
      mz = Math.abs(diff) < 1.2 && Math.hypot(wp.x - me.x, wp.z - me.z) > 0.3 ? 1 : 0;
    }
    rt.inputs.push({ seq: me.lastSeq + 1, dt, mx: 0, mz, yaw: this.yaw, pitch: 0, sprint: false, crouch: false });
  }

  private plan(me: { x: number; z: number }, goal: { x: number; z: number }) {
    const a = nearestNode(this.graph, me.x, me.z);
    const b = nearestNode(this.graph, goal.x, goal.z);
    const nodes = findPath(this.graph, a, b, 60000);
    this.path = nodes ? nodes.slice(1).map((i) => this.graph.nodes[i]!) : [];
    // Thin the path: skip waypoints we can already see past.
    this.repathAt = this.game.time + 1.5;
  }

  private think(me: NonNullable<ReturnType<BotController['me']>>) {
    const game = this.game;
    const rt = game.runtime(this.id)!;
    const t = game.time;
    const survivors = game.survivors().filter((s) => !s.hiddenIn);

    // 1. Capture downed survivors we can see or that are close.
    const downed = survivors
      .filter((s) => s.condition === 'downed' && (Math.hypot(s.x - me.x, s.z - me.z) < 16 || this.visible(me, s, 30)))
      .sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z))[0];
    // 2. Chase visible standing survivors.
    const seen = survivors
      .filter((s) => isStanding(s.condition as Condition) && this.visible(me, s, 26))
      .sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z))[0];

    if (seen && (!downed || Math.hypot(seen.x - me.x, seen.z - me.z) < 6)) {
      this.targetId = seen.sessionId;
      this.memory = { x: seen.x, z: seen.z, t, kind: 'seen' };
      this.goal = { x: seen.x, z: seen.z };
      const d = Math.hypot(seen.x - me.x, seen.z - me.z);
      const facing = Math.abs(angleDiff(yawTowards(me.x, me.z, seen.x, seen.z), me.yaw));
      if (d < 2.4 && facing < 0.45 && me.attackCd <= 0) game.attack(this.id, 0);
      if (me.abilityCd <= 0) {
        if (me.characterId === 'butcher' && d > 5 && d < 11 && facing < 0.12) game.useAbility(this.id);
        if (me.characterId === 'wraith' && d > 14 && facing < 0.3) game.useAbility(this.id);
      }
      return;
    }
    if (downed) {
      this.goal = { x: downed.x, z: downed.z };
      if (Math.hypot(downed.x - me.x, downed.z - me.z) < 1.9 && !rt.action) {
        this.face(me, downed.x, downed.z);
        game.requestInteract(this.id, 'capture', downed.sessionId);
      }
      return;
    }
    this.targetId = null;

    // 3. Investigate what we heard.
    if (this.memory && t - this.memory.t < 9) {
      const m = this.memory;
      this.goal = { x: m.x, z: m.z };
      if (Math.hypot(m.x - me.x, m.z - me.z) < 1.8) {
        const locker = game.map.lockers.find((l) => Math.hypot(l.x - me.x, l.z - me.z) < 2.2 && !this.searchedLockers.has(l.id));
        if (locker && Math.random() < 0.6) {
          this.searchedLockers.add(locker.id);
          this.face(me, locker.x, locker.z);
          game.requestInteract(this.id, 'search', locker.id);
        }
        this.memory = null;
      }
      return;
    }
    if (me.characterId === 'hollow' && me.abilityCd <= 0) game.useAbility(this.id);
    if (me.roarCd <= 0 && Math.random() < 0.05) game.roar(this.id);

    // 4. Patrol: generators with progress first, then random points of interest.
    const gen = game.map.generators
      .map((g) => ({ g, st: game.state.generators.get(g.id)! }))
      .filter(({ st }) => !st.completed && !st.kicked && st.progress > 0.25 && !game.state.powerOn)
      .sort((a, b) => b.st.progress - a.st.progress)[0];
    if (gen && Math.hypot(gen.g.x - me.x, gen.g.z - me.z) < 2.2) {
      this.face(me, gen.g.x, gen.g.z);
      game.requestInteract(this.id, 'kick', gen.g.id);
      return;
    }
    if (!this.goal || t > this.patrolUntil || Math.hypot(this.goal.x - me.x, this.goal.z - me.z) < 2) {
      const pois = [
        ...game.map.generators.map((g) => ({ x: g.x, z: g.z })),
        ...game.map.exits.map((e) => ({ x: e.panel.x, z: e.panel.z })),
        ...game.map.cages,
      ];
      const pick = gen ? { x: gen.g.x, z: gen.g.z } : pois[Math.floor(Math.random() * pois.length)]!;
      this.goal = { x: pick.x, z: pick.z };
      this.patrolUntil = t + 25;
      this.path = [];
      this.searchedLockers.clear();
    }
  }

  private face(me: { x: number; z: number; yaw: number }, x: number, z: number) {
    this.yaw = yawTowards(me.x, me.z, x, z);
    me.yaw = this.yaw;
  }

  private unstick(me: { x: number; z: number; yaw: number }) {
    const game = this.game;
    const door = game.map.doors.find(
      (d) => Math.hypot(d.x - me.x, d.z - me.z) < 2.4 && game.state.doors.get(d.id)?.open === false,
    );
    if (door && !game.state.doors.get(door.id)?.locked) {
      this.face(me, door.x, door.z);
      game.requestInteract(this.id, 'door', door.id);
      return;
    }
    const pallet = game.map.pallets.find(
      (p) => Math.hypot(p.x - me.x, p.z - me.z) < 2.6 && game.state.pallets.get(p.id) === 'down',
    );
    if (pallet) {
      this.face(me, pallet.x, pallet.z);
      game.requestInteract(this.id, 'break', pallet.id);
      return;
    }
    this.path = [];
    this.repathAt = 0;
    if (Math.random() < 0.3) this.goal = null;
  }
}
