import type express from 'express';
import { matchMaker } from '@colyseus/core';
import {
  AVATARS,
  CHARACTERS,
  isCharacterId,
  isSkinUnlocked,
  isValidRoomCode,
  isValidUsername,
  normalizeRoomCode,
  titlesFor,
  type FriendEntry,
} from '@shadow-hunt/shared';
import { bearer, issueGuestToken, verifyToken, type Identity } from '../auth/tokens.ts';
import { config } from '../config.ts';
import { presence } from '../services/presence.ts';
import { getStore, StoreError } from '../services/store.ts';
import { log } from '../utils/log.ts';

/** Fixed-window per-IP rate limiter. */
function rateLimit(max: number, windowMs: number): express.RequestHandler {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req, res, next) => {
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.socket.remoteAddress || '?';
    const now = Date.now();
    let h = hits.get(ip);
    if (!h || h.reset < now) hits.set(ip, (h = { n: 0, reset: now + windowMs }));
    if (++h.n > max) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }
    if (hits.size > 10000) hits.clear();
    next();
  };
}

type AuthedRequest = express.Request & { identity?: Identity };

const requireAuth: express.RequestHandler = async (req, res, next) => {
  try {
    const id = await verifyToken(bearer(req.headers.authorization));
    if (!id) {
      res.status(401).json({ error: 'Not signed in' });
      return;
    }
    (req as AuthedRequest).identity = id;
    presence.touch(id.playerId);
    next();
  } catch (e) {
    next(e);
  }
};

function cors(app: express.Application) {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowAll = config.corsOrigins.includes('*');
    if (origin && (allowAll || config.corsOrigins.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });
}

export function registerRoutes(app: express.Application, jsonParser: express.RequestHandler) {
  cors(app);
  const api = rateLimit(240, 60_000);

  app.get('/api/health', async (_req, res) => {
    const rooms = await matchMaker.query({});
    res.json({
      ok: true,
      store: getStore().kind,
      guestSecret: config.guestSecretEphemeral ? 'ephemeral' : 'configured',
      rooms: rooms.length,
      uptime: process.uptime(),
    });
  });

  app.post('/api/auth/guest', rateLimit(20, 60_000), jsonParser, async (req, res, next) => {
    try {
      const { token, playerId } = issueGuestToken();
      const raw = typeof req.body?.name === 'string' ? req.body.name : '';
      const profile = await getStore().ensureProfile({ playerId, isGuest: true, displayName: raw });
      res.json({ token, profile });
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/profile', api, requireAuth, async (req, res, next) => {
    try {
      const id = (req as AuthedRequest).identity!;
      res.json({ profile: await getStore().ensureProfile(id) });
    } catch (e) {
      next(e);
    }
  });

  app.patch('/api/profile', api, requireAuth, jsonParser, async (req, res, next) => {
    try {
      const id = (req as AuthedRequest).identity!;
      const store = getStore();
      const current = await store.ensureProfile(id);
      const body = req.body ?? {};
      const patch: Parameters<typeof store.updateProfile>[1] = {};
      if (body.username !== undefined) {
        if (typeof body.username !== 'string' || !isValidUsername(body.username)) {
          res.status(400).json({ error: 'Names are 3–16 letters, numbers or underscores.' });
          return;
        }
        patch.username = body.username;
      }
      if (body.avatar !== undefined) {
        if (!(AVATARS as readonly string[]).includes(body.avatar)) {
          res.status(400).json({ error: 'Unknown avatar' });
          return;
        }
        patch.avatar = body.avatar;
      }
      if (body.title !== undefined) {
        if (!titlesFor(current.level, current.achievements).some((t) => t.id === body.title)) {
          res.status(400).json({ error: 'Title not unlocked' });
          return;
        }
        patch.title = body.title;
      }
      if (body.skin !== undefined) {
        const { characterId, skinId } = body.skin ?? {};
        if (typeof characterId !== 'string' || !isCharacterId(characterId) || typeof skinId !== 'string') {
          res.status(400).json({ error: 'Invalid skin' });
          return;
        }
        if (!isSkinUnlocked(characterId, skinId, current.level) || current.level < CHARACTERS[characterId].unlockLevel) {
          res.status(400).json({ error: 'Skin not unlocked' });
          return;
        }
        patch.equippedSkins = { ...current.equippedSkins, [characterId]: skinId };
      }
      res.json({ profile: await store.updateProfile(id.playerId, patch) });
    } catch (e) {
      if (e instanceof StoreError && e.code === 'username_taken') {
        res.status(409).json({ error: e.message });
        return;
      }
      next(e);
    }
  });

  app.get('/api/history', api, requireAuth, async (req, res, next) => {
    try {
      const id = (req as AuthedRequest).identity!;
      res.json({ history: await getStore().history(id.playerId, 25) });
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/friends', api, requireAuth, async (req, res, next) => {
    try {
      const id = (req as AuthedRequest).identity!;
      const store = getStore();
      const profiles = await store.getProfiles(await store.friendIds(id.playerId));
      const friends: FriendEntry[] = profiles.map((p) => {
        const st = presence.status(p.id);
        return { id: p.id, username: p.username, avatar: p.avatar, level: p.level, online: st.online, roomCode: st.roomCode };
      });
      friends.sort((a, b) => Number(b.online) - Number(a.online) || a.username.localeCompare(b.username));
      res.json({ friends });
    } catch (e) {
      next(e);
    }
  });

  app.post('/api/friends', api, requireAuth, jsonParser, async (req, res, next) => {
    try {
      const id = (req as AuthedRequest).identity!;
      const name = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
      if (!isValidUsername(name)) {
        res.status(400).json({ error: 'Enter a valid username' });
        return;
      }
      const store = getStore();
      const friend = await store.findByUsername(name);
      if (!friend) {
        res.status(404).json({ error: 'No player with that name' });
        return;
      }
      if (friend.id === id.playerId) {
        res.status(400).json({ error: 'That is you' });
        return;
      }
      await store.addFriend(id.playerId, friend.id);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  app.delete('/api/friends/:id', api, requireAuth, async (req, res, next) => {
    try {
      const id = (req as AuthedRequest).identity!;
      await getStore().removeFriend(id.playerId, String(req.params.id));
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  /** Lets the client validate a code / invite link before attempting to join. */
  app.get('/api/rooms/:code', api, async (req, res, next) => {
    try {
      const code = normalizeRoomCode(String(req.params.code));
      if (!isValidRoomCode(code)) {
        res.status(400).json({ exists: false, error: 'Invalid code' });
        return;
      }
      const [room] = await matchMaker.query({ roomId: code });
      if (!room) {
        res.json({ exists: false });
        return;
      }
      const meta = (room.metadata ?? {}) as { phase?: string; mapId?: string; host?: string };
      res.json({
        exists: true,
        code,
        clients: room.clients,
        maxClients: room.maxClients,
        phase: meta.phase ?? 'lobby',
        mapId: meta.mapId,
        host: meta.host,
        joinable: !room.locked && room.clients < room.maxClients,
      });
    } catch (e) {
      next(e);
    }
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    log.error('http error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Server error' });
  });
}
