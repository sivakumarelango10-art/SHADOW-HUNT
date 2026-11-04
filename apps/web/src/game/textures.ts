import * as THREE from 'three';
import { mulberry32 } from '@shadow-hunt/shared';

/**
 * Procedural canvas textures. Generated once at runtime (no downloads, no licences),
 * with matching roughness maps so wet patches catch the flashlight.
 */
type Painter = (ctx: CanvasRenderingContext2D, size: number, rnd: () => number) => void;

const cache = new Map<string, THREE.Texture>();
let lowRes = false;
export function setTextureQuality(low: boolean) {
  if (low !== lowRes) cache.clear();
  lowRes = low;
}

function make(key: string, painter: Painter, opts: { repeat?: number; color?: boolean } = {}): THREE.Texture {
  const k = `${key}:${lowRes}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const size = lowRes ? 256 : 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  painter(ctx, size, mulberry32(hash(key)));
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = lowRes ? 1 : 4;
  if (opts.color !== false) tex.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) tex.repeat.set(opts.repeat, opts.repeat);
  cache.set(k, tex);
  return tex;
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function speckle(ctx: CanvasRenderingContext2D, size: number, rnd: () => number, n: number, colors: string[], rMin: number, rMax: number, alpha = 0.5) {
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = alpha * rnd();
    ctx.fillStyle = colors[Math.floor(rnd() * colors.length)]!;
    const r = rMin + rnd() * (rMax - rMin);
    const x = rnd() * size;
    const y = rnd() * size;
    // Draw wrapped so the texture tiles seamlessly.
    for (const ox of [-size, 0, size])
      for (const oy of [-size, 0, size]) {
        if (x + ox + r < 0 || x + ox - r > size || y + oy + r < 0 || y + oy - r > size) continue;
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        ctx.fill();
      }
  }
  ctx.globalAlpha = 1;
}

export const tex = {
  forestFloor: () =>
    make('forest', (ctx, s, r) => {
      ctx.fillStyle = '#1a1d16';
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, r, 900, ['#2a2f22', '#13150f', '#2f2a1f', '#232a1b'], s * 0.01, s * 0.06, 0.5);
      speckle(ctx, s, r, 2600, ['#3b3a2c', '#0d0e0b', '#4a3f2b'], 0.5, s * 0.006, 0.7);
      // pine needles
      ctx.strokeStyle = '#3d3423';
      for (let i = 0; i < 700; i++) {
        ctx.globalAlpha = 0.35 * r();
        const x = r() * s;
        const y = r() * s;
        const a = r() * Math.PI;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * 7, y + Math.sin(a) * 7);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }),
  forestRough: () =>
    make('forestRough', (ctx, s, r) => {
      ctx.fillStyle = '#e0e0e0';
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, r, 40, ['#404040', '#606060'], s * 0.04, s * 0.12, 0.6); // wet puddles
    }, { color: false }),
  gravel: () =>
    make('gravel', (ctx, s, r) => {
      ctx.fillStyle = '#26272a';
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, r, 4000, ['#3a3b3f', '#17181a', '#4b4a46', '#2f2b26'], 0.8, s * 0.008, 0.9);
    }),
  tileFloor: () =>
    make('tileFloor', (ctx, s, r) => {
      const n = 8;
      const c = s / n;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const v = (i + j) % 2 ? 42 : 58;
          const k = Math.floor(r() * 8);
          ctx.fillStyle = `rgb(${v + k},${v + k + 2},${v + k + 1})`;
          ctx.fillRect(i * c, j * c, c, c);
        }
      ctx.strokeStyle = '#141617';
      ctx.lineWidth = 2;
      for (let i = 0; i <= n; i++) {
        ctx.beginPath();
        ctx.moveTo(i * c, 0);
        ctx.lineTo(i * c, s);
        ctx.moveTo(0, i * c);
        ctx.lineTo(s, i * c);
        ctx.stroke();
      }
      speckle(ctx, s, r, 60, ['#2a2016', '#1a1a14', '#3a1414'], s * 0.02, s * 0.1, 0.35);
      speckle(ctx, s, r, 1500, ['#000000', '#6a6a60'], 0.5, 2, 0.4);
    }),
  tileRough: () =>
    make('tileRough', (ctx, s, r) => {
      ctx.fillStyle = '#909090';
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, r, 30, ['#202020', '#353535'], s * 0.05, s * 0.14, 0.7);
    }, { color: false }),
  asylumWall: () =>
    make('asylumWall', (ctx, s, r) => {
      // upper plaster, lower tiled wainscot
      ctx.fillStyle = '#5f6559';
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, r, 400, ['#4a4f45', '#6e7365', '#3e3a30'], s * 0.01, s * 0.05, 0.4);
      const split = s * 0.62;
      ctx.fillStyle = '#3c4a48';
      ctx.fillRect(0, split, s, s - split);
      ctx.strokeStyle = '#1e2524';
      ctx.lineWidth = 2;
      const t = s / 10;
      for (let y = split; y < s; y += t) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(s, y);
        ctx.stroke();
      }
      for (let x = 0; x <= s; x += t) {
        ctx.beginPath();
        ctx.moveTo(x, split);
        ctx.lineTo(x, s);
        ctx.stroke();
      }
      ctx.fillStyle = '#2a302d';
      ctx.fillRect(0, split - 6, s, 8);
      // grime streaks
      for (let i = 0; i < 40; i++) {
        const x = r() * s;
        const g = ctx.createLinearGradient(x, 0, x, s * (0.3 + r() * 0.7));
        g.addColorStop(0, 'rgba(30,24,16,0.45)');
        g.addColorStop(1, 'rgba(30,24,16,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x, 0, 2 + r() * 8, s);
      }
      speckle(ctx, s, r, 12, ['#4a1010'], s * 0.01, s * 0.04, 0.4);
    }),
  concrete: () =>
    make('concrete', (ctx, s, r) => {
      ctx.fillStyle = '#3b3c3d';
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, r, 700, ['#2c2d2e', '#4a4a48', '#33302b'], s * 0.01, s * 0.07, 0.35);
      speckle(ctx, s, r, 3000, ['#1a1a1a', '#5a5a58'], 0.5, 1.6, 0.6);
      ctx.strokeStyle = 'rgba(20,20,20,0.6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, s, s);
    }),
  wood: () =>
    make('wood', (ctx, s, r) => {
      const planks = 6;
      const h = s / planks;
      for (let i = 0; i < planks; i++) {
        const v = 38 + Math.floor(r() * 18);
        ctx.fillStyle = `rgb(${v + 12},${v + 4},${v - 6})`;
        ctx.fillRect(0, i * h, s, h);
        ctx.strokeStyle = 'rgba(15,10,6,0.5)';
        for (let k = 0; k < 14; k++) {
          ctx.globalAlpha = 0.3 + r() * 0.4;
          ctx.beginPath();
          const y = i * h + r() * h;
          ctx.moveTo(0, y);
          ctx.bezierCurveTo(s * 0.3, y + r() * 6 - 3, s * 0.6, y + r() * 6 - 3, s, y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#120c08';
        ctx.fillRect(0, i * h, s, 3);
      }
    }),
  bark: () =>
    make('bark', (ctx, s, r) => {
      ctx.fillStyle = '#231c16';
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 160; i++) {
        ctx.strokeStyle = r() > 0.5 ? '#120e0b' : '#3a2e24';
        ctx.lineWidth = 1 + r() * 3;
        ctx.globalAlpha = 0.6;
        const x = r() * s;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        for (let y = 0; y <= s; y += s / 8) ctx.lineTo(x + (r() - 0.5) * 10, y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      speckle(ctx, s, r, 80, ['#2e3a24'], s * 0.01, s * 0.04, 0.4);
    }),
  metal: () =>
    make('metal', (ctx, s, r) => {
      ctx.fillStyle = '#3a3e42';
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, r, 200, ['#5a3a24', '#6a4020', '#2a2c2e'], s * 0.01, s * 0.08, 0.45);
      for (let i = 0; i < 200; i++) {
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = '#7a7e82';
        ctx.fillRect(r() * s, r() * s, r() * s * 0.3, 1);
      }
      ctx.globalAlpha = 1;
    }),
  foliage: () =>
    make('foliage', (ctx, s, r) => {
      ctx.fillStyle = '#121a14';
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, r, 1400, ['#1c2a1e', '#0a0f0b', '#24321f', '#172018'], 1, s * 0.02, 0.8);
    }),
  grassBlade: () =>
    make('grass', (ctx, s, r) => {
      ctx.clearRect(0, 0, s, s);
      for (let i = 0; i < 38; i++) {
        const x = s * 0.1 + r() * s * 0.8;
        const h = s * (0.4 + r() * 0.55);
        const lean = (r() - 0.5) * s * 0.25;
        const g = ctx.createLinearGradient(0, s, 0, s - h);
        g.addColorStop(0, '#0f140c');
        g.addColorStop(1, r() > 0.5 ? '#3a4628' : '#4a4630');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x - 3, s);
        ctx.quadraticCurveTo(x + lean * 0.5, s - h * 0.6, x + lean, s - h);
        ctx.quadraticCurveTo(x + lean * 0.5 + 2, s - h * 0.6, x + 3, s);
        ctx.fill();
      }
    }),
  blood: () =>
    make('blood', (ctx, s, r) => {
      ctx.clearRect(0, 0, s, s);
      ctx.fillStyle = '#3d0507';
      for (let i = 0; i < 26; i++) {
        ctx.globalAlpha = 0.5 + r() * 0.5;
        ctx.beginPath();
        const cx = s / 2 + (r() - 0.5) * s * 0.5;
        const cy = s / 2 + (r() - 0.5) * s * 0.5;
        ctx.ellipse(cx, cy, r() * s * 0.15 + 4, r() * s * 0.1 + 3, r() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }),
  paper: () =>
    make('paper', (ctx, s, r) => {
      ctx.fillStyle = '#b8b2a0';
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = '#4a4740';
      for (let y = s * 0.12; y < s * 0.9; y += s * 0.06) ctx.fillRect(s * 0.1, y, s * (0.5 + r() * 0.3), 2);
      speckle(ctx, s, r, 30, ['#6a5a3a'], s * 0.02, s * 0.1, 0.3);
    }),
  glow: () =>
    make('glow', (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }),
  beam: () =>
    make('beam', (ctx, s) => {
      const g = ctx.createLinearGradient(0, 0, 0, s);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }, { color: false }),
};
