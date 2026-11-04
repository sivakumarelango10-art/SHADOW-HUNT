import { useEffect, useState } from 'react';
import {
  ACHIEVEMENTS,
  AVATARS,
  CHARACTERS,
  HUNTER_IDS,
  MAPS,
  SURVIVOR_IDS,
  TITLES,
  isCharacterUnlocked,
  isValidUsername,
  levelProgress,
  titlesFor,
  type CharacterId,
  type FriendEntry,
  type MatchHistoryEntry,
} from '@shadow-hunt/shared';
import { Avatar, PageShell, Segmented, Spinner } from '../components/ui';
import { CharacterPreview } from '../components/CharacterPreview';
import { api } from '../services/api';
import { supabaseConfigured, useSession } from '../stores/session';
import { useUi } from '../stores/ui';
import { joinRoom } from '../multiplayer/net';
import { abilityText } from '../game/hud/abilityText';

const back = () => useUi.getState().go('menu');

export function CharactersPage() {
  const profile = useSession((s) => s.profile);
  const [tab, setTab] = useState<'survivor' | 'hunter'>('survivor');
  const ids = tab === 'survivor' ? SURVIVOR_IDS : HUNTER_IDS;
  const [sel, setSel] = useState<CharacterId>(ids[0]!);
  useEffect(() => setSel((tab === 'survivor' ? SURVIVOR_IDS : HUNTER_IDS)[0]!), [tab]);
  const def = CHARACTERS[sel];
  const level = profile?.level ?? 1;
  const unlocked = isCharacterUnlocked(sel, level);
  return (
    <PageShell title="Characters" subtitle="Unlocked by playing — never by paying" onBack={back} wide>
      <div className="mb-4">
        <Segmented
          value={tab}
          options={[
            { value: 'survivor', label: 'Survivors' },
            { value: 'hunter', label: 'Hunters' },
          ]}
          onChange={setTab}
        />
      </div>
      <div className="grid gap-5 md:grid-cols-[220px_1fr]">
        <div className="flex flex-row flex-wrap gap-2 md:flex-col">
          {ids.map((id) => (
            <button
              key={id}
              onClick={() => setSel(id)}
              className={`rounded-lg border px-4 py-2.5 text-left transition ${sel === id ? 'border-bone/50 bg-white/[0.05]' : 'border-line hover:border-bone/25'} ${isCharacterUnlocked(id, level) ? '' : 'opacity-50'}`}
            >
              <div className="font-display tracking-wider">{CHARACTERS[id].name}</div>
              <div className="text-[11px] text-dim">
                {isCharacterUnlocked(id, level) ? CHARACTERS[id].tagline : `Unlocks at level ${CHARACTERS[id].unlockLevel}`}
              </div>
            </button>
          ))}
        </div>
        <div className="panel grid gap-4 p-5 md:grid-cols-2">
          <CharacterPreview id={sel} skin={profile?.equippedSkins[sel] ?? 'default'} className="h-80" />
          <div>
            <div className="heading text-3xl">{def.name}</div>
            <div className="text-ash italic">{def.tagline}</div>
            <p className="mt-3 text-sm text-bone/85">{def.bio}</p>
            <div className="mt-4 rounded-md border border-line p-3 text-sm">
              <div className="label mb-1">{def.role === 'hunter' ? 'Power' : 'Perk'}</div>
              {def.perk ?? (def.ability ? abilityText(def.ability) : '')}
            </div>
            <div className="mt-3 text-xs text-dim">
              {unlocked ? 'Unlocked' : `Reach level ${def.unlockLevel} to play ${def.name}.`}
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}

export function InventoryPage() {
  const profile = useSession((s) => s.profile);
  const setProfile = useSession((s) => s.setProfile);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!profile) return null;
  const equip = async (characterId: string, skinId: string) => {
    setBusy(`${characterId}:${skinId}`);
    setErr(null);
    try {
      setProfile((await api.updateProfile({ skin: { characterId, skinId } })).profile);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const setTitle = async (title: string) => {
    try {
      setProfile((await api.updateProfile({ title })).profile);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const owned = titlesFor(profile.level, profile.achievements);
  return (
    <PageShell title="Inventory" subtitle="Cosmetics and titles you have earned" onBack={back} wide>
      {err && <div className="mb-3 text-sm text-red-300">{err}</div>}
      <h2 className="label mb-2">Titles</h2>
      <div className="mb-6 flex flex-wrap gap-2">
        {TITLES.map((t) => {
          const has = owned.some((o) => o.id === t.id);
          return (
            <button
              key={t.id}
              disabled={!has}
              onClick={() => setTitle(t.id)}
              className={`chip px-3 py-1 text-xs ${profile.title === t.id ? 'border-blood text-bone' : ''} ${has ? 'hover:border-bone/40' : 'opacity-40'}`}
              title={t.level ? `Level ${t.level}` : `Achievement: ${ACHIEVEMENTS.find((a) => a.id === t.achievement)?.name}`}
            >
              {t.name}
            </button>
          );
        })}
      </div>
      <h2 className="label mb-2">Skins</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[...SURVIVOR_IDS, ...HUNTER_IDS].map((id) => {
          const c = CHARACTERS[id];
          return (
            <div key={id} className="panel p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-display tracking-wider">{c.name}</span>
                <span className="text-[10px] tracking-widest text-dim uppercase">{c.role}</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {c.skins.map((sk) => {
                  const has = profile.level >= sk.unlockLevel && profile.level >= c.unlockLevel;
                  const equipped = (profile.equippedSkins[id] ?? 'default') === sk.id;
                  return (
                    <div key={sk.id} className="flex items-center gap-2 rounded-md border border-line px-2 py-1.5">
                      <span className="flex gap-0.5">
                        {[sk.primary, sk.secondary, sk.accent].map((col) => (
                          <span key={col} className="h-4 w-4 rounded-sm border border-white/10" style={{ background: col }} />
                        ))}
                      </span>
                      <span className="text-sm">{sk.name}</span>
                      <span className="ml-auto">
                        {equipped ? (
                          <span className="text-[11px] text-emerald-300">Equipped</span>
                        ) : has ? (
                          <button className="text-xs text-ash hover:text-bone" disabled={!!busy} onClick={() => equip(id, sk.id)}>
                            {busy === `${id}:${sk.id}` ? <Spinner /> : 'Equip'}
                          </button>
                        ) : (
                          <span className="text-[11px] text-dim">Lv {Math.max(sk.unlockLevel, c.unlockLevel)}</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </PageShell>
  );
}

export function StatsPage() {
  const profile = useSession((s) => s.profile);
  const [history, setHistory] = useState<MatchHistoryEntry[] | null>(null);
  useEffect(() => {
    void useSession.getState().refreshProfile();
    api
      .history()
      .then((r) => setHistory(r.history))
      .catch(() => setHistory([]));
  }, []);
  if (!profile) return null;
  const st = profile.stats;
  const cells: [string, string | number][] = [
    ['Matches', st.totalMatches],
    ['Wins', st.wins],
    ['Losses', st.losses],
    ['Win rate', st.totalMatches ? `${Math.round((st.wins / st.totalMatches) * 100)}%` : '—'],
    ['Escapes', st.escapes],
    ['Rescues', st.rescues],
    ['Generators', st.generatorsRepaired.toFixed(1)],
    ['Hunter captures', st.captures],
    ['Eliminations', st.eliminations],
    ['As survivor', st.survivorMatches],
    ['As hunter', st.hunterMatches],
    ['Playtime', `${Math.floor(st.playtimeSeconds / 3600)}h ${Math.floor((st.playtimeSeconds % 3600) / 60)}m`],
  ];
  return (
    <PageShell title="Statistics" subtitle={`${profile.username} · level ${profile.level}`} onBack={back} wide>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {cells.map(([k, v]) => (
          <div key={k} className="panel p-3">
            <div className="label">{k}</div>
            <div className="heading mt-1 text-2xl">{v}</div>
          </div>
        ))}
      </div>
      <h2 className="label mt-6 mb-2">Achievements</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {ACHIEVEMENTS.map((a) => {
          const has = profile.achievements.includes(a.id);
          return (
            <div
              key={a.id}
              className={`flex items-center gap-3 rounded-lg border p-3 ${has ? 'border-amber-300/40 bg-amber-300/[0.04]' : 'border-line opacity-60'}`}
            >
              <span className="text-xl">{has ? '🏆' : '🔒'}</span>
              <div>
                <div className="font-display tracking-wider">{a.name}</div>
                <div className="text-xs text-ash">{a.description}</div>
              </div>
            </div>
          );
        })}
      </div>
      <h2 className="label mt-6 mb-2">Recent matches</h2>
      <div className="panel overflow-x-auto p-3">
        {!history ? (
          <Spinner />
        ) : history.length === 0 ? (
          <div className="p-3 text-sm text-dim">No matches yet. The night is young.</div>
        ) : (
          <table className="w-full min-w-[520px] text-sm">
            <tbody>
              {history.map((h) => (
                <tr key={h.matchId} className="border-t border-line first:border-t-0">
                  <td className={`py-2 font-semibold ${h.won ? 'text-emerald-300' : 'text-blood'}`}>{h.won ? 'WIN' : 'LOSS'}</td>
                  <td>{MAPS[h.mapId]?.name ?? h.mapId}</td>
                  <td className="text-ash">
                    {CHARACTERS[h.characterId]?.name} · {h.role}
                  </td>
                  <td className="text-ash">{h.outcome.replace('_', ' ')}</td>
                  <td className="text-right text-amber-200">+{h.xpGained}</td>
                  <td className="text-right text-xs text-dim">{new Date(h.playedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PageShell>
  );
}

export function FriendsPage() {
  const [friends, setFriends] = useState<FriendEntry[] | null>(null);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const load = () =>
    api
      .friends()
      .then((r) => setFriends(r.friends))
      .catch((e) => {
        setFriends([]);
        setMsg(e.message);
      });
  useEffect(() => {
    void load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);
  const profile = useSession((s) => s.profile);
  return (
    <PageShell title="Friends" subtitle={`Share your name: ${profile?.username ?? ''}`} onBack={back}>
      <form
        className="mb-5 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setMsg(null);
          try {
            await api.addFriend(name.trim());
            setName('');
            setMsg('Added.');
            void load();
          } catch (err) {
            setMsg(err instanceof Error ? err.message : String(err));
          }
        }}
      >
        <input className="field" placeholder="Add a friend by username" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-primary" disabled={!isValidUsername(name.trim())}>
          Add
        </button>
      </form>
      {msg && <div className="mb-3 text-sm text-ash">{msg}</div>}
      {!friends ? (
        <Spinner />
      ) : friends.length === 0 ? (
        <div className="panel p-6 text-center text-sm text-dim">No friends yet. Add someone by their exact username.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {friends.map((f) => (
            <div key={f.id} className="panel flex items-center gap-3 p-3">
              <Avatar id={f.avatar} size={40} />
              <div className="flex-1">
                <div>{f.username}</div>
                <div className="text-xs text-dim">
                  Lv {f.level} ·{' '}
                  <span className={f.online ? 'text-emerald-300' : ''}>
                    {f.online ? (f.roomCode ? 'In a lobby' : 'Online') : 'Offline'}
                  </span>
                </div>
              </div>
              {f.roomCode && (
                <button className="btn btn-primary" onClick={() => joinRoom(f.roomCode!).catch((e) => setMsg(e.message))}>
                  Join
                </button>
              )}
              <button
                className="btn btn-ghost text-dim"
                onClick={async () => {
                  await api.removeFriend(f.id);
                  void load();
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </PageShell>
  );
}

export function ProfilePage() {
  const { profile, authKind, setProfile, signInWithGoogle, signInWithEmail, signOut } = useSession();
  const [name, setName] = useState(profile?.username ?? '');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  if (!profile) return null;
  const lp = levelProgress(profile.xp);
  const save = async (patch: Parameters<typeof api.updateProfile>[0]) => {
    setMsg(null);
    try {
      setProfile((await api.updateProfile(patch)).profile);
      setMsg('Saved.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <PageShell
      title="Profile"
      subtitle={authKind === 'guest' ? 'Guest profile — saved to this browser' : 'Signed in'}
      onBack={back}
    >
      <div className="panel flex flex-wrap items-center gap-5 p-5">
        <Avatar id={profile.avatar} size={84} />
        <div className="flex-1">
          <div className="heading text-3xl">{profile.username}</div>
          <div className="text-sm text-ash">{TITLES.find((t) => t.id === profile.title)?.name}</div>
          <div className="mt-2 flex items-center gap-3">
            <span className="text-sm">Level {lp.level}</span>
            <div className="h-1.5 w-48 overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-blood" style={{ width: `${lp.ratio * 100}%` }} />
            </div>
            <span className="text-xs text-dim">
              {lp.current}/{lp.needed} XP
            </span>
          </div>
          <div className="mt-1 font-mono text-[10px] text-dim">Player ID {profile.id}</div>
        </div>
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <div className="panel p-5">
          <div className="label mb-2">Username</div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save({ username: name });
            }}
          >
            <input className="field" value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />
            <button className="btn btn-primary" disabled={!isValidUsername(name) || name === profile.username}>
              Save
            </button>
          </form>
          <p className="mt-1 text-xs text-dim">3–16 letters, numbers or underscores. Names are unique.</p>
          <div className="label mt-5 mb-2">Avatar</div>
          <div className="flex flex-wrap gap-2">
            {AVATARS.map((a) => (
              <button
                key={a}
                onClick={() => save({ avatar: a })}
                className={`rounded-full ${profile.avatar === a ? 'ring-2 ring-blood' : ''}`}
              >
                <Avatar id={a} size={48} />
              </button>
            ))}
          </div>
          {msg && <div className="mt-3 text-sm text-ash">{msg}</div>}
        </div>

        <div className="panel p-5">
          <div className="label mb-2">Account</div>
          {authKind === 'account' ? (
            <button className="btn" onClick={() => void signOut()}>
              Sign out
            </button>
          ) : supabaseConfigured ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-ash">
                Sign in to keep your progress across devices. Your guest progress stays on this browser.
              </p>
              <button className="btn" onClick={() => signInWithGoogle().catch((e) => setMsg(e.message))}>
                Continue with Google
              </button>
              <form
                className="flex gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    setMsg(await signInWithEmail(email));
                  } catch (err) {
                    setMsg(err instanceof Error ? err.message : String(err));
                  }
                }}
              >
                <input
                  className="field"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button className="btn" disabled={!email.includes('@')}>
                  Email link
                </button>
              </form>
            </div>
          ) : (
            <p className="text-sm text-ash">
              You are playing as a guest. Accounts (Google / email) become available when this deployment is connected to Supabase
              — see the deployment guide.
            </p>
          )}
          {authKind === 'guest' && (
            <button
              className="btn btn-ghost mt-4 text-dim"
              onClick={() =>
                confirm('Start over with a new guest profile? Your current guest progress will be lost on this browser.') &&
                void signOut()
              }
            >
              Reset guest profile
            </button>
          )}
        </div>
      </div>
    </PageShell>
  );
}
