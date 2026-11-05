import { API_PREFIX, type FriendEntry, type MatchHistoryEntry, type Profile } from '@shadow-hunt/shared';
import { localApi } from '../offline/localApi';

/** Artifact build: everything runs in the page (solo vs the bot hunter), no game server. */
export const OFFLINE = import.meta.env.VITE_OFFLINE === '1';

/**
 * Where the game server lives:
 *  - VITE_SERVER_URL, if set (game server hosted on another domain, e.g. Railway/Render/Fly);
 *  - otherwise in production the same origin as the page (Vercel Services routes /api/* to it);
 *  - in `vite dev`, the standalone dev server on port 2567 of the same host (works from phones on the LAN).
 */
function defaultServer(): string {
  if (typeof location === 'undefined') return 'http://localhost:2567';
  if (import.meta.env.DEV) return `${location.protocol}//${location.hostname}:2567`;
  return location.origin;
}

export const SERVER_URL = (import.meta.env.VITE_SERVER_URL || defaultServer()).replace(/\/$/, '');
/** Colyseus endpoint: matchmaking at `<this>/matchmake/…`, rooms at `<this>/<process>/<room>` (wss on https). */
export const GAME_ENDPOINT = `${SERVER_URL}${API_PREFIX}`;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

let authToken: string | null = null;
export function setApiToken(token: string | null) {
  authToken = token;
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the game server.');
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, json.error ?? `Request failed (${res.status})`);
  return json as T;
}

export interface RoomInfo {
  exists: boolean;
  code?: string;
  clients?: number;
  maxClients?: number;
  phase?: string;
  mapId?: string;
  host?: string;
  joinable?: boolean;
}

const remoteApi = {
  health: () => request<{ ok: boolean; store: string }>('GET', '/api/health'),
  guest: (name?: string) => request<{ token: string; profile: Profile }>('POST', '/api/auth/guest', { name }),
  profile: () => request<{ profile: Profile }>('GET', '/api/profile'),
  updateProfile: (patch: {
    username?: string;
    avatar?: string;
    title?: string;
    skin?: { characterId: string; skinId: string };
  }) => request<{ profile: Profile }>('PATCH', '/api/profile', patch),
  history: () => request<{ history: MatchHistoryEntry[] }>('GET', '/api/history'),
  friends: () => request<{ friends: FriendEntry[] }>('GET', '/api/friends'),
  addFriend: (username: string) => request<{ ok: boolean }>('POST', '/api/friends', { username }),
  removeFriend: (id: string) => request<{ ok: boolean }>('DELETE', `/api/friends/${encodeURIComponent(id)}`),
  room: (code: string) => request<RoomInfo>('GET', `/api/rooms/${encodeURIComponent(code)}`),
};

export const api: typeof remoteApi = OFFLINE ? (localApi as unknown as typeof remoteApi) : remoteApi;
