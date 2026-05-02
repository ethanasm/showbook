# Showbook Web (`apps/web`)

Next.js 15 App Router app — the primary Showbook backend and web client.
Read the [repo-root `CLAUDE.md`](../../CLAUDE.md) first for project-wide
conventions; this file covers what's specific to the web app.

## Layout

- `app/` — App Router routes. `(app)` is the authed shell, `(auth)` is
  sign-in / sign-out, `api/` holds REST endpoints (NextAuth, mobile
  token bridge, media upload helpers, the gated `/api/test/*` routes,
  webhook receivers).
- `components/` — UI primitives + page-level components. `design-system/`
  has the `HeroCard` / `EmptyState` / `RemoteImage` / etc. primitives
  shared across pages.
- `lib/` — client-only helpers (tRPC client, hooks, formatters).
- `tests/` — Playwright e2e specs. Unit tests live next to source
  under `lib/__tests__/` and `components/__tests__/`.

## Running locally

Two paths — both reach the same Postgres on port `5433`:

```bash
pnpm dev          # next dev outside Docker (reads apps/web/.env.local)
pnpm dev:up       # docker compose up (reads .env.dev, source bind-mounted)
```

Dev binds host port `3001`. Prod binds `3002`. Playwright's E2E dev
server defaults to `3003` (override with `PLAYWRIGHT_PORT`) so it
doesn't collide with either stack.

`scripts/guard-not-prod-db.mjs` refuses any dev/test workspace command
whose `DATABASE_URL` points at `showbook_prod*` — prod migrations must
go through `pnpm prod:migrate`.

## E2E database isolation

Playwright tests use a separate `showbook_e2e` database in the same
Postgres container so `/api/test/seed` can wipe and rebuild fixtures
without touching local dev data.

`pnpm test:e2e` runs `pnpm db:prepare:e2e` first, then starts a
Playwright-owned Next.js dev server at `https://localhost:3003`
(override with `PLAYWRIGHT_PORT`) with:

```bash
DATABASE_URL=postgresql://showbook:showbook_dev@localhost:5433/showbook_e2e
ENABLE_TEST_ROUTES=1
NEXTAUTH_URL=https://localhost:3003
```

The `/api/test/*` routes are disabled unless `ENABLE_TEST_ROUTES=1` is
set **and** the active database name is `showbook_e2e`.

## Test pyramid

Default to the cheapest test that proves the behaviour. Coverage is
gated at 80% lines / branches / functions (`pnpm verify:coverage`).

- **Unit (`*.test.ts` / `*.test.tsx`)** — pure logic, parsers,
  matchers, formatters, prompt builders, HTTP clients (mock
  `globalThis.fetch`), Zod schemas, LLM wrappers (mock the Groq
  client via `node:test` `mock.module`), tRPC procedures that can
  use the in-memory `_fake-db.ts`, hooks (via
  `@testing-library/react`'s `renderHook` under jsdom), small
  components (via `render` queries). Lives under
  `lib/__tests__/` or `components/__tests__/`.

- **Integration (`*.integration.test.ts`)** — only when DB
  interaction (cascades, FKs, unique constraints) or a cross-router
  workflow is the thing being asserted. Mock external HTTP. Use the
  `_test-helpers.ts` fixtures (`callerFor`, `createTestUser`,
  `cleanupByPrefix`, `fakeUuid`) and wrap any DB-touching
  `before` / `after` hook in `withTimeout(45_000, ...)`. Each file
  must finish in under 45 s. Run with `pnpm test:integration` from
  the repo root.

- **E2E (Playwright `*.spec.ts`)** — only when the assertion is
  about end-user behaviour that crosses Next.js routing, auth, and
  real DOM. Uses the isolated `showbook_e2e` database. Skip with
  `test.skip(!process.env.X)` if the test needs a third-party API
  key that CI doesn't provide.

Prefer adding cases to an existing test file before creating a new
one. If a feature needs both unit and integration coverage, write
the unit test first; reach for the integration only when the unit
can't falsify the behaviour.

## Coverage exclusions (web scope)

Excluded with justification: per-package re-export `index.ts`
barrels, Next.js page/layout/loading shells under `app/`, the
test-only `/api/test/*` routes, and the NextAuth / tRPC mount
routes. The 80% gate runs on everything else under `apps/web/`.

## Email notifications

The daily digest is a Resend-backed email sent at 08:00 ET to users
with email notifications enabled in Preferences. The HTML template
lives in `packages/emails/src/DailyDigest.tsx` and is sent from the
digest job in `packages/jobs/src/notifications.ts`.

From the repo root:

- `pnpm email:smoke` — render with sample fixtures, write HTML to
  disk for visual inspection. Override path with `SMOKE_OUT=...`.
- `pnpm email:preview` — react-email dev server with hot reload at
  http://localhost:3030.
- `pnpm --filter @showbook/jobs run-daily-digest` — run the real
  digest job against your dev DB. Without `RESEND_API_KEY` it logs
  `Would send to ...` for each user instead of delivering.

## Mobile token bridge

The mobile app authenticates via `POST /api/auth/mobile-token`,
which trades a verified Google ID token for a NextAuth-compatible
JWT. The server-side helper lives at `lib/mobile-token.ts`. Set
`GOOGLE_OAUTH_MOBILE_AUDIENCES` in the web env to the
comma-separated list of iOS + Android Google OAuth client IDs that
may mint mobile tokens. The mobile-side companion lives at
[`apps/mobile/CLAUDE.md`](../mobile/CLAUDE.md).

## UI changes

When changing UI, start the dev server (`pnpm dev` or `pnpm dev:up`)
and use the feature in a browser before reporting the task as
complete. Test the golden path and edge cases for the feature, and
watch for regressions on neighbouring pages — typecheck and unit
tests verify code correctness, not feature correctness.
