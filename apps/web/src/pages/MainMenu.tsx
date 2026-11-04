import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { isValidRoomCode, levelProgress, normalizeRoomCode } from '@shadow-hunt/shared';
import { Avatar, MenuButton, Spinner } from '../components/ui';
import { createRoom, joinRoom, quickMatch } from '../multiplayer/net';
import { useRoom } from '../stores/room';
import { useSession } from '../stores/session';
import { useUi } from '../stores/ui';
import { api } from '../services/api';

export function MainMenu() {
  const profile = useSession((s) => s.profile);
  const status = useSession((s) => s.status);
  const go = useUi((s) => s.go);
  const connection = useRoom((s) => s.connection);
  const [panel, setPanel] = useState<'none' | 'play' | 'join'>('none');
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const busy = connection === 'connecting';

  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const join = () =>
    run(async () => {
      const c = normalizeRoomCode(code);
      if (!isValidRoomCode(c)) throw new Error('Room codes are 6 letters/numbers.');
      const info = await api.room(c);
      if (!info.exists) throw new Error('No room with that code.');
      if (!info.joinable) throw new Error('That room is full or a match is in progress.');
      await joinRoom(c);
    });

  const lp = profile ? levelProgress(profile.xp) : null;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="relative z-10 flex h-full flex-col">
      <header className="flex items-center justify-between px-5 pt-5 md:px-10 md:pt-8">
        <div className="text-[11px] tracking-[0.4em] text-dim uppercase">Online · asymmetric horror</div>
        {profile && (
          <button onClick={() => go('profile')} className="flex items-center gap-3 rounded-full border border-line bg-black/40 py-1 pr-4 pl-1 backdrop-blur-sm transition hover:border-bone/30">
            <Avatar id={profile.avatar} size={36} />
            <div className="text-left">
              <div className="text-sm leading-tight">{profile.username}</div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] tracking-widest text-ash uppercase">Lv {lp!.level}</span>
                <span className="h-1 w-16 overflow-hidden rounded-full bg-white/10">
                  <span className="block h-full bg-blood" style={{ width: `${lp!.ratio * 100}%` }} />
                </span>
              </div>
            </div>
          </button>
        )}
      </header>

      <main className="flex flex-1 flex-col justify-center px-5 md:px-14">
        <div className="max-w-lg">
          <motion.h1
            initial={{ opacity: 0, letterSpacing: '0.5em' }}
            animate={{ opacity: 1, letterSpacing: '0.14em' }}
            transition={{ duration: 1.6, ease: 'easeOut' }}
            className="font-display text-5xl leading-none text-bone sm:text-7xl md:text-8xl"
            style={{ textShadow: '0 0 40px rgba(179,32,43,0.35)' }}
          >
            SHADOW
            <br />
            <span className="text-blood animate-flicker">HUNT</span>
          </motion.h1>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }} className="mt-4 font-display text-sm tracking-[0.25em] text-ash md:text-base">
            Stay together. Stay silent. Survive the hunt.
          </motion.p>

          <div className="mt-8 flex w-full max-w-sm flex-col gap-2.5">
            {status === 'offline' ? (
              <div className="rounded-lg border border-ember/40 bg-black/50 p-4 text-sm text-ember">
                Cannot reach the game server. <button className="underline" onClick={() => useSession.getState().init()}>Retry</button>
              </div>
            ) : status !== 'ready' ? (
              <div className="flex items-center gap-3 text-sm text-ash">
                <Spinner /> Waking the dark…
              </div>
            ) : (
              <AnimatePresence mode="wait">
                {panel === 'none' && (
                  <motion.div key="main" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="flex flex-col gap-2.5">
                    <MenuButton primary onClick={() => setPanel('play')} hint="Create · Join · Quick">
                      Play
                    </MenuButton>
                    <div className="grid grid-cols-2 gap-2.5">
                      <MenuButton onClick={() => go('characters')}>Characters</MenuButton>
                      <MenuButton onClick={() => go('inventory')}>Inventory</MenuButton>
                      <MenuButton onClick={() => go('stats')}>Statistics</MenuButton>
                      <MenuButton onClick={() => go('friends')}>Friends</MenuButton>
                      <MenuButton onClick={() => go('settings')}>Settings</MenuButton>
                      <MenuButton onClick={() => go('profile')}>Profile</MenuButton>
                    </div>
                  </motion.div>
                )}
                {panel === 'play' && (
                  <motion.div key="play" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="flex flex-col gap-2.5">
                    <MenuButton primary disabled={busy} onClick={() => run(() => createRoom(false))} hint="Private · invite friends">
                      Create Room
                    </MenuButton>
                    <MenuButton disabled={busy} onClick={() => setPanel('join')} hint="Enter a code">
                      Join Room
                    </MenuButton>
                    <MenuButton disabled={busy} onClick={() => run(quickMatch)} hint="Public lobby">
                      Quick Match
                    </MenuButton>
                    <button className="btn btn-ghost self-start" onClick={() => setPanel('none')}>
                      ← Back
                    </button>
                  </motion.div>
                )}
                {panel === 'join' && (
                  <motion.form
                    key="join"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="flex flex-col gap-2.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void join();
                    }}
                  >
                    <label className="label">Room code</label>
                    <input
                      autoFocus
                      className="field text-center font-mono text-2xl tracking-[0.5em] uppercase"
                      value={code}
                      maxLength={6}
                      onChange={(e) => setCode(normalizeRoomCode(e.target.value))}
                      placeholder="XXXXXX"
                      inputMode="text"
                      autoCapitalize="characters"
                      autoComplete="off"
                    />
                    <button className="btn btn-primary" disabled={busy || code.length !== 6}>
                      {busy ? <Spinner /> : 'Join'}
                    </button>
                    <button type="button" className="btn btn-ghost self-start" onClick={() => setPanel('play')}>
                      ← Back
                    </button>
                  </motion.form>
                )}
              </AnimatePresence>
            )}
            {(err || useRoom.getState().error) && <div className="text-sm text-red-300">{err ?? useRoom.getState().error}</div>}
            {busy && (
              <div className="flex items-center gap-2 text-sm text-ash">
                <Spinner /> Connecting…
              </div>
            )}
          </div>
        </div>
      </main>
      <footer className="px-5 pb-4 text-[10px] tracking-widest text-dim uppercase md:px-10">
        Headphones recommended · WASD + mouse or touch
      </footer>
    </motion.div>
  );
}
