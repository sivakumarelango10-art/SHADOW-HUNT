import { create } from 'zustand';

export type Screen = 'menu' | 'characters' | 'inventory' | 'settings' | 'stats' | 'friends' | 'profile';

interface UiState {
  screen: Screen;
  go: (s: Screen) => void;
}

export const useUi = create<UiState>((set) => ({
  screen: 'menu',
  go: (screen) => set({ screen }),
}));
