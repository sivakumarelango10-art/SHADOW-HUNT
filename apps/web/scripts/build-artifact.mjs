// Packs the `vite build --mode artifact` output into one self-contained HTML page:
// scripts, styles, fonts and every sound inlined, no network requests at all.
// Output: apps/web/dist-artifact/shadow-hunt.html (published as a claude.ai Artifact).
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(import.meta.dirname, '../dist-artifact');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const read = (rel) => fs.readFileSync(path.join(dir, rel.replace(/^\.\//, '')), 'utf8');

const js = [...html.matchAll(/<script type="module" crossorigin src="([^"]+)"><\/script>/g)].map((m) => read(m[1]));
const css = [...html.matchAll(/<link rel="stylesheet" crossorigin href="([^"]+)">/g)].map((m) => read(m[1]));
if (js.length !== 1 || css.length !== 1) throw new Error(`expected one script and one stylesheet, got ${js.length}/${css.length}`);
if (/import\(\s*["'`]\.\//.test(js[0])) throw new Error('bundle still has dynamic chunks');

const audioDir = path.join(dir, 'audio');
const audio = Object.fromEntries(
  fs
    .readdirSync(audioDir)
    .filter((f) => f.endsWith('.wav'))
    .map((f) => [f.slice(0, -4), `data:audio/wav;base64,${fs.readFileSync(path.join(audioDir, f)).toString('base64')}`]),
);

const safe = (s) => s.replace(/<\/(script|style)/gi, '<\\/$1');
const out = `<title>Shadow Hunt</title>
<meta name="theme-color" content="#07080a">
<style>html,body{height:100%;background:#07080a;color:#d9d4cc;margin:0;overflow:hidden}#root{height:100%}</style>
<style>${safe(css[0])}</style>
<div id="root"></div>
<script>window.__SH_AUDIO=${JSON.stringify(audio)};</script>
<script type="module">${safe(js[0])}</script>
`;
const file = path.join(dir, 'shadow-hunt.html');
fs.writeFileSync(file, out);
console.log(`${path.relative(process.cwd(), file)}: ${(out.length / 1024 / 1024).toFixed(2)} MB, ${Object.keys(audio).length} sounds`);
