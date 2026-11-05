/**
 * Browser replacement for the server's `services/store.ts` in the offline (artifact) build.
 * Same interface as FileStore, persisted to localStorage instead of a JSON file, so XP,
 * levels, unlocks, achievements and match history survive reloads on this device.
 */
import {
  emptyStats,
  levelFromXp,
  type CharacterId,
  type GameOutcome,
  type MapId,
  type MatchHistoryEntry,
  type MatchResults,
  type PlayerMatchStats,
  type Profile,
  type Role,
} from '@shadow-hunt/shared';

export interface Identity {
  playerId: string;
  isGuest: boolean;
  displayName?: string;
}

export class StoreError extends Error {
  constructor(
    public code: 'username_taken' | 'not_found',
    message: string,
  ) {
    super(message);
  }
}

export interface MatchPlayerRecord {
  playerId: string;
  role: Role;
  characterId: CharacterId;
  outcome: GameOutcome;
  won: boolean;
  xpGained: number;
  stats: PlayerMatchStats;
  profileAfter: Profile;
}

export interface MatchRecord {
  matchId: string;
  mapId: MapId;
  winner: 'survivors' | 'hunter';
  durationSeconds: number;
  survivorsTotal: number;
  survivorsEscaped: number;
  generatorsCompleted: number;
  results: MatchResults;
  players: MatchPlayerRecord[];
}

export type ProfilePatch = Partial<Pick<Profile, 'username' | 'avatar' | 'title' | 'equippedSkins'>>;

interface Db {
  profiles: Record<string, Profile>;
  history: Record<string, MatchHistoryEntry[]>;
}

const KEY = 'sh.offline.db';

export class LocalStore {
  readonly kind = 'local';
  private db: Db = { profiles: {}, history: {} };

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.db = { ...this.db, ...JSON.parse(raw) };
    } catch {
      /* storage blocked or corrupt: start fresh in memory */
    }
  }

  private persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.db));
    } catch {
      /* storage blocked: progress lasts for this visit only */
    }
  }

  async getProfile(id: string) {
    const p = this.db.profiles[id];
    return p ? structuredClone(p) : null;
  }

  async ensureProfile(identity: Identity) {
    const existing = this.db.profiles[identity.playerId];
    if (existing) return structuredClone(existing);
    const raw = (identity.displayName ?? '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 12);
    const p: Profile = {
      id: identity.playerId,
      username: raw.length >= 3 ? raw : `Survivor${Math.floor(1000 + Math.random() * 9000)}`,
      avatar: 'moth',
      isGuest: true,
      xp: 0,
      level: 1,
      title: 'fresh_meat',
      stats: emptyStats(),
      achievements: [],
      equippedSkins: {},
      createdAt: new Date().toISOString(),
    };
    this.db.profiles[p.id] = p;
    this.persist();
    return structuredClone(p);
  }

  async updateProfile(id: string, patch: ProfilePatch) {
    const p = this.db.profiles[id];
    if (!p) throw new StoreError('not_found', 'Profile not found');
    Object.assign(p, patch);
    this.persist();
    return structuredClone(p);
  }

  async saveMatch(rec: MatchRecord) {
    const playedAt = new Date().toISOString();
    for (const pl of rec.players) {
      this.db.profiles[pl.playerId] = structuredClone(pl.profileAfter);
      const h = (this.db.history[pl.playerId] ??= []);
      h.unshift({
        matchId: rec.matchId,
        mapId: rec.mapId,
        role: pl.role,
        characterId: pl.characterId,
        outcome: pl.outcome,
        won: pl.won,
        xpGained: pl.xpGained,
        durationSeconds: rec.durationSeconds,
        playedAt,
      });
      if (h.length > 50) h.length = 50;
    }
    this.persist();
  }

  async history(id: string, limit: number) {
    return (this.db.history[id] ?? []).slice(0, limit);
  }
  async findByUsername(_name: string) {
    return null;
  }
  async getProfiles(_ids: string[]) {
    return [] as Profile[];
  }
  async friendIds(_id: string) {
    return [] as string[];
  }
  async addFriend() {}
  async removeFriend() {}
}

let store: LocalStore | null = null;
export function getStore(): LocalStore {
  return (store ??= new LocalStore());
}
export function setStore(s: LocalStore) {
  store = s;
}
export function recomputeLevel(p: Profile): Profile {
  p.level = levelFromXp(p.xp);
  return p;
}
