import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Quality = 'low' | 'medium' | 'high';

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'sprint'
  | 'crouch'
  | 'interact'
  | 'flashlight'
  | 'ability'
  | 'roar'
  | 'item'
  | 'status';

export const DEFAULT_KEYS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  crouch: ['KeyC', 'ControlLeft'],
  interact: ['KeyE'],
  flashlight: ['KeyF'],
  ability: ['KeyQ'],
  roar: ['KeyR'],
  item: ['KeyG'],
  status: ['Tab'],
};

export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Move forward',
  back: 'Move back',
  left: 'Strafe left',
  right: 'Strafe right',
  sprint: 'Sprint',
  crouch: 'Crouch',
  interact: 'Interact / skill check',
  flashlight: 'Flashlight',
  ability: 'Hunter ability',
  roar: 'Hunter roar',
  item: 'Use item',
  status: 'Player status',
};

export interface SettingsState {
  quality: Quality;
  renderScale: number;
  shadows: boolean;
  antialias: boolean;
  postFx: boolean;
  renderDistance: number;
  fogQuality: 'low' | 'high';
  textureQuality: 'low' | 'high';
  fov: number;
  sensitivity: number;
  touchSensitivity: number;
  invertY: boolean;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
  keys: Record<Action, string[]>;
  showFps: boolean;
  set: (patch: Partial<Omit<SettingsState, 'set' | 'applyPreset' | 'bindKey' | 'resetKeys'>>) => void;
  applyPreset: (q: Quality) => void;
  bindKey: (action: Action, code: string) => void;
  resetKeys: () => void;
}

const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

const PRESETS: Record<Quality, Partial<SettingsState>> = {
  low: { renderScale: 0.6, shadows: false, antialias: false, postFx: false, renderDistance: 45, fogQuality: 'low', textureQuality: 'low' },
  medium: { renderScale: 0.85, shadows: true, antialias: false, postFx: false, renderDistance: 70, fogQuality: 'high', textureQuality: 'high' },
  high: { renderScale: 1, shadows: true, antialias: true, postFx: true, renderDistance: 110, fogQuality: 'high', textureQuality: 'high' },
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...(PRESETS[isMobile ? 'low' : 'high'] as Required<typeof PRESETS.high>),
      quality: isMobile ? 'low' : 'high',
      fov: 75,
      sensitivity: 1,
      touchSensitivity: 1,
      invertY: false,
      masterVolume: 0.8,
      musicVolume: 0.6,
      sfxVolume: 0.9,
      muted: false,
      keys: DEFAULT_KEYS,
      showFps: false,
      set: (patch) => set(patch),
      applyPreset: (q) => set({ quality: q, ...PRESETS[q] }),
      bindKey: (action, code) =>
        set((s) => {
          const keys = { ...s.keys };
          for (const a of Object.keys(keys) as Action[]) keys[a] = keys[a].filter((c) => c !== code);
          keys[action] = [code, ...(keys[action] ?? []).filter((c) => c !== code)].slice(0, 2);
          return { keys };
        }),
      resetKeys: () => set({ keys: DEFAULT_KEYS }),
    }),
    { name: 'sh.settings', version: 1 },
  ),
);

export { isMobile };
