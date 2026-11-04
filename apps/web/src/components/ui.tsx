import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { audio } from '../game/audio/audio';

const AVATAR_PATHS: Record<string, ReactNode> = {
  moth: <path d="M20 12c-2 0-3 2-3 4v10c0 2 1 3 3 3s3-1 3-3V16c0-2-1-4-3-4zM17 16C10 8 4 10 5 17s8 7 12 5M23 16c7-8 13-6 12 1s-8 7-12 5M18 28c-4 2-7 6-5 8s5-2 6-6M22 28c4 2 7 6 5 8s-5-2-6-6" />,
  eye: (
    <>
      <path d="M4 20s6-10 16-10 16 10 16 10-6 10-16 10S4 20 4 20z" />
      <circle cx="20" cy="20" r="5" />
    </>
  ),
  skull: (
    <>
      <path d="M20 6c-8 0-13 5-13 12 0 4 2 7 5 8v5h16v-5c3-1 5-4 5-8 0-7-5-12-13-12z" />
      <circle cx="15" cy="18" r="3" />
      <circle cx="25" cy="18" r="3" />
      <path d="M17 31v3M20 31v3M23 31v3" />
    </>
  ),
  candle: <path d="M16 18h8v18h-8zM20 18v-4M20 6c3 3 3 6 0 8-3-2-3-5 0-8z" />,
  key: (
    <>
      <circle cx="14" cy="14" r="6" />
      <path d="M18 18l14 14M27 27l3-3M31 31l3-3" />
    </>
  ),
  raven: <path d="M6 24c6-1 10-6 14-12 2-3 6-4 9-2l5 1-4 2c1 6-3 12-10 14l-3 5-2-4c-3 0-6-1-9-4z" />,
  moon: <path d="M26 6a14 14 0 1 0 8 22A11 11 0 1 1 26 6z" />,
  hand: <path d="M12 34V18c0-2 3-2 3 0v-8c0-2 3-2 3 0v-2c0-2 3-2 3 0v2c0-2 3-2 3 0v10c1-3 5-3 4 1l-3 9c-1 3-3 4-6 4h-2c-3 0-5-1-5-4z" />,
};

export function Avatar({ id, size = 40, className = '' }: { id: string; size?: number; className?: string }) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full border border-line-strong bg-gradient-to-b from-panel-2 to-night ${className}`}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 40 40" width={size * 0.62} height={size * 0.62} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-bone/85">
        {AVATAR_PATHS[id] ?? AVATAR_PATHS.moth}
      </svg>
    </div>
  );
}

export function PageShell({ title, subtitle, onBack, children, wide }: { title: string; subtitle?: string; onBack: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="relative z-10 flex h-full flex-col overflow-hidden"
    >
      <header className="flex items-center gap-4 px-5 pt-5 pb-3 md:px-10 md:pt-8">
        <button className="btn btn-ghost px-3" onClick={() => (audio.ui('ui_click'), onBack())} aria-label="Back">
          ← Back
        </button>
        <div>
          <h1 className="heading text-2xl md:text-3xl">{title}</h1>
          {subtitle && <p className="text-sm text-ash">{subtitle}</p>}
        </div>
      </header>
      <div className={`mx-auto w-full flex-1 overflow-y-auto px-5 pb-10 md:px-10 ${wide ? 'max-w-6xl' : 'max-w-4xl'}`}>{children}</div>
    </motion.div>
  );
}

export function MenuButton({ children, onClick, primary, hint, disabled }: { children: ReactNode; onClick: () => void; primary?: boolean; hint?: string; disabled?: boolean }) {
  return (
    <button
      disabled={disabled}
      onMouseEnter={() => audio.ui('ui_hover')}
      onClick={() => {
        audio.unlock();
        audio.ui('ui_click');
        onClick();
      }}
      className={`group relative flex w-full items-center justify-between overflow-hidden rounded-lg border px-5 py-3 text-left transition duration-200 disabled:opacity-40 ${
        primary ? 'border-blood/70 bg-blood/85 text-white shadow-[0_0_30px_-8px_var(--color-blood)] hover:bg-blood' : 'border-line bg-black/35 hover:border-bone/30 hover:bg-white/[0.04]'
      }`}
    >
      <span className="font-display text-base tracking-[0.14em] uppercase">{children}</span>
      {hint && <span className={`text-xs ${primary ? 'text-white/70' : 'text-dim group-hover:text-ash'}`}>{hint}</span>}
    </button>
  );
}

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-1.5">
      <span className="text-sm text-bone/90">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative h-6 w-11 rounded-full border transition ${value ? 'border-blood bg-blood/70' : 'border-line-strong bg-night'}`}
      >
        <span className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-bone transition-all ${value ? 'left-5.5' : 'left-0.5'}`} />
      </button>
    </label>
  );
}

export function Slider({ value, onChange, min, max, step, label, format }: { value: number; onChange: (v: number) => void; min: number; max: number; step: number; label: string; format?: (v: number) => string }) {
  return (
    <label className="block py-1.5">
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-bone/90">{label}</span>
        <span className="text-ash tabular-nums">{format ? format(value) : value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[#b3202b]" />
    </label>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-night/70 p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-xs tracking-wide transition ${value === o.value ? 'bg-bone text-night' : 'text-ash hover:text-bone'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-bone/20 border-t-bone" />;
}
