import { HUNTER, OBJECTIVES } from './balance.ts';
import { PERKS } from './characters.ts';
import type { MapDef } from './maps/types.ts';
import { angleDiff, yawTowards } from './sim/movement.ts';
import type { CharacterId, Condition, InteractKind, ItemKind, Role } from './types.ts';

/** Minimal view of a player needed to compute interactions. */
export interface InteractPlayer {
  id: string;
  role: Role;
  characterId: CharacterId;
  condition: Condition;
  x: number;
  z: number;
  yaw: number;
  hiddenIn: string;
  carryingKey: boolean;
  item: string;
  cageId: string;
  busy: boolean;
}

/** Minimal view of the live world needed to compute interactions. */
export interface InteractWorld {
  map: MapDef;
  powerOn: boolean;
  keysDeposited: number;
  keysRequired: number;
  generator(id: string): { progress: number; completed: boolean; kicked: boolean } | undefined;
  exit(id: string): { progress: number; open: boolean } | undefined;
  keys: { id: string; x: number; z: number; carriedBy: string; deposited: boolean }[];
  pallet(id: string): 'up' | 'down' | 'broken';
  door(id: string): { open: boolean; locked: boolean } | undefined;
  pickupTaken(id: string): boolean;
  players: InteractPlayer[];
  /** Server only: occupied lockers. Clients pass an empty set. */
  lockerOccupied(id: string): boolean;
}

export interface InteractOption {
  kind: InteractKind;
  id: string;
  label: string;
  /** Seconds the interaction must be held. 0 = instant. */
  duration: number;
  /** True when the interaction is continuous (generator repair) rather than timed. */
  continuous: boolean;
  disabled?: string;
  x: number;
  z: number;
  score: number;
}

const RANGE: number = OBJECTIVES.interactRange;

function scoreFor(me: InteractPlayer, x: number, z: number, range: number): number | null {
  const d = Math.hypot(x - me.x, z - me.z);
  if (d > range) return null;
  const facing = Math.abs(angleDiff(yawTowards(me.x, me.z, x, z), me.yaw));
  // Close targets can be used regardless of facing; further ones must be roughly in view.
  if (d > 1.1 && facing > 1.4) return null;
  return d + facing * 0.9;
}

export function healMultiplier(characterId: CharacterId): number {
  return characterId === 'mia' ? PERKS.mia.healSpeedMul : 1;
}

/**
 * Every interaction currently available to `me`, best first. Used by the client to
 * show prompts and by the server to validate requests (with `rangeBonus` slack).
 */
export function getInteractions(w: InteractWorld, me: InteractPlayer, rangeBonus = 0): InteractOption[] {
  const out: InteractOption[] = [];
  const push = (o: Omit<InteractOption, 'score' | 'continuous'> & { continuous?: boolean }, range = RANGE) => {
    const sc = scoreFor(me, o.x, o.z, range + rangeBonus);
    if (sc !== null) out.push({ continuous: false, ...o, score: sc });
  };
  const map = w.map;

  if (me.role === 'survivor') {
    if (me.condition === 'captured' || me.condition === 'downed' || me.condition === 'escaped' || me.condition === 'eliminated') {
      return out;
    }
    if (me.hiddenIn) {
      const l = map.lockers.find((k) => k.id === me.hiddenIn);
      if (l)
        out.push({
          kind: 'unhide',
          id: l.id,
          label: 'Leave hiding spot',
          duration: OBJECTIVES.hideDuration,
          continuous: false,
          x: l.x,
          z: l.z,
          score: 0,
        });
      return out;
    }
    if (!w.powerOn) {
      for (const g of map.generators) {
        const st = w.generator(g.id);
        if (!st || st.completed) continue;
        push({ kind: 'repair', id: g.id, label: 'Repair generator', duration: 0, continuous: true, x: g.x, z: g.z }, RANGE + 0.3);
      }
    }
    for (const k of w.keys) {
      if (k.carriedBy || k.deposited) continue;
      push({
        kind: 'pickupKey',
        id: k.id,
        label: 'Take access key',
        duration: OBJECTIVES.keyPickupDuration,
        x: k.x,
        z: k.z,
        disabled: me.carryingKey ? 'Already carrying a key' : undefined,
      });
    }
    for (const e of map.exits) {
      const st = w.exit(e.id);
      if (!st || st.open) continue;
      if (me.carryingKey && w.keysDeposited < w.keysRequired) {
        push({
          kind: 'depositKey',
          id: e.id,
          label: 'Insert access key',
          duration: OBJECTIVES.keyDepositDuration,
          x: e.panel.x,
          z: e.panel.z,
        });
      } else {
        let disabled: string | undefined;
        if (!w.powerOn) disabled = 'No power — repair generators';
        else if (w.keysDeposited < w.keysRequired) disabled = `Needs ${w.keysRequired - w.keysDeposited} more access key(s)`;
        push({
          kind: 'openExit',
          id: e.id,
          label: `Open ${e.name}`,
          duration: OBJECTIVES.exitOpenDuration,
          x: e.panel.x,
          z: e.panel.z,
          disabled,
        });
      }
    }
    for (const l of map.lockers) {
      push(
        {
          kind: 'hide',
          id: l.id,
          label: 'Hide',
          duration: OBJECTIVES.hideDuration,
          x: l.x,
          z: l.z,
          disabled: w.lockerOccupied(l.id) ? 'Occupied' : undefined,
        },
        1.6,
      );
    }
    for (const p of map.pallets) {
      if (w.pallet(p.id) !== 'up') continue;
      push({ kind: 'pallet', id: p.id, label: 'Drop pallet', duration: OBJECTIVES.palletDropDuration, x: p.x, z: p.z }, 1.9);
    }
    for (const p of map.pickups) {
      if (w.pickupTaken(p.id)) continue;
      const label = p.kind === 'battery' ? 'Take battery' : p.kind === 'medkit' ? 'Take med kit' : 'Take firecracker';
      push(
        {
          kind: 'pickup',
          id: p.id,
          label,
          duration: OBJECTIVES.pickupDuration,
          x: p.x,
          z: p.z,
          disabled: p.kind !== 'battery' && me.item ? 'Hands full' : undefined,
        },
        1.6,
      );
    }
    for (const o of w.players) {
      if (o.id === me.id || o.role !== 'survivor') continue;
      const mul = healMultiplier(me.characterId);
      if (o.condition === 'captured') {
        push({ kind: 'rescue', id: o.id, label: 'Break the cage', duration: OBJECTIVES.rescueDuration, x: o.x, z: o.z }, 1.9);
      } else if (o.condition === 'downed') {
        push({ kind: 'revive', id: o.id, label: 'Help up', duration: OBJECTIVES.reviveDuration / mul, x: o.x, z: o.z }, 1.7);
      } else if (o.condition === 'injured' && !o.hiddenIn) {
        push({ kind: 'heal', id: o.id, label: 'Heal', duration: OBJECTIVES.healDuration / mul, x: o.x, z: o.z }, 1.6);
      }
    }
  } else {
    // Hunter
    for (const o of w.players) {
      if (o.role !== 'survivor' || o.condition !== 'downed') continue;
      push({ kind: 'capture', id: o.id, label: 'Capture', duration: HUNTER.captureDuration, x: o.x, z: o.z }, 2.1);
    }
    for (const p of map.pallets) {
      if (w.pallet(p.id) !== 'down') continue;
      push({ kind: 'break', id: p.id, label: 'Break pallet', duration: HUNTER.breakPalletDuration, x: p.x, z: p.z }, 2.0);
    }
    for (const g of map.generators) {
      const st = w.generator(g.id);
      if (!st || st.completed || st.kicked || st.progress <= 0.02 || w.powerOn) continue;
      push(
        { kind: 'kick', id: g.id, label: 'Damage generator', duration: HUNTER.kickGeneratorDuration, x: g.x, z: g.z },
        RANGE + 0.3,
      );
    }
    for (const l of map.lockers) {
      push({ kind: 'search', id: l.id, label: 'Search', duration: HUNTER.searchLockerDuration, x: l.x, z: l.z }, 1.8);
    }
  }

  // Shared: doors and hatches
  for (const d of map.doors) {
    const st = w.door(d.id);
    if (!st) continue;
    push(
      {
        kind: 'door',
        id: d.id,
        label: st.open ? 'Close door' : 'Open door',
        duration: OBJECTIVES.doorDuration,
        x: d.x,
        z: d.z,
        disabled: st.locked ? 'Locked — restore power' : undefined,
      },
      1.8,
    );
  }
  for (const h of map.hatches) {
    push({ kind: 'hatch', id: h.id, label: h.label, duration: OBJECTIVES.hatchDuration, x: h.x, z: h.z }, 1.7);
  }

  out.sort((a, b) => (a.disabled ? 1 : 0) - (b.disabled ? 1 : 0) || a.score - b.score);
  return out;
}

export function itemLabel(kind: ItemKind | ''): string {
  switch (kind) {
    case 'firecracker':
      return 'Firecracker';
    case 'medkit':
      return 'Med kit';
    case 'battery':
      return 'Battery';
    default:
      return '';
  }
}
