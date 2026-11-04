import { NET } from '@shadow-hunt/shared';

interface Sample {
  t: number;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
}

const buffers = new Map<string, Sample[]>();

/** Called on every state patch with the authoritative positions of all players. */
export function pushSample(id: string, x: number, z: number, yaw: number, pitch: number, now = performance.now()) {
  let b = buffers.get(id);
  if (!b) buffers.set(id, (b = []));
  const last = b[b.length - 1];
  // Teleports (cages, hatches, shadow step) should not be smeared across the map.
  if (last && Math.hypot(last.x - x, last.z - z) > 6) b.length = 0;
  b.push({ t: now, x, z, yaw, pitch });
  if (b.length > 30) b.splice(0, b.length - 30);
}

export function clearSamples(id?: string) {
  if (id) buffers.delete(id);
  else buffers.clear();
}

function lerpAngle(a: number, b: number, k: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

const out = { x: 0, z: 0, yaw: 0, pitch: 0, speed: 0 };

/** Position of a remote player as it was `interpolationDelay` ms ago. */
export function sampleRemote(id: string, now = performance.now()): typeof out | null {
  const b = buffers.get(id);
  if (!b || !b.length) return null;
  const t = now - NET.interpolationDelayMs;
  if (b.length === 1 || t <= b[0]!.t) {
    const s = b[0]!;
    Object.assign(out, s, { speed: 0 });
    return out;
  }
  for (let i = b.length - 1; i > 0; i--) {
    const a = b[i - 1]!;
    const c = b[i]!;
    if (a.t <= t) {
      const span = Math.max(1, c.t - a.t);
      const k = Math.min(1, (t - a.t) / span);
      out.x = a.x + (c.x - a.x) * k;
      out.z = a.z + (c.z - a.z) * k;
      out.yaw = lerpAngle(a.yaw, c.yaw, k);
      out.pitch = a.pitch + (c.pitch - a.pitch) * k;
      out.speed = Math.hypot(c.x - a.x, c.z - a.z) / (span / 1000);
      return out;
    }
  }
  const s = b[b.length - 1]!;
  Object.assign(out, s, { speed: 0 });
  return out;
}
