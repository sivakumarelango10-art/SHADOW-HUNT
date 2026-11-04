# Shadow Hunt multiplayer server (Colyseus). Build from the repository root:
#   docker build -t shadow-hunt-server .
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --filter @shadow-hunt/server...
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN pnpm --filter @shadow-hunt/server build \
 && pnpm --filter @shadow-hunt/server deploy --prod --legacy /out

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /app/apps/server/dist ./dist
USER node
EXPOSE 2567
CMD ["node", "dist/index.js"]
