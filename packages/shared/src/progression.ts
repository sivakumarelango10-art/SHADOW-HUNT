import { XP } from './balance.ts';
import { CHARACTERS } from './characters.ts';
import type { CharacterId, GameOutcome, PlayerMatchStats, ProfileStats, Role } from './types.ts';

export const MAX_LEVEL = 50;

/** Total XP required to reach `level` (level 1 = 0 XP). */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.round(220 * Math.pow(level - 1, 1.45));
}

export function levelFromXp(xp: number): number {
  let lvl = 1;
  while (lvl < MAX_LEVEL && xp >= xpForLevel(lvl + 1)) lvl++;
  return lvl;
}

export function levelProgress(xp: number): { level: number; current: number; needed: number; ratio: number } {
  const level = levelFromXp(xp);
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const needed = Math.max(1, next - base);
  return { level, current: xp - base, needed, ratio: level >= MAX_LEVEL ? 1 : (xp - base) / needed };
}

export interface TitleDef {
  id: string;
  name: string;
  /** Unlocked by level… */
  level?: number;
  /** …or by achievement. */
  achievement?: string;
}

export const TITLES: TitleDef[] = [
  { id: 'fresh_meat', name: 'Fresh Meat', level: 1 },
  { id: 'night_walker', name: 'Night Walker', level: 3 },
  { id: 'lantern_bearer', name: 'Lantern Bearer', level: 5 },
  { id: 'unbroken', name: 'Unbroken', level: 8 },
  { id: 'nightmare', name: 'Living Nightmare', level: 12 },
  { id: 'ghost_story', name: 'Ghost Story', level: 20 },
  { id: 'the_one_who_left', name: 'The One Who Left', achievement: 'first_escape' },
  { id: 'whisper', name: 'Whisper', achievement: 'silent_survivor' },
  { id: 'apex', name: 'Apex Predator', achievement: 'perfect_hunt' },
  { id: 'guardian', name: 'Guardian', achievement: 'team_rescuer' },
];

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_escape', name: 'First Escape', description: 'Escape a match as a survivor.' },
  { id: 'silent_survivor', name: 'Silent Survivor', description: 'Escape without being hit and with under 10 seconds of sprinting.' },
  { id: 'last_one_standing', name: 'Last One Standing', description: 'Be the only survivor to escape from a team of three or more.' },
  { id: 'master_hunter', name: 'Master Hunter', description: 'Eliminate 10 survivors across all matches.' },
  { id: 'perfect_hunt', name: 'Perfect Hunt', description: 'Eliminate every survivor in a match with at least two survivors.' },
  { id: 'team_rescuer', name: 'Team Rescuer', description: 'Rescue two teammates in a single match.' },
  { id: 'grease_monkey', name: 'Grease Monkey', description: 'Repair a full generator’s worth of progress in one match.' },
  { id: 'keymaster', name: 'Keymaster', description: 'Insert two access keys in one match.' },
];

export function titlesFor(level: number, achievements: string[]): TitleDef[] {
  return TITLES.filter((t) => (t.level !== undefined ? level >= t.level : achievements.includes(t.achievement!)));
}

export interface XpContext {
  role: Role;
  outcome: GameOutcome;
  won: boolean;
  stats: PlayerMatchStats;
}

export function computeXp(ctx: XpContext): { total: number; breakdown: { label: string; xp: number }[] } {
  const b: { label: string; xp: number }[] = [{ label: 'Participation', xp: XP.participation }];
  const s = ctx.stats;
  const add = (label: string, xp: number) => {
    if (xp > 0) b.push({ label, xp: Math.round(xp) });
  };
  if (ctx.role === 'survivor') {
    if (ctx.outcome === 'escaped') add('Escaped', XP.escape);
    add('Generator repairs', s.generatorProgress * XP.generatorFull);
    add('Great skill checks', s.skillGreats * XP.skillGreat);
    add('Rescues', s.rescues * XP.rescue);
    add('Revives', s.revives * XP.revive);
    add('Heals', s.heals * XP.heal);
    add('Keys inserted', s.keysDeposited * XP.keyDeposit);
    add('Exit gates opened', s.exitsOpened * XP.exitOpened);
  } else {
    add('Hits', s.hits * XP.hunterHit);
    add('Downs', s.downs * XP.hunterDown);
    add('Captures', s.captures * XP.hunterCapture);
    add('Eliminations', s.eliminations * XP.hunterElimination);
  }
  if (ctx.won) add('Victory', XP.win);
  return { total: b.reduce((a, x) => a + x.xp, 0), breakdown: b };
}

export interface AchievementContext {
  role: Role;
  outcome: GameOutcome;
  stats: PlayerMatchStats;
  survivorsTotal: number;
  survivorsEscaped: number;
  lifetime: ProfileStats;
}

export function evaluateAchievements(ctx: AchievementContext, existing: string[]): string[] {
  const got = new Set(existing);
  const earned: string[] = [];
  const give = (id: string, cond: boolean) => {
    if (cond && !got.has(id)) {
      earned.push(id);
      got.add(id);
    }
  };
  const s = ctx.stats;
  if (ctx.role === 'survivor') {
    give('first_escape', ctx.outcome === 'escaped');
    give('silent_survivor', ctx.outcome === 'escaped' && s.timesHit === 0 && s.sprintSeconds < 10);
    give('last_one_standing', ctx.outcome === 'escaped' && ctx.survivorsEscaped === 1 && ctx.survivorsTotal >= 3);
    give('team_rescuer', s.rescues >= 2);
    give('grease_monkey', s.generatorProgress >= 0.999);
    give('keymaster', s.keysDeposited >= 2);
  } else {
    give('perfect_hunt', ctx.survivorsTotal >= 2 && s.eliminations >= ctx.survivorsTotal);
    give('master_hunter', ctx.lifetime.eliminations >= 10);
  }
  return earned;
}

/** Characters newly unlocked when moving from levelBefore to levelAfter. */
export function unlocksBetween(levelBefore: number, levelAfter: number): string[] {
  const out: string[] = [];
  for (const c of Object.values(CHARACTERS)) {
    if (c.unlockLevel > levelBefore && c.unlockLevel <= levelAfter) out.push(c.name);
    for (const sk of c.skins) {
      if (sk.unlockLevel > levelBefore && sk.unlockLevel <= levelAfter && sk.unlockLevel > c.unlockLevel) out.push(`${c.name} — ${sk.name}`);
    }
  }
  for (const t of TITLES) if (t.level && t.level > levelBefore && t.level <= levelAfter) out.push(`Title: ${t.name}`);
  return out;
}

export function isCharacterUnlocked(id: CharacterId, level: number): boolean {
  return level >= CHARACTERS[id].unlockLevel;
}

export function isSkinUnlocked(characterId: CharacterId, skinId: string, level: number): boolean {
  const sk = CHARACTERS[characterId].skins.find((s) => s.id === skinId);
  return !!sk && level >= sk.unlockLevel;
}

export const AVATARS = ['moth', 'eye', 'skull', 'candle', 'key', 'raven', 'moon', 'hand'] as const;
export type AvatarId = (typeof AVATARS)[number];

/** Room codes avoid ambiguous glyphs (0/O, 1/I/L). 30^6 ≈ 729M combinations. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ2345679';
export const ROOM_CODE_LENGTH = 6;

export function isValidRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  return true;
}

export function normalizeRoomCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH);
}

export const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
export function isValidUsername(name: string): boolean {
  return USERNAME_RE.test(name);
}
