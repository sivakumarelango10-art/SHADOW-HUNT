import { motion } from 'motion/react';
import { ACHIEVEMENTS, CHARACTERS, type CharacterId, type MatchResults } from '@shadow-hunt/shared';
import { Spinner } from '../components/ui';
import { leaveRoom, send } from '../multiplayer/net';
import { useRoom } from '../stores/room';

const OUTCOME: Record<string, string> = {
  escaped: 'Escaped',
  eliminated: 'Taken',
  survived_timeout: 'Survived',
  hunter_win: 'Victorious',
  hunter_loss: 'Defeated',
};

export function Results({ results }: { results: MatchResults | null }) {
  const sessionId = useRoom((s) => s.sessionId);
  const snap = useRoom((s) => s.snap);
  const isHost = snap?.hostId === sessionId;
  if (!results) {
    return (
      <div className="relative z-10 flex h-full items-center justify-center gap-3 text-ash">
        <Spinner /> Counting the survivors…
      </div>
    );
  }
  const mine = results.players.find((p) => p.sessionId === sessionId);
  const won = mine ? (mine.role === 'survivor') === (results.winner === 'survivors') : false;
  const mins = `${Math.floor(results.durationSeconds / 60)}:${String(results.durationSeconds % 60).padStart(2, '0')}`;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative z-10 flex h-full flex-col overflow-y-auto bg-black/60 backdrop-blur-sm">
      <div className="mx-auto w-full max-w-5xl px-5 py-8 md:py-12">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }} className="text-center">
          <div className="label">{results.winner === 'survivors' ? 'The survivors escaped' : 'The hunter prevailed'}</div>
          <h1 className={`heading mt-2 text-6xl md:text-7xl ${won ? 'text-bone' : 'text-blood'}`}>{won ? 'Victory' : 'Defeat'}</h1>
          <div className="mt-3 flex flex-wrap justify-center gap-4 text-sm text-ash">
            <span>Duration {mins}</span>
            <span>
              Escaped {results.survivorsEscaped}/{results.survivorsTotal}
            </span>
            <span>
              Generators {results.generatorsCompleted}/{results.generatorsRequired}
            </span>
            <span>Captures {results.hunterCaptures}</span>
          </div>
        </motion.div>

        {mine && !mine.isBot && (
          <div className="panel mx-auto mt-8 max-w-xl p-5">
            <div className="flex items-baseline justify-between">
              <span className="label">Your rewards</span>
              <span className="heading text-2xl text-amber-200">+{mine.xpGained} XP</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              {mine.xpBreakdown.map((b) => (
                <div key={b.label} className="flex justify-between text-ash">
                  <span>{b.label}</span>
                  <span className="text-bone tabular-nums">+{b.xp}</span>
                </div>
              ))}
            </div>
            {mine.levelAfter > mine.levelBefore && (
              <div className="mt-4 rounded-md border border-amber-300/30 bg-amber-300/5 p-3 text-sm text-amber-100">
                Level up! {mine.levelBefore} → {mine.levelAfter}
                {mine.unlocked.length > 0 && <div className="mt-1 text-xs text-amber-200/80">Unlocked: {mine.unlocked.join(', ')}</div>}
              </div>
            )}
            {mine.newAchievements.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {mine.newAchievements.map((a) => (
                  <span key={a} className="chip border-amber-300/40 text-amber-200">
                    🏆 {ACHIEVEMENTS.find((x) => x.id === a)?.name ?? a}
                  </span>
                ))}
              </div>
            )}
            {!results.persisted && <div className="mt-3 text-xs text-ember">Progress could not be saved this time.</div>}
          </div>
        )}

        <div className="panel mt-6 overflow-x-auto p-4">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-[11px] tracking-widest text-dim uppercase">
              <tr>
                <th className="pb-2">Player</th>
                <th>Role</th>
                <th>Outcome</th>
                <th className="text-right">Repairs</th>
                <th className="text-right">Rescues</th>
                <th className="text-right">Hits</th>
                <th className="text-right">Captures</th>
                <th className="text-right">XP</th>
              </tr>
            </thead>
            <tbody>
              {results.players.map((p) => (
                <tr key={p.sessionId} className={`border-t border-line ${p.sessionId === sessionId ? 'bg-white/[0.03]' : ''}`}>
                  <td className="py-2">
                    {p.name}
                    <div className="text-[11px] text-dim">{CHARACTERS[p.characterId as CharacterId]?.name}</div>
                  </td>
                  <td className={p.role === 'hunter' ? 'text-blood' : 'text-ash'}>{p.role}</td>
                  <td>{OUTCOME[p.outcome] ?? p.outcome}</td>
                  <td className="text-right tabular-nums">{Math.round(p.stats.generatorProgress * 100)}%</td>
                  <td className="text-right tabular-nums">{p.stats.rescues}</td>
                  <td className="text-right tabular-nums">{p.role === 'hunter' ? p.stats.hits : p.stats.timesHit}</td>
                  <td className="text-right tabular-nums">{p.role === 'hunter' ? p.stats.captures : p.stats.timesCaptured}</td>
                  <td className="text-right text-amber-200 tabular-nums">{p.isBot ? '—' : `+${p.xpGained}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {isHost ? (
            <>
              <button className="btn btn-primary px-6" onClick={() => send('startMatch', {})}>
                Rematch
              </button>
              <button className="btn px-6" onClick={() => send('returnToLobby', {})}>
                Return to lobby
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2 text-sm text-ash">
              <Spinner /> The host can start a rematch or return everyone to the lobby.
            </div>
          )}
          <button className="btn btn-ghost px-6" onClick={() => void leaveRoom()}>
            Leave room
          </button>
        </div>
      </div>
    </motion.div>
  );
}
