FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
COPY packages/db/package.json packages/db/
COPY packages/api/package.json packages/api/
COPY packages/jobs/package.json packages/jobs/
COPY packages/emails/package.json packages/emails/
COPY packages/scrapers/package.json packages/scrapers/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 3001
CMD ["node", "apps/web/server.mjs"]
