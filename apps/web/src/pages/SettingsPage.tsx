import { useEffect, useState } from 'react';
import { PageShell, Segmented, Slider, Toggle } from '../components/ui';
import { ACTION_LABELS, useSettings, type Action, type Quality } from '../stores/settings';
import { useUi } from '../stores/ui';

const prettyKey = (code: string) => code.replace(/^Key/, '').replace(/^Digit/, '').replace('Left', ' L').replace('Right', ' R');

export function SettingsPanel({ compact }: { compact?: boolean }) {
  const s = useSettings();
  const [binding, setBinding] = useState<Action | null>(null);
  const [tab, setTab] = useState<'graphics' | 'controls' | 'audio'>('graphics');

  useEffect(() => {
    if (!binding) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.code !== 'Escape') s.bindKey(binding, e.code);
      setBinding(null);
    };
    window.addEventListener('keydown', onKey, { once: true });
    return () => window.removeEventListener('keydown', onKey);
  }, [binding, s]);

  return (
    <div className={compact ? 'max-h-[60vh] overflow-y-auto pr-1' : ''}>
      <div className="mb-4">
        <Segmented value={tab} options={[{ value: 'graphics', label: 'Graphics' }, { value: 'controls', label: 'Controls' }, { value: 'audio', label: 'Audio' }]} onChange={setTab} />
      </div>
      {tab === 'graphics' && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between py-1.5">
            <span className="text-sm">Quality preset</span>
            <Segmented<Quality> value={s.quality} options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]} onChange={s.applyPreset} />
          </div>
          <Slider label="Resolution scale" value={s.renderScale} min={0.5} max={1} step={0.05} onChange={(v) => s.set({ renderScale: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <Slider label="Render distance" value={s.renderDistance} min={35} max={140} step={5} onChange={(v) => s.set({ renderDistance: v })} format={(v) => `${v} m`} />
          <Toggle label="Shadows" value={s.shadows} onChange={(v) => s.set({ shadows: v })} />
          <Toggle label="Anti-aliasing" value={s.antialias} onChange={(v) => s.set({ antialias: v })} />
          <Toggle label="Post-processing (bloom, grain)" value={s.postFx} onChange={(v) => s.set({ postFx: v })} />
          <div className="flex items-center justify-between py-1.5">
            <span className="text-sm">Fog quality</span>
            <Segmented value={s.fogQuality} options={[{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }]} onChange={(v) => s.set({ fogQuality: v })} />
          </div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-sm">Texture quality</span>
            <Segmented value={s.textureQuality} options={[{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }]} onChange={(v) => s.set({ textureQuality: v })} />
          </div>
          <Slider label="Field of view" value={s.fov} min={60} max={100} step={1} onChange={(v) => s.set({ fov: v })} format={(v) => `${v}°`} />
          <Toggle label="Show FPS / ping" value={s.showFps} onChange={(v) => s.set({ showFps: v })} />
        </div>
      )}
      {tab === 'controls' && (
        <div className="flex flex-col gap-1">
          <Slider label="Mouse sensitivity" value={s.sensitivity} min={0.2} max={3} step={0.05} onChange={(v) => s.set({ sensitivity: v })} format={(v) => v.toFixed(2)} />
          <Slider label="Touch sensitivity" value={s.touchSensitivity} min={0.2} max={3} step={0.05} onChange={(v) => s.set({ touchSensitivity: v })} format={(v) => v.toFixed(2)} />
          <Toggle label="Invert vertical look" value={s.invertY} onChange={(v) => s.set({ invertY: v })} />
          <div className="mt-3 mb-1 flex items-center justify-between">
            <span className="label">Key bindings</span>
            <button className="text-xs text-ash hover:text-bone" onClick={s.resetKeys}>
              Reset
            </button>
          </div>
          <div className="grid gap-1 sm:grid-cols-2">
            {(Object.keys(ACTION_LABELS) as Action[]).map((a) => (
              <button key={a} onClick={() => setBinding(a)} className={`flex items-center justify-between rounded-md border px-3 py-1.5 text-sm ${binding === a ? 'border-blood' : 'border-line hover:border-bone/30'}`}>
                <span className="text-bone/85">{ACTION_LABELS[a]}</span>
                <span className="font-mono text-xs text-ash">{binding === a ? 'press a key…' : s.keys[a].map(prettyKey).join(' / ')}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-dim">Mouse: look · Left click: attack / skill check · Space: skill check · Esc: pause.</p>
        </div>
      )}
      {tab === 'audio' && (
        <div className="flex flex-col gap-1">
          <Toggle label="Mute all" value={s.muted} onChange={(v) => s.set({ muted: v })} />
          <Slider label="Master" value={s.masterVolume} min={0} max={1} step={0.05} onChange={(v) => s.set({ masterVolume: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <Slider label="Music & ambience" value={s.musicVolume} min={0} max={1} step={0.05} onChange={(v) => s.set({ musicVolume: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <Slider label="Effects" value={s.sfxVolume} min={0} max={1} step={0.05} onChange={(v) => s.set({ sfxVolume: v })} format={(v) => `${Math.round(v * 100)}%`} />
        </div>
      )}
    </div>
  );
}

export function SettingsPage() {
  const go = useUi((s) => s.go);
  return (
    <PageShell title="Settings" subtitle="Saved on this device" onBack={() => go('menu')}>
      <div className="panel p-5">
        <SettingsPanel />
      </div>
    </PageShell>
  );
}
