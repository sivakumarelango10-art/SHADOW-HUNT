# Shadow Hunt game server (Colyseus + REST API). Build from the repository root:
#   docker build -t shadow-hunt-server .
# Used by the `game` service in vercel.json, and by Railway / Render / Fly.io.
FROM node:22-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@10.28.0
# Manifests first so the dependency layer is cached between code changes.
# Every workspace manifest is copied so --frozen-lockfile sees the same workspace as the lockfile.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @shadow-hunt/server...
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN pnpm --filter @shadow-hunt/server build \
 && pnpm --filter @shadow-hunt/server deploy --prod --legacy /out

FROM node:22-alpine
ENV NODE_ENV=production
# Vercel's container runtime routes traffic to port 80 unless PORT is set in the project
# settings. Railway, Render and Fly inject PORT themselves, so this default only matters on
# Vercel. (Binding port 80 is why the server runs as the image's default user.)
ENV PORT=80
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /app/apps/server/dist ./dist
# Dev file store location when Supabase is not configured (ephemeral on Vercel).
RUN mkdir -p /app/data
EXPOSE 80
CMD ["node", "dist/index.js"]
