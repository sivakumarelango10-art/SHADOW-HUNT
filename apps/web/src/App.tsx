import { lazy, Suspense, useEffect, useRef } from 'react';
import { AnimatePresence } from 'motion/react';
import { isValidRoomCode, normalizeRoomCode, type CharacterId, type MapId } from '@shadow-hunt/shared';
import { useSession } from './stores/session';
import { useRoom } from './stores/room';
import { useUi } from './stores/ui';
import { useHud } from './stores/hud';
import { joinRoom, tryResume } from './multiplayer/net';
import { MainMenu } from './pages/MainMenu';
import { Lobby } from './pages/Lobby';
import { Results } from './pages/Results';
import { SettingsPage } from './pages/SettingsPage';
import { CharactersPage, FriendsPage, InventoryPage, ProfilePage, StatsPage } from './pages/MenuPages';
import { audio } from './game/audio/audio';
import { Spinner } from './components/ui';

const GameWorld = lazy(() => import('./game/GameWorld').then((m) => ({ default: m.GameWorld })));
const MenuScene = lazy(() => import('./game/MenuScene').then((m) => ({ default: m.MenuScene })));
const Hud = lazy(() => import('./game/hud/Hud').then((m) => ({ default: m.Hud })));

export default function App() {
  const status = useSession((s) => s.status);
  const snap = useRoom((s) => s.snap);
  const sessionId = useRoom((s) => s.sessionId);
  const results = useRoom((s) => s.results);
  const error = useRoom((s) => s.error);
  const screen = useUi((s) => s.screen);
  const booted = useRef(false);

  useEffect(() => {
    void useSession.getState().init();
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }, []);

  // After sign-in: resume a dropped session, or follow an invite link.
  useEffect(() => {
    if (status !== 'ready' || booted.current) return;
    booted.current = true;
    void (async () => {
      if (await tryResume()) return;
      const params = new URLSearchParams(location.search);
      const code = normalizeRoomCode(params.get('room') ?? '');
      if (code) {
        history.replaceState(null, '', location.pathname);
        if (isValidRoomCode(code)) await joinRoom(code).catch(() => {});
      }
    })();
  }, [status]);

  useEffect(() => {
    if (snap?.phase !== 'playing') useHud.getState().set({ paused: false });
  }, [snap?.phase]);

  const me = snap?.players.find((p) => p.sessionId === sessionId);
  const inMatch = snap && me && (snap.phase === 'countdown' || snap.phase === 'playing' || snap.phase === 'results');

  return (
    <div className="grain relative h-full w-full overflow-hidden bg-void">
      {!inMatch && (
        <Suspense fallback={null}>
          <div className="absolute inset-0 opacity-90">
            <MenuScene />
          </div>
          <div className="vignette pointer-events-none absolute inset-0" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/85 via-black/40 to-transparent" />
        </Suspense>
      )}

      {inMatch ? (
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center gap-3 text-ash">
              <Spinner /> Entering {snap.mapId === 'asylum' ? 'the asylum' : 'the forest'}…
            </div>
          }
        >
          <GameWorld mapId={snap.mapId as MapId} characterId={me.characterId as CharacterId} skinId={me.skinId} />
          <div className="vignette pointer-events-none absolute inset-0" />
          {snap.phase !== 'results' && <Hud snap={snap} me={me} />}
          {snap.phase === 'results' && (
            <div className="absolute inset-0 z-30">
              <Results results={results} />
            </div>
          )}
        </Suspense>
      ) : snap && me ? (
        <Lobby snap={snap} />
      ) : (
        <AnimatePresence mode="wait">
          {screen === 'menu' && <MainMenu key="menu" />}
          {screen === 'characters' && <CharactersPage key="ch" />}
          {screen === 'inventory' && <InventoryPage key="inv" />}
          {screen === 'settings' && <SettingsPage key="set" />}
          {screen === 'stats' && <StatsPage key="stats" />}
          {screen === 'friends' && <FriendsPage key="fr" />}
          {screen === 'profile' && <ProfilePage key="pr" />}
        </AnimatePresence>
      )}

      {error && !snap && (
        <div className="absolute bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-blood/40 bg-black/80 px-4 py-2 text-sm text-red-200">
          {error}
          <button className="ml-3 text-ash hover:text-bone" onClick={() => useRoom.getState().set({ error: null })}>
            ✕
          </button>
        </div>
      )}
      <RotateHint />
    </div>
  );
}

/** Phones in portrait get a nudge to rotate — the HUD is designed for landscape. */
function RotateHint() {
  const snap = useRoom((s) => s.snap);
  const playing = snap?.phase === 'playing' || snap?.phase === 'countdown';
  if (!playing) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[60] hidden items-center justify-center bg-black/90 text-center portrait:max-md:flex">
      <div>
        <div className="mb-3 text-4xl">⟳</div>
        <div className="heading text-xl">Rotate your device</div>
        <div className="mt-1 text-sm text-ash">Shadow Hunt plays in landscape.</div>
      </div>
    </div>
  );
}
