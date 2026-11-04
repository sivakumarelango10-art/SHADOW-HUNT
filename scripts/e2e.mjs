#!/usr/bin/env node
/**
 * Browser end-to-end check. Boots the real game server and the web client, then
 * drives three real browsers (two desktop, one landscape phone) through:
 * menu → create room → join by invite link → lobby → match → movement sync,
 * and a second solo match against the bot hunter in the asylum.
 * Screenshots land in ./test-results/. Exits non-zero on any failure or page error.
 *
 *   node scripts/e2e.mjs            (uses system Chrome; set CHROME_PATH to override)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'test-results');
fs.mkdirSync(out, { recursive: true });
const SERVER_PORT = 2570;
const WEB_PORT = 5199;
const WEB = `http://localhost:${WEB_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
const errors = [];
let step = 0;

function start(cmd, args, cwd, env) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  p.stdout.on('data', (d) => process.env.E2E_VERBOSE && process.stdout.write(`[${path.basename(cwd)}] ${d}`));
  p.stderr.on('data', (d) => process.env.E2E_VERBOSE && process.stderr.write(`[${path.basename(cwd)}] ${d}`));
  procs.push(p);
  return p;
}
async function waitHttp(url, ms = 60000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await sleep(300);
  }
  throw new Error(`timeout waiting for ${url}`);
}
async function waitFor(page, fn, label, ms = 20000, arg) {
  try {
    await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
  } catch (e) {
    throw new Error(`timeout: ${label}`, { cause: e });
  }
}
const shot = async (page, name) => {
  step++;
  const file = path.join(out, `${String(step).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  📸 ${path.relative(root, file)}`);
};
const check = (cond, msg) => {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
  console.log(`  ✓ ${msg}`);
};
const state = (page) => page.evaluate(() => window.__shadowHunt?.state());
const sid = (page) => page.evaluate(() => window.__shadowHunt?.sessionId());

const pages = [];
async function main() {
  console.log('▶ starting server and web client');
  start('npx', ['tsx', 'src/index.ts'], path.join(root, 'apps/server'), {
    PORT: String(SERVER_PORT),
    STORE: 'memory',
    LOG_LEVEL: 'silent',
  });
  start('npx', ['vite', '--port', String(WEB_PORT), '--strictPort'], path.join(root, 'apps/web'), {
    VITE_SERVER_URL: `http://localhost:${SERVER_PORT}`,
  });
  await waitHttp(`http://localhost:${SERVER_PORT}/api/health`);
  await waitHttp(WEB);

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    headless: true,
    args: [
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
    ],
  });
  const mk = async (name, opts) => {
    const ctx = await browser.newContext(opts);
    // Software-rendered WebGL on CI is slow: run the low preset so several browsers fit on a small machine.
    await ctx.addInitScript(() => {
      localStorage.setItem(
        'sh.settings',
        JSON.stringify({
          state: {
            quality: 'low',
            renderScale: 0.5,
            shadows: false,
            antialias: false,
            postFx: false,
            renderDistance: 45,
            fogQuality: 'low',
            textureQuality: 'low',
          },
          version: 1,
        }),
      );
    });
    ctx.setDefaultTimeout(60000);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/WebSocket|favicon|net::ERR|Failed to load resource/i.test(m.text()))
        errors.push(`[${name}] console: ${m.text()}`);
    });
    pages.push([name, page]);
    return page;
  };

  const A = await mk('host', { viewport: { width: 1280, height: 720 } });
  const B = await mk('hunter', { viewport: { width: 1280, height: 720 } });
  const C = await mk('phone', {
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });

  console.log('▶ main menu');
  await A.goto(WEB);
  await A.getByRole('button', { name: /^Play/ }).waitFor({ timeout: 30000 });
  await sleep(1500);
  await shot(A, 'menu');

  console.log('▶ create private room');
  await A.getByRole('button', { name: /^Play/ }).click();
  await A.getByRole('button', { name: /Create Room/ }).click();
  await waitFor(A, () => window.__shadowHunt?.state()?.roomCode, 'room created');
  const code = (await state(A)).roomCode;
  check(/^[A-Z2-9]{6}$/.test(code), `room code ${code}`);

  console.log('▶ friends join via invite link');
  await B.goto(`${WEB}/?room=${code}`);
  await C.goto(`${WEB}/?room=${code}`);
  await waitFor(A, () => Object.keys(window.__shadowHunt?.state()?.players ?? {}).length === 3, 'three players in lobby', 30000);
  check(true, 'three players see the same lobby');
  // Wait until each joiner's lobby is fully rendered (software WebGL makes first paint slow).
  for (const p of [B, C])
    await waitFor(
      p,
      () => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Ready up'),
      'joiner lobby',
      60000,
    );
  await B.getByRole('switch').click();
  await waitFor(
    A,
    (id) => window.__shadowHunt.state().players[id]?.preferHunter === true,
    'hunter preference replicated',
    5000,
    await sid(B),
  );
  await B.getByRole('button', { name: 'Ready up' }).click();
  await C.getByRole('button', { name: 'Ready up' }).click();
  await waitFor(A, () => Object.values(window.__shadowHunt.state().players).every((p) => p.ready || p.isHost), 'all ready');
  await sleep(500);
  await shot(A, 'lobby-host');
  await shot(C, 'lobby-phone');

  console.log('▶ start match (Blackwood Forest)');
  await A.getByRole('button', { name: /Start the hunt/ }).click();
  await waitFor(A, () => ['countdown', 'playing'].includes(window.__shadowHunt.state()?.phase), 'match starting');
  await shot(B, 'countdown-hunter');
  await waitFor(A, () => window.__shadowHunt.state()?.phase === 'playing', 'playing', 15000);
  const s0 = await state(A);
  const bId = await sid(B);
  const aId = await sid(A);
  check(s0.players[bId].role === 'hunter', 'volunteer became the hunter');
  check(s0.players[aId].role === 'survivor', 'host is a survivor');
  await sleep(2500);
  await shot(A, 'forest-survivor');
  await shot(B, 'forest-hunter');
  await shot(C, 'forest-phone');

  console.log('▶ movement replicates through the server');
  const before = (await state(B)).players[aId];
  await A.keyboard.down('KeyW');
  await sleep(1800);
  await A.keyboard.up('KeyW');
  await sleep(500);
  const after = (await state(B)).players[aId];
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  check(moved > 2.5, `survivor moved ${moved.toFixed(2)} m and the hunter's client saw it`);

  console.log('▶ flashlight toggles on server');
  await A.keyboard.press('KeyF');
  await waitFor(B, (id) => window.__shadowHunt.state().players[id].flashlight === true, 'flashlight replicated', 5000, aId);
  check(true, 'flashlight state replicated to other clients');
  await sleep(600);
  await shot(A, 'forest-flashlight');

  console.log('▶ hunter swing is server-validated (miss at range)');
  await B.keyboard.down('KeyW');
  await sleep(1200);
  await B.keyboard.up('KeyW');
  await B.mouse.click(640, 360);
  await sleep(300);
  const s1 = await state(A);
  check(s1.players[aId].condition === 'healthy', 'distant survivor not hit by a swing');

  console.log('▶ solo match vs bot hunter in the Asylum');
  // Free the CPU: software WebGL in four browsers at once is very slow.
  for (const p of [A, B, C]) await p.close();
  const D = await mk('solo', { viewport: { width: 1280, height: 720 } });
  await D.goto(WEB);
  await D.getByRole('button', { name: /^Play/ }).waitFor({ timeout: 30000 });
  await D.getByRole('button', { name: /^Play/ }).click();
  await D.getByRole('button', { name: /Create Room/ }).click();
  await waitFor(D, () => window.__shadowHunt?.state()?.roomCode, 'solo room');
  await D.getByRole('button', { name: /Abandoned Asylum/ }).click();
  await D.getByRole('button', { name: 'Bot', exact: true }).click();
  await waitFor(
    D,
    () => window.__shadowHunt.state().hunterMode === 'bot' && window.__shadowHunt.state().mapId === 'asylum',
    'solo settings',
  );
  await D.getByRole('button', { name: /Start the hunt/ }).click();
  await waitFor(D, () => window.__shadowHunt.state()?.phase === 'playing', 'solo playing', 60000);
  const sd = await state(D);
  const bot = Object.values(sd.players).find((p) => p.isBot);
  check(bot && bot.role === 'hunter', `bot hunter spawned (${bot?.name})`);
  await sleep(2500);
  await shot(D, 'asylum-survivor');
  await D.keyboard.press('KeyF');
  await sleep(800);
  await shot(D, 'asylum-flashlight');
  await sleep(4000);
  const sNow = await state(D);
  const botNow = sNow.players[bot.sessionId];
  const meNow = sNow.players[await sid(D)];
  const leftSpawn = Math.hypot(botNow.x - 0, botNow.z - -16) > 3; // asylum hunter spawn (0, -16)
  check(
    leftSpawn || meNow.condition !== 'healthy',
    `bot hunter is hunting (left spawn: ${leftSpawn}, survivor: ${meNow.condition})`,
  );
  await shot(D, 'asylum-later');

  await browser.close();
  if (errors.length) {
    console.error('\nPage errors:\n' + errors.map((e) => `  ✗ ${e}`).join('\n'));
    throw new Error(`${errors.length} page error(s)`);
  }
  console.log('\n✅ e2e passed');
}

main()
  .catch(async (e) => {
    console.error(`\n❌ ${e.message}`);
    for (const [name, page] of pages)
      if (!page.isClosed()) await page.screenshot({ path: path.join(out, `fail-${name}.png`) }).catch(() => {});
    if (errors.length) console.error(errors.join('\n'));
    process.exitCode = 1;
  })
  .finally(() => {
    for (const p of procs) {
      try {
        process.kill(-p.pid, 'SIGTERM'); // whole process group (npx → tsx/vite)
      } catch {}
    }
    setTimeout(() => process.exit(), 500);
  });
