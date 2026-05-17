FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate
ENV PNPM_HOME="/pnpm"
WORKDIR /app

# ---------- deps: install pnpm workspace deps once, reused by dev + prod ----------
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/api/package.json packages/api/
COPY packages/jobs/package.json packages/jobs/
COPY packages/emails/package.json packages/emails/
COPY packages/scrapers/package.json packages/scrapers/
COPY packages/shared/package.json packages/shared/
COPY packages/observability/package.json packages/observability/
# Cache mount keeps the pnpm content-addressable store across builds so a
# re-deploy reuses ~1300 packages instead of redownloading them. The
# --filter web... scope drops the mobile-only deps (Expo / RN / Metro /
# Maestro) that the web container never executes — they're the long tail
# that turns a 2 min install into a 15 min one when registry edges flake.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter web...

# ---------- dev: source bind-mounted at runtime; server.mjs runs `next dev` ----------
FROM deps AS dev
COPY . .
EXPOSE 3001
CMD ["node", "apps/web/server.mjs"]

# ---------- prod: source baked in, `next build` artifacts included ----------
FROM deps AS prod
COPY . .
RUN pnpm --filter web build
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "apps/web/server.mjs"]
