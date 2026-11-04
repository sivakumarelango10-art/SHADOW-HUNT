import {
  computeXp,
  evaluateAchievements,
  levelFromXp,
  unlocksBetween,
  type CharacterId,
  type GameOutcome,
  type MapId,
  type MatchResults,
  type PlayerResult,
  type Profile,
  type Role,
} from '@shadow-hunt/shared';
import type { PlayerState } from '../rooms/schema.ts';
import { getStore, type MatchPlayerRecord } from '../services/store.ts';
import { log } from '../utils/log.ts';
import type { Game } from './Game.ts';

/**
 * Builds match results from authoritative server state and persists XP, stats and
 * achievements. Nothing here is derived from client-reported data.
 */
export async function finalizeMatch(
  game: Game,
  winner: 'survivors' | 'hunter',
  playerIds: Map<string, string>,
): Promise<MatchResults> {
  const s = game.state;
  const players = [...s.players.values()];
  const survivors = players.filter((p) => p.role === 'survivor');
  const escaped = survivors.filter((p) => p.condition === 'escaped').length;
  const hunter = players.find((p) => p.role === 'hunter');
  const store = getStore();
  const duration = Math.round(s.elapsed);
  const records: MatchPlayerRecord[] = [];
  const results: PlayerResult[] = [];

  for (const p of players) {
    const rt = game.runtime(p.sessionId);
    if (!rt) continue;
    const role = p.role as Role;
    const won = (role === 'survivor') === (winner === 'survivors');
    const outcome: GameOutcome =
      role === 'hunter' ? (won ? 'hunter_win' : 'hunter_loss') : p.condition === 'escaped' ? 'escaped' : 'eliminated';
    const xp = computeXp({ role, outcome, won, stats: rt.stats });
    const base: PlayerResult = {
      sessionId: p.sessionId,
      playerId: p.playerId,
      name: p.name,
      role,
      characterId: p.characterId as CharacterId,
      outcome,
      stats: { ...rt.stats, generatorProgress: Math.round(rt.stats.generatorProgress * 100) / 100 },
      xpGained: p.isBot ? 0 : xp.total,
      xpBreakdown: p.isBot ? [] : xp.breakdown,
      newAchievements: [],
      levelBefore: p.level,
      levelAfter: p.level,
      unlocked: [],
      isBot: p.isBot,
    };
    const profileId = playerIds.get(p.sessionId);
    if (!p.isBot && profileId) {
      try {
        const prof = await store.getProfile(profileId);
        if (prof) {
          const after = applyToProfile(prof, {
            role,
            won,
            outcome,
            xp: xp.total,
            duration,
            stats: rt.stats,
            survivorsTotal: survivors.length,
            survivorsEscaped: escaped,
          });
          base.levelBefore = prof.level;
          base.levelAfter = after.profile.level;
          base.newAchievements = after.newAchievements;
          base.unlocked = unlocksBetween(prof.level, after.profile.level);
          records.push({
            playerId: profileId,
            role,
            characterId: p.characterId as CharacterId,
            outcome,
            won,
            xpGained: xp.total,
            stats: rt.stats,
            profileAfter: after.profile,
          });
        }
      } catch (e) {
        log.error('failed to load profile for results', { error: String(e), player: profileId });
      }
    }
    results.push(base);
  }

  const out: MatchResults = {
    matchId: s.matchId,
    mapId: s.mapId as MapId,
    winner,
    durationSeconds: duration,
    survivorsEscaped: escaped,
    survivorsTotal: survivors.length,
    generatorsCompleted: s.generatorsCompleted,
    generatorsRequired: s.generatorsRequired,
    hunterCaptures: hunter ? (game.runtime(hunter.sessionId)?.stats.captures ?? 0) : 0,
    players: results,
    persisted: false,
  };

  try {
    await store.saveMatch({
      matchId: out.matchId,
      mapId: out.mapId,
      winner,
      durationSeconds: duration,
      survivorsTotal: survivors.length,
      survivorsEscaped: escaped,
      generatorsCompleted: s.generatorsCompleted,
      results: out,
      players: records,
    });
    out.persisted = true;
  } catch (e) {
    log.error('failed to persist match', { error: String(e), match: out.matchId });
  }
  // Keep the replicated level in sync so the lobby shows new levels immediately.
  for (const r of records) {
    const p = players.find((x: PlayerState) => playerIds.get(x.sessionId) === r.playerId);
    if (p) p.level = r.profileAfter.level;
  }
  return out;
}

export function applyToProfile(
  prof: Profile,
  m: {
    role: Role;
    won: boolean;
    outcome: GameOutcome;
    xp: number;
    duration: number;
    stats: MatchPlayerRecord['stats'];
    survivorsTotal: number;
    survivorsEscaped: number;
  },
): { profile: Profile; newAchievements: string[] } {
  const p: Profile = structuredClone(prof);
  const st = p.stats;
  st.totalMatches++;
  if (m.won) st.wins++;
  else st.losses++;
  if (m.role === 'survivor') {
    st.survivorMatches++;
    if (m.outcome === 'escaped') st.escapes++;
    st.rescues += m.stats.rescues;
    st.generatorsRepaired += m.stats.generatorProgress;
  } else {
    st.hunterMatches++;
    st.captures += m.stats.captures;
    st.eliminations += m.stats.eliminations;
  }
  st.playtimeSeconds += m.duration;
  p.xp += m.xp;
  p.level = levelFromXp(p.xp);
  const newAchievements = evaluateAchievements(
    {
      role: m.role,
      outcome: m.outcome,
      stats: m.stats,
      survivorsTotal: m.survivorsTotal,
      survivorsEscaped: m.survivorsEscaped,
      lifetime: st,
    },
    p.achievements,
  );
  p.achievements = [...p.achievements, ...newAchievements];
  return { profile: p, newAchievements };
}
