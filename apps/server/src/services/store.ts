import fs from 'node:fs';
import path from 'node:path';
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
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Identity } from '../auth/tokens.ts';
import { supabaseAdmin } from '../auth/tokens.ts';
import { config, supabaseEnabled } from '../config.ts';
import { log } from '../utils/log.ts';

export class StoreError extends Error {
  constructor(
    public code: 'username_taken' | 'not_found' | 'invalid',
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
  /** Profile after XP, stats and achievements were applied. */
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

export interface Store {
  readonly kind: 'file' | 'memory' | 'supabase';
  getProfile(id: string): Promise<Profile | null>;
  ensureProfile(identity: Identity): Promise<Profile>;
  updateProfile(id: string, patch: ProfilePatch): Promise<Profile>;
  saveMatch(rec: MatchRecord): Promise<void>;
  history(id: string, limit: number): Promise<MatchHistoryEntry[]>;
  findByUsername(name: string): Promise<Profile | null>;
  getProfiles(ids: string[]): Promise<Profile[]>;
  friendIds(id: string): Promise<string[]>;
  addFriend(id: string, friendId: string): Promise<void>;
  removeFriend(id: string, friendId: string): Promise<void>;
}

function baseName(identity: Identity): string {
  const raw = (identity.displayName ?? '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 12);
  return raw.length >= 3 ? raw : identity.isGuest ? 'Survivor' : 'Player';
}

function newProfile(identity: Identity, username: string): Profile {
  return {
    id: identity.playerId,
    username,
    avatar: 'moth',
    isGuest: identity.isGuest,
    xp: 0,
    level: 1,
    title: 'fresh_meat',
    stats: emptyStats(),
    achievements: [],
    equippedSkins: {},
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// File / memory store — zero-config development persistence (server side only).
// ---------------------------------------------------------------------------
interface FileDb {
  profiles: Record<string, Profile>;
  history: Record<string, MatchHistoryEntry[]>;
  matches: { id: string; mapId: string; winner: string; durationSeconds: number; playedAt: string; results: MatchResults }[];
  friends: Record<string, string[]>;
}

export class FileStore implements Store {
  readonly kind: 'file' | 'memory';
  private db: FileDb = { profiles: {}, history: {}, matches: [], friends: {} };
  private file: string | null;
  private writeTimer: NodeJS.Timeout | null = null;

  constructor(dir: string | null) {
    this.kind = dir ? 'file' : 'memory';
    this.file = dir ? path.join(dir, 'dev-db.json') : null;
    if (this.file && fs.existsSync(this.file)) {
      try {
        this.db = { ...this.db, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
      } catch (e) {
        log.error('could not read dev database, starting fresh', { error: String(e) });
      }
    }
  }

  private persist() {
    if (!this.file) return;
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      const file = this.file!;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.db));
      fs.renameSync(tmp, file);
    }, 250);
  }

  private nameTaken(name: string, exceptId?: string) {
    const lower = name.toLowerCase();
    return Object.values(this.db.profiles).some((p) => p.username.toLowerCase() === lower && p.id !== exceptId);
  }

  async getProfile(id: string) {
    const p = this.db.profiles[id];
    return p ? structuredClone(p) : null;
  }

  async ensureProfile(identity: Identity) {
    const existing = this.db.profiles[identity.playerId];
    if (existing) return structuredClone(existing);
    const base = baseName(identity);
    let name = base;
    for (let i = 0; this.nameTaken(name); i++) name = `${base}${Math.floor(1000 + Math.random() * 9000)}`;
    const p = newProfile(identity, name);
    this.db.profiles[p.id] = p;
    this.persist();
    return structuredClone(p);
  }

  async updateProfile(id: string, patch: ProfilePatch) {
    const p = this.db.profiles[id];
    if (!p) throw new StoreError('not_found', 'Profile not found');
    if (patch.username && this.nameTaken(patch.username, id)) throw new StoreError('username_taken', 'That name is taken');
    Object.assign(p, patch);
    this.persist();
    return structuredClone(p);
  }

  async saveMatch(rec: MatchRecord) {
    const playedAt = new Date().toISOString();
    this.db.matches.push({
      id: rec.matchId,
      mapId: rec.mapId,
      winner: rec.winner,
      durationSeconds: rec.durationSeconds,
      playedAt,
      results: rec.results,
    });
    if (this.db.matches.length > 500) this.db.matches.splice(0, this.db.matches.length - 500);
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

  async findByUsername(name: string) {
    const lower = name.toLowerCase();
    const p = Object.values(this.db.profiles).find((x) => x.username.toLowerCase() === lower);
    return p ? structuredClone(p) : null;
  }

  async getProfiles(ids: string[]) {
    return ids
      .map((id) => this.db.profiles[id])
      .filter((p): p is Profile => !!p)
      .map((p) => structuredClone(p));
  }

  async friendIds(id: string) {
    return [...(this.db.friends[id] ?? [])];
  }

  async addFriend(id: string, friendId: string) {
    const list = (this.db.friends[id] ??= []);
    if (!list.includes(friendId)) list.push(friendId);
    this.persist();
  }

  async removeFriend(id: string, friendId: string) {
    this.db.friends[id] = (this.db.friends[id] ?? []).filter((f) => f !== friendId);
    this.persist();
  }
}

// ---------------------------------------------------------------------------
// Supabase store — production persistence via the service-role key (server only).
// ---------------------------------------------------------------------------
interface ProfileRow {
  id: string;
  username: string;
  avatar: string;
  is_guest: boolean;
  xp: number;
  level: number;
  title: string;
  stats: Profile['stats'];
  achievements: string[];
  equipped_skins: Profile['equippedSkins'];
  created_at: string;
}

const toProfile = (r: ProfileRow): Profile => ({
  id: r.id,
  username: r.username,
  avatar: r.avatar,
  isGuest: r.is_guest,
  xp: r.xp,
  level: r.level,
  title: r.title,
  stats: { ...emptyStats(), ...(r.stats ?? {}) },
  achievements: r.achievements ?? [],
  equippedSkins: r.equipped_skins ?? {},
  createdAt: r.created_at,
});

const toRow = (p: Profile) => ({
  id: p.id,
  username: p.username,
  avatar: p.avatar,
  is_guest: p.isGuest,
  xp: p.xp,
  level: p.level,
  title: p.title,
  stats: p.stats,
  achievements: p.achievements,
  equipped_skins: p.equippedSkins,
});

export class SupabaseStore implements Store {
  readonly kind = 'supabase' as const;
  constructor(private sb: SupabaseClient) {}

  async getProfile(id: string) {
    const { data, error } = await this.sb.from('profiles').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? toProfile(data as ProfileRow) : null;
  }

  async ensureProfile(identity: Identity) {
    const existing = await this.getProfile(identity.playerId);
    if (existing) return existing;
    const base = baseName(identity);
    for (let attempt = 0; attempt < 6; attempt++) {
      const name = attempt === 0 ? base : `${base}${Math.floor(1000 + Math.random() * 9000)}`;
      const p = newProfile(identity, name);
      const { data, error } = await this.sb.from('profiles').insert(toRow(p)).select('*').single();
      if (!error) return toProfile(data as ProfileRow);
      if (error.code !== '23505') throw error; // unique violation → try another name
      const again = await this.getProfile(identity.playerId);
      if (again) return again; // concurrent creation
    }
    throw new StoreError('invalid', 'Could not allocate a username');
  }

  async updateProfile(id: string, patch: ProfilePatch) {
    const row: Record<string, unknown> = {};
    if (patch.username !== undefined) row.username = patch.username;
    if (patch.avatar !== undefined) row.avatar = patch.avatar;
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.equippedSkins !== undefined) row.equipped_skins = patch.equippedSkins;
    row.updated_at = new Date().toISOString();
    const { data, error } = await this.sb.from('profiles').update(row).eq('id', id).select('*').single();
    if (error) {
      if (error.code === '23505') throw new StoreError('username_taken', 'That name is taken');
      throw error;
    }
    return toProfile(data as ProfileRow);
  }

  async saveMatch(rec: MatchRecord) {
    const { error: mErr } = await this.sb.from('matches').insert({
      id: rec.matchId,
      map_id: rec.mapId,
      winner: rec.winner,
      duration_seconds: rec.durationSeconds,
      survivors_total: rec.survivorsTotal,
      survivors_escaped: rec.survivorsEscaped,
      generators_completed: rec.generatorsCompleted,
      results: rec.results,
    });
    if (mErr) throw mErr;
    if (rec.players.length) {
      const { error: pErr } = await this.sb.from('match_players').insert(
        rec.players.map((p) => ({
          match_id: rec.matchId,
          player_id: p.playerId,
          role: p.role,
          character_id: p.characterId,
          outcome: p.outcome,
          won: p.won,
          xp_gained: p.xpGained,
          stats: p.stats,
        })),
      );
      if (pErr) throw pErr;
    }
    for (const p of rec.players) {
      const a = p.profileAfter;
      const { error } = await this.sb
        .from('profiles')
        .update({ xp: a.xp, level: a.level, stats: a.stats, achievements: a.achievements, updated_at: new Date().toISOString() })
        .eq('id', p.playerId);
      if (error) throw error;
    }
  }

  async history(id: string, limit: number) {
    const { data, error } = await this.sb
      .from('match_players')
      .select('match_id, role, character_id, outcome, won, xp_gained, created_at, matches(map_id, duration_seconds)')
      .eq('player_id', id)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      matchId: r.match_id,
      mapId: r.matches?.map_id,
      role: r.role,
      characterId: r.character_id,
      outcome: r.outcome,
      won: r.won,
      xpGained: r.xp_gained,
      durationSeconds: r.matches?.duration_seconds ?? 0,
      playedAt: r.created_at,
    }));
  }

  async findByUsername(name: string) {
    const { data, error } = await this.sb.from('profiles').select('*').eq('username', name).maybeSingle(); // citext: case-insensitive
    if (error) throw error;
    return data ? toProfile(data as ProfileRow) : null;
  }

  async getProfiles(ids: string[]) {
    if (!ids.length) return [];
    const { data, error } = await this.sb.from('profiles').select('*').in('id', ids);
    if (error) throw error;
    return (data ?? []).map((r) => toProfile(r as ProfileRow));
  }

  async friendIds(id: string) {
    const { data, error } = await this.sb.from('friendships').select('friend_id').eq('player_id', id);
    if (error) throw error;
    return (data ?? []).map((r: any) => r.friend_id as string);
  }

  async addFriend(id: string, friendId: string) {
    const { error } = await this.sb.from('friendships').upsert({ player_id: id, friend_id: friendId });
    if (error) throw error;
  }

  async removeFriend(id: string, friendId: string) {
    const { error } = await this.sb.from('friendships').delete().eq('player_id', id).eq('friend_id', friendId);
    if (error) throw error;
  }
}

let store: Store | null = null;
export function getStore(): Store {
  if (store) return store;
  const sb = supabaseAdmin();
  if (supabaseEnabled && sb) {
    store = new SupabaseStore(sb);
    log.info('persistence: Supabase');
  } else if (config.memoryStore) {
    store = new FileStore(null);
  } else {
    store = new FileStore(config.dataDir);
    log.warn(`persistence: local file store at ${config.dataDir} (set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for production)`);
  }
  return store;
}

/** For tests. */
export function setStore(s: Store) {
  store = s;
}

export function recomputeLevel(p: Profile): Profile {
  p.level = levelFromXp(p.xp);
  return p;
}
