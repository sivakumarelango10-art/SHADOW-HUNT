import { create } from 'zustand';
import type { Profile } from '@shadow-hunt/shared';
import { api, ApiError, setApiToken } from '../services/api';
import { getSupabase, supabaseConfigured } from '../services/supabase';

const GUEST_KEY = 'sh.guestToken';

type Status = 'idle' | 'loading' | 'ready' | 'offline';

interface SessionState {
  status: Status;
  error: string | null;
  token: string | null;
  profile: Profile | null;
  authKind: 'guest' | 'account' | null;
  init: () => Promise<void>;
  continueAsGuest: (name?: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string) => Promise<string>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  setProfile: (p: Profile) => void;
}

function readGuest(): string | null {
  try {
    return localStorage.getItem(GUEST_KEY);
  } catch {
    return null;
  }
}
function writeGuest(token: string | null) {
  try {
    if (token) localStorage.setItem(GUEST_KEY, token);
    else localStorage.removeItem(GUEST_KEY);
  } catch {
    /* private mode */
  }
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'idle',
  error: null,
  token: null,
  profile: null,
  authKind: null,

  async init() {
    if (get().status === 'loading') return;
    set({ status: 'loading', error: null });
    try {
      // 1. Supabase account session takes priority.
      const sbp = getSupabase();
      if (sbp) {
        const sb = await sbp;
        const { data } = await sb.auth.getSession();
        sb.auth.onAuthStateChange((_event, session) => {
          if (session?.access_token) {
            const token = `sb.${session.access_token}`;
            setApiToken(token);
            set({ token, authKind: 'account' });
          }
        });
        if (data.session?.access_token) {
          const token = `sb.${data.session.access_token}`;
          setApiToken(token);
          const { profile } = await api.profile();
          set({ token, profile, authKind: 'account', status: 'ready' });
          return;
        }
      }
      // 2. Existing guest identity.
      const guest = readGuest();
      if (guest) {
        setApiToken(guest);
        try {
          const { profile } = await api.profile();
          set({ token: guest, profile, authKind: 'guest', status: 'ready' });
          return;
        } catch (e) {
          if (e instanceof ApiError && e.status === 0) throw e;
          writeGuest(null);
        }
      }
      // 3. First visit: become a guest automatically so friends can jump straight in.
      await get().continueAsGuest();
    } catch (e) {
      set({ status: 'offline', error: e instanceof Error ? e.message : String(e) });
    }
  },

  async continueAsGuest(name?: string) {
    const { token, profile } = await api.guest(name);
    writeGuest(token);
    setApiToken(token);
    set({ token, profile, authKind: 'guest', status: 'ready', error: null });
  },

  async signInWithGoogle() {
    const sbp = getSupabase();
    if (!sbp) throw new Error('Accounts are not configured on this server.');
    const sb = await sbp;
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + location.pathname },
    });
    if (error) throw error;
  },

  async signInWithEmail(email: string) {
    const sbp = getSupabase();
    if (!sbp) throw new Error('Accounts are not configured on this server.');
    const sb = await sbp;
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    if (error) throw error;
    return 'Check your inbox for a sign-in link.';
  },

  async signOut() {
    const sbp = getSupabase();
    if (sbp && get().authKind === 'account') await (await sbp).auth.signOut();
    writeGuest(null);
    setApiToken(null);
    set({ token: null, profile: null, authKind: null, status: 'idle' });
    await get().init();
  },

  async refreshProfile() {
    try {
      const { profile } = await api.profile();
      set({ profile });
    } catch {
      /* keep stale */
    }
  },

  setProfile(p) {
    set({ profile: p });
  },
}));

export { supabaseConfigured };
