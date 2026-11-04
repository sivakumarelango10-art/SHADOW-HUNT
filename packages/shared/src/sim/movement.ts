import { PLAYER } from '../balance.ts';
import { PERKS } from '../characters.ts';
import type { CharacterId, Condition, MoveInput, Role } from '../types.ts';
import { moveCircle, type DynamicBlockers, type StaticWorld } from './collision.ts';

/** The subset of player state that movement simulates. Shared by server and client prediction. */
export interface MoverState {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  stamina: number;
  exhausted: boolean;
  staminaDelay: number;
  crouching: boolean;
  sprinting: boolean;
}

export interface MoverParams {
  role: Role;
  condition: Condition;
  characterId: CharacterId;
  /** Server-applied multiplier (hit boost, post-hit slow, charge…). */
  speedMul: number;
  /** When true the player cannot translate (busy, hidden, captured, stunned). */
  locked: boolean;
}

export interface StepResult {
  distance: number;
  speed: number;
}

export function radiusFor(role: Role): number {
  return role === 'hunter' ? PLAYER.hunterRadius : PLAYER.survivorRadius;
}

export function clampInput(i: MoveInput): MoveInput {
  const num = (v: unknown, lo: number, hi: number, d = 0) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;
  return {
    seq: typeof i.seq === 'number' && Number.isFinite(i.seq) ? Math.floor(i.seq) : 0,
    dt: num(i.dt, 0, 0.1),
    mx: num(i.mx, -1, 1),
    mz: num(i.mz, -1, 1),
    yaw: num(i.yaw, -1e4, 1e4),
    pitch: num(i.pitch, -1.45, 1.45),
    sprint: i.sprint === true,
    crouch: i.crouch === true,
  };
}

const canStand = (c: Condition) => c === 'healthy' || c === 'injured' || c === 'rescued';

/**
 * Advance one movement input. Deterministic: given the same state, input, params and
 * world, client prediction and the authoritative server produce the same result.
 */
export function stepMovement(
  world: StaticWorld,
  dyn: DynamicBlockers,
  s: MoverState,
  input: MoveInput,
  p: MoverParams,
): StepResult {
  const dt = input.dt;
  s.yaw = input.yaw;
  s.pitch = input.pitch;

  let mx = input.mx;
  let mz = input.mz;
  const len = Math.hypot(mx, mz);
  if (len > 1) {
    mx /= len;
    mz /= len;
  }
  const wantsMove = len > 0.05 && !p.locked;

  let speed = 0;
  let sprintingNow = false;
  if (p.role === 'hunter') {
    s.crouching = false;
    speed = PLAYER.hunterSpeed;
  } else if (p.condition === 'downed') {
    s.crouching = false;
    speed = PLAYER.downedSpeed;
  } else if (canStand(p.condition)) {
    s.crouching = input.crouch;
    const canSprint = input.sprint && !s.crouching && !s.exhausted && s.stamina > 0 && wantsMove;
    if (s.crouching) {
      speed = PLAYER.crouchSpeed * (p.characterId === 'luna' ? PERKS.luna.crouchSpeedMul : 1);
    } else if (canSprint) {
      speed = PLAYER.sprintSpeed;
      sprintingNow = true;
    } else {
      speed = PLAYER.walkSpeed;
    }
  }
  speed *= p.speedMul;

  // Stamina
  if (p.role === 'survivor') {
    if (sprintingNow) {
      s.stamina = Math.max(0, s.stamina - PLAYER.staminaDrain * dt);
      s.staminaDelay = PLAYER.staminaRegenDelay;
      if (s.stamina <= 0) s.exhausted = true;
    } else {
      s.staminaDelay = Math.max(0, s.staminaDelay - dt);
      if (s.staminaDelay <= 0) {
        const mul = p.characterId === 'ethan' ? PERKS.ethan.staminaRegenMul : 1;
        s.stamina = Math.min(PLAYER.staminaMax, s.stamina + PLAYER.staminaRegen * mul * dt);
      }
      if (s.exhausted && s.stamina >= PLAYER.exhaustedRecoverAt) s.exhausted = false;
    }
  }
  s.sprinting = sprintingNow;

  if (!wantsMove || speed <= 0 || dt <= 0) return { distance: 0, speed: 0 };

  // Camera convention: yaw 0 looks down -Z. forward = (-sin, -cos), right = (cos, -sin).
  const sin = Math.sin(s.yaw);
  const cos = Math.cos(s.yaw);
  const dirX = mx * cos - mz * sin;
  const dirZ = -mx * sin - mz * cos;
  const ox = s.x;
  const oz = s.z;
  moveCircle(world, dyn, s, dirX * speed * dt, dirZ * speed * dt, radiusFor(p.role));
  const distance = Math.hypot(s.x - ox, s.z - oz);
  return { distance, speed: distance / dt };
}

export function forwardVector(yaw: number): { x: number; z: number } {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/** Smallest signed difference between two angles. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Yaw that looks from (ax,az) towards (bx,bz). */
export function yawTowards(ax: number, az: number, bx: number, bz: number): number {
  return Math.atan2(-(bx - ax), -(bz - az));
}
