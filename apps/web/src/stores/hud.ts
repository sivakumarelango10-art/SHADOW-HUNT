import { create } from 'zustand';
import type { InteractOption } from '@shadow-hunt/shared';

/** Fast-changing HUD values pushed from the game loop at ~15 Hz. */
export interface HudState {
  prompt: InteractOption | null;
  holding: boolean;
  stamina: number;
  exhausted: boolean;
  /** 0 = hunter far away, 1 = right behind you. */
  terror: number;
  spectating: string | null;
  paused: boolean;
  showStatus: boolean;
  blinded: number;
  hitFlash: number;
  fps: number;
  set: (p: Partial<Omit<HudState, 'set'>>) => void;
}

export const useHud = create<HudState>((set) => ({
  prompt: null,
  holding: false,
  stamina: 100,
  exhausted: false,
  terror: 0,
  spectating: null,
  paused: false,
  showStatus: false,
  blinded: 0,
  hitFlash: 0,
  fps: 0,
  set: (p) => set(p),
}));
