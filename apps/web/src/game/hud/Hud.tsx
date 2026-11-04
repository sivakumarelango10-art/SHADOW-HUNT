import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ABILITIES, CHARACTERS, HUNTER, PLAYER, itemLabel, type CharacterId, type ItemKind } from '@shadow-hunt/shared';
import { useHud } from '../../stores/hud';
import { useRoom, type PlayerView, type RoomSnapshot } from '../../stores/room';
import { isMobile, useSettings } from '../../stores/settings';
import { leaveRoom } from '../../multiplayer/net';
import { SkillCheck } from './SkillCheck';
import { MobileControls } from './MobileControls';
import { SettingsPanel } from '../../pages/SettingsPage';
import { input } from '../controls/input';
import { abilityText } from './abilityText';

/** On touch screens the bottom corners belong to the thumbs, so vitals sit top-left. */
const TOUCH_VITALS = 'top-[104px] left-3 origin-top-left scale-[0.72]';

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const CONDITION: Record<string, { label: string; color: string }> = {
  healthy: { label: 'Healthy', color: '#9fd39a' },
  injured: { label: 'Injured', color: '#e0a040' },
  rescued: { label: 'Rescued', color: '#e0c040' },
  downed: { label: 'Downed', color: '#ff4040' },
  captured: { label: 'Caged', color: '#ff2020' },
  escaped: { label: 'Escaped', color: '#7dd3fc' },
  eliminated: { label: 'Dead', color: '#5a5a5a' },
};

export function Hud({ snap, me }: { snap: RoomSnapshot; me: PlayerView }) {
  const paused = useHud((s) => s.paused);
  const showStatus = useHud((s) => s.showStatus);
  const connection = useRoom((s) => s.connection);
  const survivor = me.role === 'survivor';
  const touch = isMobile || (typeof window !== 'undefined' && 'ontouchstart' in window && navigator.maxTouchPoints > 0);
  const alive = me.condition !== 'escaped' && me.condition !== 'eliminated';

  return (
    <div className="pointer-events-none absolute inset-0 z-10 font-sans text-bone">
      <TerrorVignette />
      <HitFlash />
      {me.hiddenIn && <LockerOverlay />}
      {survivor && me.condition === 'downed' && (
        <StateBanner
          title="You are down"
          sub={`Bleeding out · ${Math.ceil(me.bleedTimer)}s — crawl to cover, wait for help`}
          tone="danger"
        />
      )}
      {survivor && me.condition === 'captured' && (
        <StateBanner
          title="Caged"
          sub={`${Math.ceil(me.captureTimer)}s until you are taken · ${me.captureStage >= 2 ? 'last chance' : 'teammates can break the cage'}`}
          tone="danger"
        />
      )}
      {snap.phase === 'countdown' && <Countdown snap={snap} me={me} />}
      {snap.phase === 'playing' && (
        <>
          <ObjectiveBar snap={snap} me={me} />
          <TeamList snap={snap} me={me} />
          {alive && (survivor ? <SurvivorVitals me={me} touch={touch} /> : <HunterVitals me={me} snap={snap} touch={touch} />)}
          {alive && <Prompt />}
          {alive && <Crosshair />}
          <SkillCheck />
          <Spectating />
          {touch && alive && !paused && (
            <div className="pointer-events-auto">
              <MobileControls role={me.role} hasItem={!!me.item} />
            </div>
          )}
        </>
      )}
      <Feed />
      <Notices />
      {showStatus && <StatusBoard snap={snap} />}
      {connection === 'reconnecting' && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 rounded-lg border border-ember/40 bg-black/70 px-4 py-2 text-sm text-ember">
          Connection lost — reconnecting…
        </div>
      )}
      <Fps />
      {paused && <PauseMenu />}
      {!touch && snap.phase === 'playing' && !paused && <PointerHint />}
    </div>
  );
}

function PointerHint() {
  const [locked, setLocked] = useState(input.pointerLocked);
  useEffect(() => {
    const on = () => setLocked(!!document.pointerLockElement);
    document.addEventListener('pointerlockchange', on);
    return () => document.removeEventListener('pointerlockchange', on);
  }, []);
  if (locked) return null;
  return (
    <div className="absolute top-1/2 left-1/2 mt-16 -translate-x-1/2 rounded-md bg-black/60 px-3 py-1.5 text-xs tracking-widest text-ash uppercase">
      Click to look around
    </div>
  );
}

function Countdown({ snap, me }: { snap: RoomSnapshot; me: PlayerView }) {
  const def = CHARACTERS[me.characterId as CharacterId];
  const hunter = snap.players.find((p) => p.role === 'hunter');
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <div className="label mb-3">{me.role === 'hunter' ? 'You are the hunter' : 'You are a survivor'}</div>
        <div className={`heading text-5xl md:text-6xl ${me.role === 'hunter' ? 'text-blood' : ''}`}>{def?.name}</div>
        <div className="mt-2 text-ash italic">{def?.tagline}</div>
        <div className="mx-auto mt-6 max-w-md text-sm text-ash">
          {me.role === 'hunter'
            ? `Find them. Hit twice to down, then cage them. ${def?.ability ? abilityText(def.ability) : ''}`
            : `Repair generators, find the access keys, open a gate and escape. ${hunter?.isBot ? 'The hunter is controlled by the dark itself.' : `${hunter?.name ?? 'Someone'} is hunting you.`}`}
        </div>
        <div className="heading mt-8 text-7xl text-bone/90">{Math.ceil(snap.countdown)}</div>
      </motion.div>
    </div>
  );
}

function ObjectiveBar({ snap, me }: { snap: RoomSnapshot; me: PlayerView }) {
  const survivors = snap.players.filter((p) => p.role === 'survivor');
  const remaining = survivors.filter((p) => p.condition !== 'escaped' && p.condition !== 'eliminated').length;
  let text: string;
  if (me.role === 'hunter') text = `Hunt them down — ${remaining} remaining`;
  else if (!snap.powerOn) text = `Repair generators`;
  else if (snap.keysDeposited < snap.keysRequired) text = `Find access keys and insert them at an exit panel`;
  else if (snap.exitsOpen === 0) text = `Open an exit gate`;
  else text = `ESCAPE`;
  const low = snap.timeLeft < 60;
  return (
    <div className="absolute top-3 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1.5">
      <div className="flex items-center gap-3 rounded-full border border-line bg-black/55 px-4 py-1.5 backdrop-blur-sm">
        <span className={`font-mono text-sm tabular-nums ${low ? 'animate-pulse text-blood' : 'text-bone'}`}>
          {fmtTime(snap.timeLeft)}
        </span>
        <span className="h-3 w-px bg-line-strong" />
        <span className="flex items-center gap-1" title="Generators">
          {Array.from({ length: snap.generatorsRequired }, (_, i) => (
            <span
              key={i}
              className={`h-2.5 w-2.5 rotate-45 border ${i < snap.generatorsCompleted ? 'border-amber-200 bg-amber-200 shadow-[0_0_8px_#fcd34d]' : 'border-ash/60'}`}
            />
          ))}
        </span>
        <span className="h-3 w-px bg-line-strong" />
        <span className={`text-xs tracking-wider ${snap.powerOn ? 'text-bone' : 'text-dim'}`}>
          ⚷ {snap.keysDeposited}/{snap.keysRequired}
        </span>
        {snap.exitsOpen > 0 && (
          <span className="text-xs font-semibold tracking-widest text-emerald-300 uppercase">Exit open</span>
        )}
      </div>
      <div
        className={`text-[11px] font-semibold tracking-[0.25em] uppercase ${text === 'ESCAPE' ? 'animate-pulse text-emerald-300' : 'text-ash'}`}
      >
        {text}
      </div>
    </div>
  );
}

function TeamList({ snap, me }: { snap: RoomSnapshot; me: PlayerView }) {
  const survivors = snap.players.filter((p) => p.role === 'survivor');
  return (
    <div className="absolute top-3 left-3 flex flex-col gap-1.5">
      {survivors.map((p) => {
        const c = CONDITION[p.condition] ?? CONDITION.healthy!;
        return (
          <div
            key={p.sessionId}
            className={`flex min-w-40 items-center gap-2 rounded-md border border-line bg-black/45 px-2 py-1 backdrop-blur-sm ${p.sessionId === me.sessionId ? 'border-bone/30' : ''}`}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: c.color, boxShadow: `0 0 6px ${c.color}` }} />
            <span className={`max-w-24 truncate text-xs ${p.condition === 'eliminated' ? 'text-dim line-through' : ''}`}>
              {p.name}
            </span>
            <span className="ml-auto text-[10px] tracking-wider uppercase" style={{ color: c.color }}>
              {p.condition === 'captured'
                ? `${Math.ceil(p.captureTimer)}s`
                : p.condition === 'downed'
                  ? `${Math.ceil(p.bleedTimer)}s`
                  : c.label}
            </span>
            {p.carryingKey && (
              <span title="Carrying a key" className="text-[10px] text-amber-300">
                ⚷
              </span>
            )}
            {!p.connected && <span className="text-[10px] text-ember">offline</span>}
          </div>
        );
      })}
    </div>
  );
}

function Bar({ value, color, label, pulse }: { value: number; color: string; label: string; pulse?: boolean }) {
  return (
    <div className="w-44">
      <div className="mb-0.5 flex justify-between text-[10px] tracking-[0.2em] text-ash uppercase">
        <span>{label}</span>
        <span className="tabular-nums">{Math.round(value)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-[width] duration-150 ${pulse ? 'animate-pulse' : ''}`}
          style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }}
        />
      </div>
    </div>
  );
}

function SurvivorVitals({ me, touch }: { me: PlayerView; touch: boolean }) {
  const stamina = useHud((s) => s.stamina);
  const exhausted = useHud((s) => s.exhausted);
  return (
    <div
      className={`absolute flex flex-col gap-2.5 rounded-xl border border-line bg-black/45 p-3 backdrop-blur-sm ${touch ? TOUCH_VITALS : 'bottom-4 left-4'}`}
    >
      <div className="flex items-center gap-2">
        {Array.from({ length: PLAYER.maxHealth }, (_, i) => (
          <span
            key={i}
            className={`h-3 w-6 rounded-sm border ${i < me.health ? 'border-blood bg-blood shadow-[0_0_8px_var(--color-blood)]' : 'border-white/20'}`}
          />
        ))}
        <span className="ml-1 text-[11px] tracking-widest uppercase" style={{ color: CONDITION[me.condition]?.color }}>
          {CONDITION[me.condition]?.label}
        </span>
      </div>
      <Bar
        value={stamina}
        color={exhausted ? '#7a3a3a' : '#c9c2b2'}
        label={exhausted ? 'Exhausted' : 'Stamina'}
        pulse={exhausted}
      />
      <Bar
        value={me.battery}
        color={me.battery < 20 ? '#d9783a' : '#a8bcd8'}
        label={`Flashlight ${me.flashlight ? 'on' : 'off'}`}
      />
      <div className="flex items-center gap-2 text-[11px] tracking-wider text-ash">
        <span className="rounded border border-line px-1.5 py-0.5">
          {me.item ? `G · ${itemLabel(me.item as ItemKind)}` : 'No item'}
        </span>
        {me.carryingKey && <span className="rounded border border-amber-300/40 px-1.5 py-0.5 text-amber-200">⚷ Access key</span>}
      </div>
    </div>
  );
}

function Cooldown({ label, value, max, keyHint }: { label: string; value: number; max: number; keyHint: string }) {
  const k = max > 0 ? 1 - Math.min(1, value / max) : 1;
  const ready = value <= 0.01;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative h-14 w-14">
        <svg viewBox="0 0 40 40" className="h-full w-full -rotate-90">
          <circle cx="20" cy="20" r="17" fill="rgba(0,0,0,0.5)" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
          <circle
            cx="20"
            cy="20"
            r="17"
            fill="none"
            stroke={ready ? '#d1232f' : '#7a6a6a'}
            strokeWidth="3"
            strokeDasharray={`${k * 106.8} 106.8`}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums">
          {ready ? keyHint : Math.ceil(value)}
        </div>
      </div>
      <div className="text-[10px] tracking-[0.18em] text-ash uppercase">{label}</div>
    </div>
  );
}

function HunterVitals({ me, snap, touch }: { me: PlayerView; snap: RoomSnapshot; touch: boolean }) {
  const def = CHARACTERS[me.characterId as CharacterId];
  const ab = def.ability ? ABILITIES[def.ability] : null;
  const survivors = snap.players.filter((p) => p.role === 'survivor');
  const caged = survivors.filter((p) => p.condition === 'captured').length;
  const dead = survivors.filter((p) => p.condition === 'eliminated').length;
  return (
    <div
      className={`absolute flex items-end gap-4 rounded-xl border border-line bg-black/45 p-3 backdrop-blur-sm ${touch ? TOUCH_VITALS : 'bottom-4 left-4'}`}
    >
      <Cooldown label="Attack" value={me.attackCd} max={HUNTER.attackCooldownHit} keyHint="LMB" />
      {ab && <Cooldown label={def.ability!.replace('_', ' ')} value={me.abilityCd} max={ab.cooldown} keyHint="Q" />}
      <Cooldown label="Roar" value={me.roarCd} max={HUNTER.roarCooldown} keyHint="R" />
      <div className="ml-2 text-xs leading-5 text-ash">
        <div>
          Caged <span className="text-bone">{caged}</span>
        </div>
        <div>
          Taken <span className="text-blood">{dead}</span>
        </div>
        <div>
          Left{' '}
          <span className="text-bone">{survivors.length - dead - survivors.filter((p) => p.condition === 'escaped').length}</span>
        </div>
      </div>
      {(me.action === 'stunned' || me.action === 'blinded') && (
        <div className="ml-2 animate-pulse text-xs tracking-widest text-ember uppercase">{me.action}</div>
      )}
    </div>
  );
}

function Prompt() {
  const prompt = useHud((s) => s.prompt);
  const holding = useHud((s) => s.holding);
  const me = useRoom((s) => s.snap?.players.find((p) => p.sessionId === s.sessionId));
  if (!prompt && !(me && me.action !== 'none' && me.actionProgress > 0)) return null;
  const progress = me && me.action !== 'none' ? me.actionProgress : 0;
  return (
    <div className="absolute bottom-[22%] left-1/2 flex -translate-x-1/2 flex-col items-center gap-2">
      {prompt && (
        <div
          className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm backdrop-blur-sm ${prompt.disabled ? 'border-line bg-black/50 text-dim' : 'border-bone/25 bg-black/60'}`}
        >
          <kbd className="rounded border border-bone/40 px-1.5 text-xs">E</kbd>
          <span>{prompt.label}</span>
          {prompt.disabled && <span className="text-xs text-ember">· {prompt.disabled}</span>}
          {!prompt.disabled && (prompt.continuous || prompt.duration > 1.5) && (
            <span className="text-[10px] tracking-widest text-ash uppercase">hold</span>
          )}
        </div>
      )}
      {progress > 0 && (
        <div className="h-1.5 w-56 overflow-hidden rounded-full bg-white/10">
          <div className="h-full bg-bone transition-[width] duration-100" style={{ width: `${progress * 100}%` }} />
        </div>
      )}
      {holding && !progress && <div className="text-[10px] tracking-widest text-ash uppercase">…</div>}
    </div>
  );
}

function Crosshair() {
  return (
    <div className="absolute top-1/2 left-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-bone/70 shadow-[0_0_4px_black]" />
  );
}

function Spectating() {
  const name = useHud((s) => s.spectating);
  if (!name) return null;
  return (
    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 rounded-lg border border-line bg-black/60 px-4 py-2 text-center">
      <div className="label">Spectating</div>
      <div className="heading text-lg">{name}</div>
      <div className="text-[10px] tracking-widest text-ash uppercase">Click / tap to switch</div>
    </div>
  );
}

function Feed() {
  const feed = useRoom((s) => s.feed);
  return (
    <div className="absolute top-4 right-4 flex w-72 flex-col items-end gap-1.5 max-md:top-14">
      <AnimatePresence initial={false}>
        {feed.map((f) => (
          <motion.div
            key={f.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            className={`rounded-md border bg-black/55 px-3 py-1.5 text-xs backdrop-blur-sm ${
              f.tone === 'danger'
                ? 'border-blood/50 text-red-200'
                : f.tone === 'success'
                  ? 'border-emerald-400/30 text-emerald-100'
                  : 'border-line text-bone'
            }`}
          >
            {f.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function Notices() {
  const notices = useRoom((s) => s.notices);
  return (
    <div className="absolute top-[30%] left-1/2 flex -translate-x-1/2 flex-col items-center gap-2">
      <AnimatePresence>
        {notices.map((n) => (
          <motion.div
            key={n.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-md bg-black/70 px-4 py-2 text-sm text-bone"
          >
            {n.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function TerrorVignette() {
  const terror = useHud((s) => s.terror);
  if (terror <= 0) return null;
  return (
    <div
      className="absolute inset-0"
      style={{
        background: `radial-gradient(ellipse at center, transparent ${55 - terror * 25}%, rgba(110,8,12,${0.15 + terror * 0.45}) 100%)`,
        animation: terror > 0.3 ? `pulse-slow ${1.4 - terror * 0.8}s ease-in-out infinite` : undefined,
      }}
    />
  );
}

function HitFlash() {
  const at = useHud((s) => s.hitFlash);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!at) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 450);
    return () => clearTimeout(t);
  }, [at]);
  if (!visible) return null;
  return <div className="absolute inset-0 bg-blood/35 mix-blend-multiply" />;
}

function LockerOverlay() {
  return (
    <div className="absolute inset-0">
      {Array.from({ length: 9 }, (_, i) => (
        <div key={i} className="absolute left-0 h-[7%] w-full bg-black" style={{ top: `${i * 11.5}%` }} />
      ))}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-xs tracking-[0.3em] text-ash uppercase">
        Hiding · press E to leave
      </div>
    </div>
  );
}

function StateBanner({ title, sub, tone }: { title: string; sub: string; tone: 'danger' | 'info' }) {
  return (
    <div className="absolute top-[18%] left-1/2 -translate-x-1/2 text-center">
      <div className={`heading text-3xl ${tone === 'danger' ? 'text-blood' : ''}`}>{title}</div>
      <div className="mt-1 text-sm text-ash">{sub}</div>
    </div>
  );
}

function StatusBoard({ snap }: { snap: RoomSnapshot }) {
  return (
    <div className="absolute top-1/2 left-1/2 w-[min(560px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-black/80 p-4 backdrop-blur">
      <div className="label mb-3">Players · room {snap.code}</div>
      <table className="w-full text-sm">
        <tbody>
          {snap.players.map((p) => (
            <tr key={p.sessionId} className="border-t border-line">
              <td className="py-1.5">{p.name}</td>
              <td className="text-ash">{CHARACTERS[p.characterId as CharacterId]?.name}</td>
              <td className={p.role === 'hunter' ? 'text-blood' : 'text-ash'}>{p.role}</td>
              <td style={{ color: CONDITION[p.condition]?.color }}>
                {p.role === 'survivor' ? CONDITION[p.condition]?.label : p.isBot ? 'bot' : ''}
              </td>
              <td className="text-right text-xs text-dim">{p.connected ? '' : 'offline'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Fps() {
  const fps = useHud((s) => s.fps);
  const show = useSettings((s) => s.showFps);
  const ping = useRoom((s) => s.ping);
  if (!show) return null;
  return (
    <div className="absolute right-2 bottom-2 font-mono text-[10px] text-ash">
      {fps} fps · {ping} ms
    </div>
  );
}

function PauseMenu() {
  const [tab, setTab] = useState<'menu' | 'settings'>('menu');
  const close = () => useHud.getState().set({ paused: false });
  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="panel w-[min(560px,94vw)] p-6">
        {tab === 'menu' ? (
          <div className="flex flex-col gap-3">
            <div className="heading mb-2 text-center text-2xl">Paused</div>
            <div className="mb-2 text-center text-xs text-ash">The match keeps running while you are paused.</div>
            <button className="btn btn-primary" onClick={close}>
              Resume
            </button>
            <button className="btn" onClick={() => setTab('settings')}>
              Settings
            </button>
            <button
              className="btn btn-ghost text-blood"
              onClick={() => {
                close();
                void leaveRoom();
              }}
            >
              Leave match
            </button>
          </div>
        ) : (
          <div>
            <SettingsPanel compact />
            <button className="btn mt-4 w-full" onClick={() => setTab('menu')}>
              Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
