import type { IncomingMessage } from 'node:http';
import express from 'express';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { API_PREFIX } from '@shadow-hunt/shared';
import { config } from './config.ts';
import { registerRoutes } from './http/routes.ts';
import { ShadowHuntRoom } from './rooms/ShadowHuntRoom.ts';
import { getStore } from './services/store.ts';
import { log } from './utils/log.ts';

/**
 * Colyseus answers every request (and every CORS preflight) itself and, by default, echoes
 * back any Origin. Apply the same allow-list as the REST API instead. Same-origin deployments
 * (CORS_ORIGIN unset in production) are unaffected because browsers skip CORS for them.
 */
function applyCorsPolicy() {
  const allowAll = config.corsOrigins.includes('*');
  matchMaker.controller.getCorsHeaders = (headers: Headers) => {
    const origin = headers.get('origin');
    const allowed = !!origin && (allowAll || config.corsOrigins.includes(origin));
    return {
      'Access-Control-Allow-Origin': allowed ? origin! : (config.corsOrigins.find((o) => o !== '*') ?? 'null'),
      Vary: 'Origin',
    };
  };
}

export function createGameServer() {
  applyCorsPolicy();
  const server = new Server({
    transport: new WebSocketTransport({ pingInterval: 4000, pingMaxRetries: 3 }),
    greet: false,
    express: (app) => {
      app.set('trust proxy', true);
      registerRoutes(app, express.json({ limit: '16kb' }));
    },
  });
  // `mode` lets Quick Match only ever join public rooms; private rooms are hidden from matchmaking entirely.
  server.define('shadow_hunt', ShadowHuntRoom).filterBy(['mode']);
  return server;
}

/**
 * Everything the game server serves lives under `/api` so a single public route
 * (`/api/(.*)` on Vercel, or any reverse proxy) reaches it:
 *   - REST:         /api/health, /api/profile, …
 *   - matchmaking:  /api/matchmake/:method/:room  (Colyseus serves /matchmake/… natively)
 *   - WebSockets:   /api/:processId/:roomId       (the WS transport only reads the last two segments)
 * The client SDK is pointed at `<origin>/api`, so only matchmaking needs translating here.
 */
const MATCHMAKE_PREFIX = `${API_PREFIX}/matchmake/`;
function stripApiPrefixForMatchmaking(req: IncomingMessage) {
  if (req.url?.startsWith(MATCHMAKE_PREFIX)) req.url = req.url.slice(API_PREFIX.length);
}

/** Start listening and install the `/api` prefix translation. Must run after `listen()`. */
export async function startGameServer(port: number | string) {
  const server = createGameServer();
  await server.listen(port);
  const http = server.transport.server;
  if (!http) throw new Error('WebSocketTransport has no HTTP server');
  // Colyseus prepends its own request listeners during listen(); ours must run before them.
  http.prependListener('request', stripApiPrefixForMatchmaking);
  return server;
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('dist/index.js');
if (isMain) {
  getStore();
  await startGameServer(config.port);
  log.info(`Shadow Hunt server listening on :${config.port}`, { cors: config.corsOrigins.join(',') || '(same-origin only)' });
}
