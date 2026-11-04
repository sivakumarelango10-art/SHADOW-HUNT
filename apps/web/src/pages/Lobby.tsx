import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  CHARACTERS,
  HUNTER_IDS,
  MAPS,
  MAP_IDS,
  MATCH,
  SURVIVOR_IDS,
  isCharacterUnlocked,
  type CharacterId,
  type MapId,
} from '@shadow-hunt/shared';
import { Avatar, Segmented, Spinner, Toggle } from '../components/ui';
import { CharacterPreview } from '../components/CharacterPreview';
import { leaveRoom, send } from '../multiplayer/net';
import { useRoom, type RoomSnapshot } from '../stores/room';
import { useSession } from '../stores/session';
import { audio } from '../game/audio/audio';
import { abilityText } from '../game/hud/abilityText';

export function Lobby({ snap }: { snap: RoomSnapshot }) {
  const sessionId = useRoom((s) => s.sessionId);
  const ping = useRoom((s) => s.ping);
  const connection = useRoom((s) => s.connection);
  const profile = useSession((s) => s.profile);
  const me = snap.players.find((p) => p.sessionId === sessionId);
  const isHost = snap.hostId === sessionId;
  const [tab, setTab] = useState<'survivor' | 'hunter'>('survivor');
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const level = profile?.level ?? 1;
  const humans = snap.players.filter((p) => !p.isBot);
  const everyoneReady = humans.every((p) => p.ready || p.isHost);
  const enough = snap.hunterMode === 'bot' ? humans.length >= 1 : humans.length >= MATCH.minPlayers;

  if (!me) return null;
  const selected = (tab === 'survivor' ? me.survivorChar : me.hunterChar) as CharacterId;
  const def = CHARACTERS[selected];
  const inviteUrl = `${location.origin}${location.pathname}?room=${snap.code}`;

  const copy = async (what: 'code' | 'link') => {
    const text = what === 'code' ? snap.code : inviteUrl;
    try {
      if (what === 'link' && navigator.share && /Mobi/i.test(navigator.userAgent)) {
        await navigator.share({ title: 'Shadow Hunt', text: `Join my Shadow Hunt room: ${snap.code}`, url: inviteUrl });
      } else {
        await navigator.clipboard.writeText(text);
      }
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* user cancelled */
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative z-10 flex h-full flex-col overflow-y-auto">
      <header className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-4 md:px-8">
        <button className="btn btn-ghost px-3" onClick={() => void leaveRoom()}>
          ← Leave
        </button>
        <div>
          <div className="label">{snap.isPublic ? 'Public lobby' : 'Private room'}</div>
          <button
            onClick={() => copy('code')}
            className="font-mono text-3xl tracking-[0.35em] text-bone transition hover:text-white"
            title="Copy room code"
          >
            {snap.code}
          </button>
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={() => copy('code')}>
            {copied === 'code' ? 'Copied ✓' : 'Copy code'}
          </button>
          <button className="btn" onClick={() => copy('link')}>
            {copied === 'link' ? 'Copied ✓' : 'Copy invite link'}
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-ash">
          <span className={`h-2 w-2 rounded-full ${connection === 'connected' ? 'bg-emerald-400' : 'animate-pulse bg-ember'}`} />
          {connection === 'connected' ? `Connected · ${ping} ms` : 'Reconnecting…'}
        </div>
      </header>

      <div className="grid flex-1 gap-5 p-5 md:p-8 lg:grid-cols-[1fr_1.2fr_1fr]">
        {/* Players */}
        <section className="panel flex flex-col p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="label">
              Players · {snap.players.length}/{MATCH.maxPlayers}
            </h2>
            <span className="text-xs text-dim">1 hunter vs the rest</span>
          </div>
          <div className="flex flex-col gap-2">
            {snap.players.map((p) => (
              <div
                key={p.sessionId}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${p.sessionId === sessionId ? 'border-bone/25 bg-white/[0.03]' : 'border-line'}`}
              >
                <Avatar id={p.avatar} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm">{p.name}</span>
                    {p.isHost && <span className="chip border-amber-300/30 text-amber-200">host</span>}
                    {p.preferHunter && <span className="chip border-blood/40 text-red-300">wants hunter</span>}
                  </div>
                  <div className="text-[11px] text-dim">
                    Lv {p.level}
                    {p.title ? ` · ${p.title}` : ''} · {CHARACTERS[p.survivorChar as CharacterId]?.name} /{' '}
                    {CHARACTERS[p.hunterChar as CharacterId]?.name}
                  </div>
                </div>
                {!p.connected ? (
                  <span className="text-[11px] text-ember">offline</span>
                ) : (
                  <span
                    className={`text-[11px] tracking-widest uppercase ${p.ready || p.isHost ? 'text-emerald-300' : 'text-dim'}`}
                  >
                    {p.ready || p.isHost ? 'Ready' : 'Not ready'}
                  </span>
                )}
                {isHost && p.sessionId !== sessionId && (
                  <button
                    className="text-xs text-dim hover:text-red-300"
                    onClick={() => send('kick', { sessionId: p.sessionId })}
                    title="Remove from room"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            {snap.players.length < 2 && (
              <div className="rounded-lg border border-dashed border-line p-4 text-center text-sm text-dim">
                Share the code — friends join from “Join Room”, or open the invite link.
              </div>
            )}
          </div>
          <Chat />
        </section>

        {/* Character select */}
        <section className="panel flex flex-col p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="label">Your character</h2>
            <Segmented
              value={tab}
              options={[
                { value: 'survivor', label: 'Survivor' },
                { value: 'hunter', label: 'Hunter' },
              ]}
              onChange={setTab}
            />
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-4">
            <CharacterPreview id={selected} skin={profile?.equippedSkins[selected] ?? 'default'} className="h-64 md:h-80" />
            <div className="flex flex-col gap-1.5">
              {(tab === 'survivor' ? SURVIVOR_IDS : HUNTER_IDS).map((id) => {
                const c = CHARACTERS[id];
                const unlocked = isCharacterUnlocked(id, level);
                return (
                  <button
                    key={id}
                    disabled={!unlocked}
                    onClick={() => {
                      audio.ui('ui_click');
                      send('setCharacter', { characterId: id });
                    }}
                    className={`rounded-md border px-3 py-1.5 text-left text-sm transition ${
                      selected === id ? 'border-bone/60 bg-white/[0.06]' : 'border-line hover:border-bone/30'
                    } ${unlocked ? '' : 'opacity-40'}`}
                  >
                    {c.name}
                    {!unlocked && <span className="block text-[10px] text-dim">Level {c.unlockLevel}</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-3">
            <div className="heading text-xl">{def.name}</div>
            <div className="text-sm text-ash italic">{def.tagline}</div>
            <p className="mt-2 text-sm text-bone/80">{def.bio}</p>
            <p className="mt-2 text-xs text-ash">{def.perk ?? (def.ability ? abilityText(def.ability) : '')}</p>
          </div>
          <div className="mt-auto flex flex-col gap-2 pt-4">
            <Toggle
              label="I want to be the hunter"
              value={me.preferHunter}
              onChange={(v) => send('setPreferHunter', { prefer: v })}
            />
            {!isHost && (
              <button className={`btn ${me.ready ? '' : 'btn-primary'}`} onClick={() => send('setReady', { ready: !me.ready })}>
                {me.ready ? 'Not ready' : 'Ready up'}
              </button>
            )}
          </div>
        </section>

        {/* Map + host settings */}
        <section className="panel flex flex-col p-4">
          <h2 className="label mb-3">Map</h2>
          <div className="flex flex-col gap-2">
            {MAP_IDS.map((id) => (
              <MapCard
                key={id}
                id={id}
                selected={snap.mapId === id}
                disabled={!isHost}
                onClick={() => send('setMap', { mapId: id })}
              />
            ))}
          </div>
          <h2 className="label mt-5 mb-2">Match settings {isHost ? '' : '(host)'}</h2>
          <div className={`flex flex-col gap-3 ${isHost ? '' : 'pointer-events-none opacity-60'}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm">Time limit</span>
              <Segmented
                value={snap.matchMinutes}
                options={MATCH.minuteOptions.map((m) => ({ value: m, label: `${m}m` }))}
                onChange={(m) => send('setSettings', { matchMinutes: m })}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm">Generators</span>
              <Segmented
                value={snap.generatorsSetting}
                options={[
                  { value: 0, label: 'Auto' },
                  { value: 3, label: '3' },
                  { value: 4, label: '4' },
                  { value: 5, label: '5' },
                ]}
                onChange={(g) => send('setSettings', { generatorsRequired: g })}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm">Hunter</span>
              <Segmented
                value={snap.hunterMode}
                options={[
                  { value: 'player', label: 'A player' },
                  { value: 'bot', label: 'Bot' },
                ]}
                onChange={(m) => send('setSettings', { hunterMode: m })}
              />
            </div>
            <p className="text-[11px] text-dim">
              {snap.hunterMode === 'bot'
                ? 'Everyone plays survivor against an AI hunter (good for practice or small groups).'
                : 'One player is chosen as the hunter — volunteers first.'}
            </p>
          </div>
          <div className="mt-auto pt-5">
            {isHost ? (
              <button
                className="btn btn-primary w-full py-3 font-display text-base tracking-[0.2em] uppercase"
                disabled={!enough || !everyoneReady}
                onClick={() => send('startMatch', {})}
              >
                Start the hunt
              </button>
            ) : (
              <div className="flex items-center justify-center gap-2 text-sm text-ash">
                <Spinner /> Waiting for the host…
              </div>
            )}
            {isHost && !enough && (
              <p className="mt-2 text-center text-xs text-dim">
                Need {snap.hunterMode === 'bot' ? 1 : MATCH.minPlayers}+ players — or switch the hunter to Bot.
              </p>
            )}
            {isHost && enough && !everyoneReady && (
              <p className="mt-2 text-center text-xs text-dim">Waiting for everyone to ready up.</p>
            )}
          </div>
        </section>
      </div>
    </motion.div>
  );
}

function MapCard({ id, selected, disabled, onClick }: { id: MapId; selected: boolean; disabled: boolean; onClick: () => void }) {
  const m = MAPS[id];
  return (
    <button
      disabled={disabled && !selected}
      onClick={onClick}
      className={`relative overflow-hidden rounded-lg border p-3 text-left transition ${selected ? 'border-blood/70' : 'border-line hover:border-bone/30'} disabled:cursor-default`}
      style={{
        background:
          id === 'blackwood'
            ? 'linear-gradient(135deg, rgba(20,32,24,0.9), rgba(8,10,12,0.9))'
            : 'linear-gradient(135deg, rgba(36,40,44,0.9), rgba(10,10,12,0.9))',
      }}
    >
      <div className="heading text-base">{m.name}</div>
      <div className="text-[11px] text-ash">{m.subtitle}</div>
      <p className="mt-1 line-clamp-2 text-xs text-dim">{m.description}</p>
      {selected && <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-blood shadow-[0_0_8px_var(--color-blood)]" />}
    </button>
  );
}

function Chat() {
  const chat = useRoom((s) => s.chat);
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [chat]);
  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col">
      <div ref={box} className="max-h-40 min-h-20 flex-1 overflow-y-auto rounded-md border border-line bg-night/60 p-2 text-xs">
        {chat.map((m, i) => (
          <div key={i} className={m.from ? 'text-bone/90' : 'text-dim italic'}>
            {m.from && <span className="text-ash">{m.name}: </span>}
            {m.text}
          </div>
        ))}
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) send('chat', { text });
          setText('');
        }}
      >
        <input
          className="field py-1.5 text-sm"
          placeholder="Say something…"
          value={text}
          maxLength={140}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn py-1.5">Send</button>
      </form>
    </div>
  );
}
