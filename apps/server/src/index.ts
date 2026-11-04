import express from 'express';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { config } from './config.ts';
import { registerRoutes } from './http/routes.ts';
import { ShadowHuntRoom } from './rooms/ShadowHuntRoom.ts';
import { getStore } from './services/store.ts';
import { log } from './utils/log.ts';

export function createGameServer() {
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

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('dist/index.js');
if (isMain) {
  getStore();
  const server = createGameServer();
  await server.listen(config.port);
  log.info(`Shadow Hunt server listening on :${config.port}`, { cors: config.corsOrigins.join(',') || '(none)' });
}
