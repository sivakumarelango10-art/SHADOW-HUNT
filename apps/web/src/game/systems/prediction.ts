import {
  NET,
  stepMovement,
  type Condition,
  type DynamicBlockers,
  type MoveInput,
  type MoverParams,
  type MoverState,
  type StaticWorld,
} from '@shadow-hunt/shared';

/**
 * Client-side prediction for the local player with server reconciliation.
 * Inputs are applied immediately with the same shared `stepMovement` the server
 * runs; when an authoritative patch arrives we rewind to it and replay every input
 * the server has not processed yet. Any residual error is blended out visually.
 */
export const prediction = {
  s: { x: 0, z: 0, yaw: 0, pitch: 0, stamina: 100, exhausted: false, staminaDelay: 0, crouching: false, sprinting: false } as MoverState,
  seq: 0,
  pending: [] as MoveInput[],
  outbox: [] as MoveInput[],
  lastSend: 0,
  lastPatch: -1,
  offset: { x: 0, z: 0 },
  ready: false,

  reset(x: number, z: number, yaw: number) {
    Object.assign(this.s, { x, z, yaw, pitch: 0, stamina: 100, exhausted: false, staminaDelay: 0, crouching: false, sprinting: false });
    this.pending = [];
    this.outbox = [];
    this.offset.x = this.offset.z = 0;
    this.ready = true;
  },

  params(me: any): MoverParams {
    return {
      role: me.role,
      condition: me.condition as Condition,
      characterId: me.characterId,
      speedMul: me.speedMul ?? 1,
      locked: !!me.locked,
    };
  },

  apply(world: StaticWorld, dyn: DynamicBlockers, input: MoveInput, me: any) {
    stepMovement(world, dyn, this.s, input, this.params(me));
    this.pending.push(input);
    this.outbox.push(input);
    if (this.pending.length > 240) this.pending.splice(0, this.pending.length - 240);
  },

  reconcile(world: StaticWorld, dyn: DynamicBlockers, me: any) {
    const before = { x: this.s.x, z: this.s.z };
    this.s.x = me.x;
    this.s.z = me.z;
    this.s.stamina = me.stamina;
    this.s.exhausted = me.exhausted;
    this.s.staminaDelay = me.staminaDelay;
    this.pending = this.pending.filter((i) => i.seq > me.lastSeq);
    const params = this.params(me);
    const yaw = this.s.yaw;
    const pitch = this.s.pitch;
    for (const i of this.pending) stepMovement(world, dyn, this.s, i, params);
    this.s.yaw = yaw;
    this.s.pitch = pitch;
    const ex = before.x - this.s.x;
    const ez = before.z - this.s.z;
    const err = Math.hypot(ex, ez);
    if (err > 3) {
      // Teleport (cage, hatch, shadow step, escape): snap.
      this.offset.x = this.offset.z = 0;
    } else {
      this.offset.x += ex;
      this.offset.z += ez;
    }
  },

  /** Decay the visual correction so reconciliation never snaps the camera. */
  smooth(dt: number) {
    const k = Math.exp(-dt * 12);
    this.offset.x *= k;
    this.offset.z *= k;
  },

  flush(now: number, send: (inputs: MoveInput[]) => void) {
    if (now - this.lastSend < NET.inputSendMs || !this.outbox.length) return;
    this.lastSend = now;
    while (this.outbox.length) send(this.outbox.splice(0, NET.maxInputsPerBatch));
  },
};
