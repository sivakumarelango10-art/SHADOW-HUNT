#!/usr/bin/env node
/**
 * Generates every Shadow Hunt sound effect and music loop procedurally, so the game
 * ships with original, licence-free audio. Output: public/audio/*.wav (mono, 16-bit).
 * Re-runs only when this script changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../public/audio');
const SR = 22050;
const marker = path.join(outDir, '.version');
const version = crypto.createHash('sha1').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex');
if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === version) process.exit(0);
fs.mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------- DSP helpers
let seed = 12345;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const noise = () => rand() * 2 - 1;
const buf = (sec) => new Float32Array(Math.floor(sec * SR));
const TAU = Math.PI * 2;

function lowpass(x, cutoff) {
  const a = Math.exp((-TAU * cutoff) / SR);
  let y = 0;
  for (let i = 0; i < x.length; i++) x[i] = y = (1 - a) * x[i] + a * y;
  return x;
}
function highpass(x, cutoff) {
  const lp = lowpass(Float32Array.from(x), cutoff);
  for (let i = 0; i < x.length; i++) x[i] -= lp[i];
  return x;
}
function bandpass(x, f, q = 1) {
  // RBJ biquad band-pass
  const w = (TAU * f) / SR;
  const alpha = Math.sin(w) / (2 * q);
  const b0 = alpha, b2 = -alpha, a0 = 1 + alpha, a1 = -2 * Math.cos(w), a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i];
    const y0 = (b0 * x0 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    x[i] = y0;
  }
  return x;
}
function env(x, attack, decayPow = 1, hold = 0) {
  const n = x.length;
  const a = Math.max(1, Math.floor(attack * SR));
  const h = Math.floor(hold * SR);
  for (let i = 0; i < n; i++) {
    let g;
    if (i < a) g = i / a;
    else if (i < a + h) g = 1;
    else g = Math.pow(1 - (i - a - h) / Math.max(1, n - a - h), decayPow);
    x[i] *= g;
  }
  return x;
}
function mix(target, src, offsetSec = 0, gain = 1) {
  const o = Math.floor(offsetSec * SR);
  for (let i = 0; i < src.length && i + o < target.length; i++) target[i + o] += src[i] * gain;
  return target;
}
function tone(sec, freqFn, type = 'sine') {
  const x = buf(sec);
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    ph += (TAU * freqFn(t)) / SR;
    const p = (ph / TAU) % 1;
    x[i] = type === 'sine' ? Math.sin(ph) : type === 'saw' ? 2 * p - 1 : type === 'square' ? (p < 0.5 ? 1 : -1) : 1 - 4 * Math.abs(p - 0.5);
  }
  return x;
}
function noiseBuf(sec, color = 'white') {
  const x = buf(sec);
  let b = 0;
  for (let i = 0; i < x.length; i++) {
    if (color === 'brown') {
      b = (b + 0.02 * noise()) / 1.02;
      x[i] = b * 3.5;
    } else x[i] = noise();
  }
  return x;
}
function reverb(x, decay = 0.4, mixAmt = 0.3) {
  const taps = [0.029, 0.037, 0.041, 0.053, 0.067, 0.079];
  const y = Float32Array.from(x);
  for (const t of taps) {
    const d = Math.floor(t * SR * 3);
    const g = decay;
    const comb = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) comb[i] = x[i] + (i >= d ? comb[i - d] * g : 0);
    for (let i = 0; i < x.length; i++) y[i] += (comb[i] * mixAmt) / taps.length;
  }
  return y;
}
/** Crossfade the tail into the head so loops are seamless. */
function makeLoop(x, fadeSec = 0.6) {
  const f = Math.floor(fadeSec * SR);
  const out = x.slice(0, x.length - f);
  for (let i = 0; i < f; i++) {
    const k = i / f;
    out[i] = out[i] * k + x[x.length - f + i] * (1 - k);
  }
  return out;
}
function normalize(x, peak = 0.89) {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] = (x[i] / m) * peak;
  return x;
}
function writeWav(name, x, peak = 0.89) {
  normalize(x, peak);
  const data = Buffer.alloc(x.length * 2);
  for (let i = 0; i < x.length; i++) data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x[i] * 32767))), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(path.join(outDir, `${name}.wav`), Buffer.concat([h, data]));
}

// ---------------------------------------------------------------- sounds
const S = {};

S.ambient_forest = () => {
  const len = 14.6;
  const wind = noiseBuf(len, 'brown');
  lowpass(wind, 420);
  for (let i = 0; i < wind.length; i++) wind[i] *= 0.55 + 0.45 * Math.sin((TAU * i) / SR / 7.3) * Math.sin((TAU * i) / SR / 3.1 + 1);
  const out = Float32Array.from(wind);
  for (let c = 0; c < 26; c++) {
    const chirp = tone(0.09, () => 4200 + rand() * 600);
    for (let i = 0; i < chirp.length; i++) chirp[i] *= Math.sin((Math.PI * i) / chirp.length) * (0.5 + 0.5 * Math.sin((TAU * 70 * i) / SR));
    const at = rand() * (len - 1);
    for (let r = 0; r < 3; r++) mix(out, chirp, at + r * 0.13, 0.035);
  }
  // distant owl
  for (const at of [3.2, 10.4]) {
    const owl = tone(0.5, (t) => 380 - t * 60);
    env(owl, 0.08, 2);
    mix(out, lowpass(owl, 900), at, 0.08);
    mix(out, lowpass(Float32Array.from(owl), 900), at + 0.65, 0.06);
  }
  return makeLoop(out, 1.2);
};

S.ambient_asylum = () => {
  const len = 14.6;
  const hum = tone(len, () => 50);
  const hum2 = tone(len, () => 100.4);
  const air = lowpass(noiseBuf(len, 'brown'), 260);
  const out = buf(len);
  mix(out, hum, 0, 0.25);
  mix(out, hum2, 0, 0.12);
  mix(out, air, 0, 0.9);
  for (let d = 0; d < 9; d++) {
    const drip = tone(0.25, (t) => 1400 - t * 2600);
    env(drip, 0.002, 4);
    mix(out, drip, 0.4 + rand() * (len - 1.2), 0.18);
  }
  // far-off metallic creak
  const creak = tone(1.6, (t) => 180 + 40 * Math.sin(t * 9) + noise() * 20, 'saw');
  bandpass(creak, 600, 3);
  env(creak, 0.3, 1.5);
  mix(out, creak, 6.5, 0.1);
  return makeLoop(reverb(out, 0.55, 0.5), 1.2);
};

S.music_tension = () => {
  const len = 16.6;
  const out = buf(len);
  for (const [f, g] of [[55, 0.3], [82.4, 0.22], [55.4, 0.2], [116.5, 0.08]]) {
    const s = tone(len, () => f, 'saw');
    lowpass(s, 240);
    mix(out, s, 0, g);
  }
  for (let i = 0; i < out.length; i++) out[i] *= 0.7 + 0.3 * Math.sin((TAU * i) / SR / 8.3);
  const high = tone(len, (t) => 1244 + Math.sin(t * 0.7) * 6);
  for (let i = 0; i < high.length; i++) high[i] *= 0.5 + 0.5 * Math.sin((TAU * i) / SR / 5.5);
  mix(out, high, 0, 0.025);
  return makeLoop(reverb(out, 0.5, 0.4), 1.6);
};

S.music_chase = () => {
  const bpm = 132;
  const beat = 60 / bpm;
  const len = beat * 16 + 0.4;
  const out = buf(len);
  for (let b = 0; b < 16; b++) {
    const kick = tone(0.35, (t) => 120 * Math.exp(-t * 18) + 42);
    env(kick, 0.002, 3);
    mix(out, kick, b * beat, b % 4 === 0 ? 1 : 0.7);
    if (b % 2 === 1) {
      const hat = highpass(noiseBuf(0.06), 4000);
      env(hat, 0.001, 3);
      mix(out, hat, b * beat, 0.15);
    }
  }
  const bass = tone(len, (t) => (Math.floor(t / (beat * 4)) % 2 ? 46.25 : 43.65), 'saw');
  lowpass(bass, 180);
  for (let i = 0; i < bass.length; i++) bass[i] *= 0.6 + 0.4 * Math.sin((TAU * i * 4) / SR / beat);
  mix(out, bass, 0, 0.35);
  const screech = tone(len, (t) => 1480 + Math.sin(t * 31) * 18, 'saw');
  bandpass(screech, 1500, 4);
  for (let i = 0; i < screech.length; i++) screech[i] *= 0.4 + 0.6 * Math.abs(Math.sin((TAU * i) / SR / (beat * 8)));
  mix(out, screech, 0, 0.06);
  return makeLoop(out, 0.4);
};

S.heartbeat = () => {
  const out = buf(0.9);
  const thump = (f) => {
    const t = tone(0.22, (tt) => f * (1 + Math.exp(-tt * 40)));
    env(t, 0.004, 3);
    return lowpass(t, 140);
  };
  mix(out, thump(52), 0.0, 1);
  mix(out, thump(46), 0.24, 0.75);
  return out;
};

S.step_soft = () => {
  const x = noiseBuf(0.16);
  lowpass(x, 700);
  env(x, 0.005, 3);
  const thud = tone(0.1, () => 90);
  env(thud, 0.002, 4);
  return mix(x, thud, 0, 0.6);
};
S.step_hard = () => {
  const x = noiseBuf(0.14);
  bandpass(x, 1800, 1.4);
  env(x, 0.001, 5);
  const thud = tone(0.12, () => 110);
  env(thud, 0.002, 4);
  return reverb(mix(x, thud, 0, 0.7), 0.35, 0.25);
};
S.step_heavy = () => {
  const thud = tone(0.4, (t) => 60 - t * 30);
  env(thud, 0.003, 3);
  const n = lowpass(noiseBuf(0.4), 500);
  env(n, 0.003, 4);
  return reverb(mix(thud, n, 0, 0.6), 0.4, 0.3);
};

S.swing = () => {
  const x = noiseBuf(0.38);
  const out = buf(0.38);
  // swept band-pass via short blocks
  const block = 256;
  for (let s = 0; s < x.length; s += block) {
    const seg = x.slice(s, s + block);
    bandpass(seg, 3200 - (s / x.length) * 2600, 2);
    out.set(seg, s);
  }
  return env(out, 0.06, 2);
};

S.hit = () => {
  const thud = tone(0.5, (t) => 80 * Math.exp(-t * 6) + 40);
  env(thud, 0.002, 2.5);
  const crunch = lowpass(noiseBuf(0.3), 1600);
  env(crunch, 0.002, 3);
  return mix(thud, crunch, 0, 0.8);
};

function voice(len, f0, f1, formants) {
  const src = tone(len, (t) => f0 + (f1 - f0) * (t / len) + Math.sin(t * 30) * 4, 'saw');
  const out = buf(len);
  for (const [f, g] of formants) mix(out, bandpass(Float32Array.from(src), f, 5), 0, g);
  mix(out, lowpass(noiseBuf(len), 2000), 0, 0.15);
  return out;
}
S.hurt = () => env(voice(0.42, 210, 140, [[700, 1], [1150, 0.6], [2500, 0.25]]), 0.01, 1.6);
S.down = () => env(voice(1.0, 170, 95, [[600, 1], [1000, 0.5], [2400, 0.2]]), 0.03, 1.3);

S.roar = () => {
  const len = 2.3;
  const saw = tone(len, (t) => 62 + 18 * Math.sin(t * 7) + (t < 0.4 ? t * 60 : 24 - t * 4), 'saw');
  for (let i = 0; i < saw.length; i++) saw[i] *= 0.6 + 0.4 * Math.sin((TAU * 31 * i) / SR);
  const growl = lowpass(noiseBuf(len), 900);
  const out = buf(len);
  mix(out, lowpass(saw, 1200), 0, 1);
  mix(out, growl, 0, 0.7);
  mix(out, bandpass(Float32Array.from(saw), 420, 3), 0, 0.8);
  env(out, 0.15, 1.4, 0.5);
  return reverb(out, 0.5, 0.45);
};

S.gen_loop = () => {
  const len = 2.2;
  const out = buf(len);
  const motor = tone(len, () => 41, 'square');
  lowpass(motor, 300);
  mix(out, motor, 0, 0.5);
  const rattle = bandpass(noiseBuf(len), 1100, 2);
  for (let i = 0; i < rattle.length; i++) rattle[i] *= 0.5 + 0.5 * Math.sin((TAU * 13 * i) / SR);
  mix(out, rattle, 0, 0.6);
  return makeLoop(out, 0.2);
};
S.gen_fail = () => {
  const bang = lowpass(noiseBuf(0.9), 2500);
  env(bang, 0.001, 4);
  const out = Float32Array.from(bang);
  for (let k = 0; k < 18; k++) {
    const spark = highpass(noiseBuf(0.03), 3000);
    env(spark, 0.001, 2);
    mix(out, spark, 0.05 + rand() * 0.7, 0.5);
  }
  return reverb(out, 0.45, 0.4);
};
S.gen_done = () => {
  const out = buf(1.6);
  for (const [f, d] of [[220, 0], [277, 0.08], [330, 0.16], [440, 0.24]]) {
    const t = tone(1.3, () => f, 'tri');
    env(t, 0.02, 2);
    mix(out, t, d, 0.4);
  }
  return reverb(out, 0.4, 0.3);
};
S.power_on = () => {
  const len = 3.2;
  const thunk = tone(0.6, (t) => 70 - t * 40);
  env(thunk, 0.002, 3);
  const hum = tone(len, (t) => 30 + Math.min(1, t / 2) * 30, 'saw');
  lowpass(hum, 400);
  env(hum, 1.5, 0.6, 0.6);
  const out = buf(len);
  mix(out, thunk, 0, 1);
  mix(out, hum, 0, 0.6);
  return reverb(out, 0.55, 0.5);
};
S.door = () => {
  const len = 0.9;
  const creak = tone(len, (t) => 240 + 160 * Math.sin(t * 4) + noise() * 40, 'saw');
  bandpass(creak, 900, 2.5);
  for (let i = 0; i < creak.length; i++) creak[i] *= Math.abs(Math.sin((TAU * 22 * i) / SR)) > 0.3 ? 1 : 0.3;
  env(creak, 0.05, 1.2);
  return reverb(creak, 0.4, 0.3);
};
S.pallet = () => {
  const out = buf(0.8);
  const thud = tone(0.5, (t) => 70 - t * 30);
  env(thud, 0.002, 3);
  mix(out, thud, 0, 1);
  const crack = bandpass(noiseBuf(0.5), 700, 1);
  env(crack, 0.001, 3);
  mix(out, crack, 0, 1.2);
  return reverb(out, 0.4, 0.3);
};
S.locker = () => {
  const out = buf(0.7);
  for (const [f, g] of [[310, 1], [847, 0.6], [1670, 0.4], [2390, 0.25]]) {
    const t = tone(0.7, () => f);
    env(t, 0.001, 3);
    mix(out, t, 0, g);
  }
  return reverb(out, 0.45, 0.4);
};
S.key = () => {
  const out = buf(0.6);
  for (let k = 0; k < 6; k++) {
    const t = tone(0.2, () => 2600 + rand() * 1800);
    env(t, 0.001, 4);
    mix(out, t, k * 0.05 + rand() * 0.03, 0.4);
  }
  return out;
};
S.alarm = () => {
  const len = 2.4;
  const s = tone(len, (t) => 620 + 280 * Math.abs(Math.sin(t * Math.PI * 1.2)), 'tri');
  env(s, 0.05, 0.6, 1.6);
  return reverb(s, 0.5, 0.4);
};
S.skill_warn = () => env(tone(0.09, () => 1800), 0.001, 2);
S.skill_good = () => env(tone(0.35, () => 1046), 0.002, 2);
S.skill_great = () => {
  const out = buf(0.5);
  mix(out, env(tone(0.45, () => 1318), 0.002, 2), 0, 0.6);
  mix(out, env(tone(0.45, () => 1975), 0.002, 2), 0.05, 0.4);
  return out;
};
S.skill_fail = () => {
  const buzz = tone(0.5, () => 110, 'square');
  lowpass(buzz, 1200);
  env(buzz, 0.002, 2);
  return mix(buzz, S.gen_fail().slice(0, Math.floor(0.5 * SR)), 0, 0.4);
};
S.ui_click = () => env(bandpass(noiseBuf(0.05), 2500, 2), 0.001, 3);
S.ui_hover = () => env(tone(0.06, () => 1600), 0.002, 3);
S.flashlight = () => {
  const a = env(bandpass(noiseBuf(0.04), 3500, 3), 0.001, 4);
  return mix(buf(0.12), a, 0, 1);
};
S.shadow_step = () => {
  const len = 0.9;
  const n = noiseBuf(len);
  const out = buf(len);
  const block = 256;
  for (let s = 0; s < n.length; s += block) {
    const seg = n.slice(s, s + block);
    bandpass(seg, 300 + (s / n.length) * 2400, 1.5);
    out.set(seg, s);
  }
  for (let i = 0; i < out.length; i++) out[i] *= Math.pow(i / out.length, 1.5);
  const sub = tone(len, () => 38);
  env(sub, 0.5, 1);
  return reverb(mix(out, sub, 0, 0.6), 0.5, 0.5);
};
S.charge = () => {
  const out = buf(1.3);
  for (let k = 0; k < 4; k++) mix(out, S.step_heavy(), k * 0.27, 0.8);
  const growl = lowpass(tone(1.3, (t) => 70 + t * 30, 'saw'), 600);
  env(growl, 0.1, 1.2);
  return mix(out, growl, 0, 0.5);
};
S.echo = () => {
  const len = 2.4;
  const out = buf(len);
  const ping = tone(0.5, () => 880);
  env(ping, 0.002, 3);
  for (let k = 0; k < 5; k++) mix(out, ping, k * 0.38, Math.pow(0.55, k));
  return reverb(out, 0.5, 0.5);
};
S.firecracker = () => {
  const out = buf(1.4);
  for (let k = 0; k < 22; k++) {
    const pop = lowpass(noiseBuf(0.06), 3000);
    env(pop, 0.001, 5);
    mix(out, pop, k * 0.045 + rand() * 0.03, 0.6 + rand() * 0.4);
  }
  return reverb(out, 0.4, 0.3);
};
S.escape = () => {
  const len = 3;
  const out = buf(len);
  for (const f of [261.6, 329.6, 392, 523.2]) {
    const t = tone(len, () => f, 'tri');
    env(t, 0.6, 1.5);
    mix(out, t, 0, 0.3);
  }
  return reverb(out, 0.55, 0.5);
};
S.eliminated = () => {
  const len = 2.8;
  const boom = tone(len, (t) => 48 * Math.exp(-t * 0.6) + 22);
  env(boom, 0.004, 1.8);
  const n = lowpass(noiseBuf(len), 300);
  env(n, 0.004, 3);
  return reverb(mix(boom, n, 0, 0.5), 0.6, 0.6);
};
S.whisper = () => {
  const len = 1.8;
  const n = noiseBuf(len);
  const out = buf(len);
  for (const [f, g] of [[900, 1], [1700, 0.7], [2900, 0.4]]) mix(out, bandpass(Float32Array.from(n), f, 6), 0, g);
  for (let i = 0; i < out.length; i++) out[i] *= Math.sin((Math.PI * i) / out.length) * (0.6 + 0.4 * Math.sin((TAU * 5 * i) / SR));
  return reverb(out, 0.5, 0.5);
};
S.breath = () => {
  const len = 1.6;
  const n = bandpass(noiseBuf(len), 1200, 0.8);
  for (let i = 0; i < n.length; i++) {
    const t = i / SR;
    n[i] *= t < 0.7 ? Math.sin((Math.PI * t) / 0.7) : 0.7 * Math.sin((Math.PI * (t - 0.7)) / 0.9);
  }
  return n;
};
S.cage = () => {
  const out = buf(1.0);
  for (let k = 0; k < 5; k++) mix(out, S.locker().slice(0, Math.floor(0.4 * SR)), k * 0.11, 0.5);
  return out;
};

let count = 0;
for (const [name, fn] of Object.entries(S)) {
  writeWav(name, fn(), name.startsWith('ambient') || name.startsWith('music') ? 0.7 : 0.89);
  count++;
}
fs.writeFileSync(marker, version);
console.log(`[audio] generated ${count} sounds in ${path.relative(process.cwd(), outDir)}`);
