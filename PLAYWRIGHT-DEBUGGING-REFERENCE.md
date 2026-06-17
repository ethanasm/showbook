# Playwright debugging/testing for a web app — reference

This is a working setup extracted from a Next.js 15 monorepo (pnpm + Docker
Postgres) that runs Playwright e2e + screenshot capture inside the Claude
Code web sandbox. Adapt the specifics (ports, db name, framework) to your
project; the *structure* is the transferable part.

---

## 1. The core idea: an isolated test database + gated test routes

Playwright never runs against your dev database. A **separate database**
(here `showbook_e2e`, in the same Postgres container as dev) lets a
`/api/test/seed` endpoint wipe and rebuild fixtures without touching dev
data. Playwright owns its own Next.js server on a dedicated port so it
never collides with the dev/prod stacks.

Ports used (pick non-overlapping ones for your project):
- dev web: `3001`, prod web: `3002`, **Playwright e2e server: `3003`**
  (override with `PLAYWRIGHT_PORT`)
- Postgres: dev `5433` (e2e db lives in the same container)

### Test-route gating (the safety mechanism)

The `/api/test/*` routes (login, seed, clean, etc.) are **dangerous** —
they wipe and forge data — so they're disabled unless BOTH conditions hold:

1. `ENABLE_TEST_ROUTES=1` is set, AND
2. the active `DATABASE_URL` points at the e2e database (`showbook_e2e`)

The DB-name check is what makes it safe even when `NODE_ENV=production`
(CI runs e2e against `next start`, which forces production mode). A real
prod deploy is never pointed at the e2e db, so the two checks together
prevent accidental exposure. Guard implementation:

```typescript
// app/api/test/_guard.ts — call testRouteGuard() at the top of every /api/test/* route
import { NextResponse } from 'next/server';

const expectedDatabaseName = process.env.TEST_DATABASE_NAME ?? 'showbook_e2e';

function currentDatabaseName() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return null;
  try {
    return new URL(databaseUrl).pathname.replace(/^\//, '') || null;
  } catch {
    return null;
  }
}

export function testRouteGuard() {
  if (process.env.ENABLE_TEST_ROUTES !== '1') {
    return NextResponse.json({ error: 'Test routes are disabled' }, { status: 403 });
  }
  const dbName = currentDatabaseName();
  if (dbName !== expectedDatabaseName) {
    return NextResponse.json(
      { error: `Test routes require ${expectedDatabaseName}` },
      { status: 403 },
    );
  }
  return null; // null = allowed; otherwise return the response
}
```

---

## 2. Playwright config

```typescript
// apps/web/playwright.config.ts
import { defineConfig } from '@playwright/test';

const customChromium = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const port = Number(process.env.PLAYWRIGHT_PORT ?? 3003);

// Local: `next dev --experimental-https` for HMR. CI: built app via
// `next start` (HTTP) — dev-mode on-demand compilation makes first page
// hits take 30+s on CI runners and blows per-test timeouts.
const isCI = process.env.CI === 'true';
const protocol = isCI ? 'http' : 'https';

// Workers > 1 are safe because each worker partitions on its own
// e2e-w<index>@example.com user via /api/test/{login,seed}?worker=N.
// Shared read-only data is seeded once in tests/global.setup.ts.
const workers = Number(process.env.PLAYWRIGHT_WORKERS ?? 4);

const sharedUse = {
  baseURL: `${protocol}://localhost:${port}`,
  ignoreHTTPSErrors: true,
  screenshot: 'only-on-failure' as const,
  trace: 'retain-on-failure' as const,
  ...(customChromium ? { launchOptions: { executablePath: customChromium } } : {}),
};

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  workers,
  retries: isCI ? 2 : 0,        // CI retries absorb cold-start/network flakes; local off so flakes surface
  reporter: isCI
    ? [['./tests/reporters/progress-reporter.ts'], ['html', { open: 'never' }]]
    : 'list',
  use: sharedUse,
  projects: [
    { name: 'setup', testMatch: /global\.setup\.ts$/, use: sharedUse },
    { name: 'desktop-dark', use: { ...sharedUse, viewport: { width: 1440, height: 900 } }, dependencies: ['setup'] },
    { name: 'mobile',       use: { ...sharedUse, viewport: { width: 390, height: 844 } },  dependencies: ['setup'] },
  ],
  webServer: {
    command: isCI ? 'MEDIA_STORAGE_MODE=local pnpm start:e2e'
                  : 'MEDIA_STORAGE_MODE=local pnpm dev:e2e',
    port,
    reuseExistingServer: false,
    timeout: 120_000,           // next start needs ~5–10s to boot in CI
  },
});
```

Two viewport projects (1440×900 desktop, 390×844 mobile) both depend on a
`setup` project that seeds shared data once.

---

## 3. The package.json scripts that wire it together

The e2e server gets its env inline so it always points at the e2e db with
test routes enabled:

```jsonc
// apps/web/package.json
{
  "dev:e2e":  "DATABASE_URL=\"${E2E_DATABASE_URL:-postgresql://USER:PASS@localhost:5433/myapp_e2e}\" ENABLE_TEST_ROUTES=1 NEXTAUTH_URL=https://localhost:${PLAYWRIGHT_PORT:-3003} AUTH_SECRET=myapp-e2e-secret next dev --port ${PLAYWRIGHT_PORT:-3003} --experimental-https",
  "start:e2e": "DATABASE_URL=\"...myapp_e2e\" ENABLE_TEST_ROUTES=1 NEXTAUTH_URL=http://localhost:${PLAYWRIGHT_PORT:-3003} AUTH_SECRET=myapp-e2e-secret next start --port ${PLAYWRIGHT_PORT:-3003}",
  "test:e2e": "playwright test"
}
```

```jsonc
// root package.json — db lifecycle for the e2e database
{
  "dev:db:reset:e2e":   "docker compose -f infra/docker-compose.yml exec -T db sh -c \"psql -U USER -d myapp -c 'DROP DATABASE IF EXISTS myapp_e2e WITH (FORCE);' && psql -U USER -d myapp -c 'CREATE DATABASE myapp_e2e;'\"",
  "dev:db:migrate:e2e": "DATABASE_URL=\"...myapp_e2e\" drizzle-kit migrate",
  "dev:db:prepare:e2e": "pnpm dev:db:reset:e2e && pnpm dev:db:migrate:e2e",
  "test:e2e":           "pnpm dev:db:prepare:e2e && nx run web:test:e2e"
}
```

So `pnpm test:e2e` = reset+migrate the e2e db, then Playwright boots its
own server (port 3003) against it. A `guard-not-prod-db.mjs` script refuses
any dev/test command whose `DATABASE_URL` points at a `*_prod*` database.

---

## 4. Test helpers (auth + seed via the gated routes)

Workers partition by user so parallel runs don't trample each other.

```typescript
// tests/helpers/auth.ts
import { test, type Page } from '@playwright/test';

export function workerIndex(): number {
  return test.info().parallelIndex;
}

export async function loginAsWorker(page: Page, opts: { email?: string } = {}) {
  const idx = workerIndex();
  const url = opts.email
    ? `/api/test/login?email=${encodeURIComponent(opts.email)}`
    : `/api/test/login?worker=${idx}`;
  await page.goto(url);
  await page.waitForURL('**/home');
}

export async function seedForWorker(page: Page) {
  const idx = workerIndex();
  const res = await page.request.get(`/api/test/seed?worker=${idx}`);
  if (!res.ok()) throw new Error(`seed failed (${res.status()}): ${await res.text()}`);
}

export async function loginAndSeedAsWorker(page: Page) {
  await seedForWorker(page);
  await loginAsWorker(page);
}
```

Typical spec shape:

```typescript
import { test, expect } from '@playwright/test';
import { loginAndSeedAsWorker } from './helpers/auth';

test.describe('Shows page', () => {
  test.beforeEach(async ({ page }) => { await loginAndSeedAsWorker(page); });

  test('renders shows with correct state styling', async ({ page }) => {
    await page.goto('/logbook');
    await page.waitForSelector('[data-testid="show-row"]');
    await expect(page.locator('[data-state="past"]')).toBeVisible();
    await page.screenshot({ path: 'test-results/screenshots/shows-list.png', fullPage: true });
  });
});
```

Auth options for the `/api/test/login` route: set a session cookie
directly, use your auth library's test helpers, or create a test-only
endpoint that mints a session. Keep it behind `testRouteGuard()`.

---

## 5. Session-start hook (Claude Code on the web)

This is the part that makes Playwright actually runnable in the sandbox. It
runs on session start and: boots dockerd, installs deps, brings up Postgres,
runs migrations, installs Playwright Chromium (with a CDN fallback), and
stubs `.env.local` so the dev server can boot. Key robustness tricks worth
keeping:

**Only run in the remote sandbox:**
```bash
[ "${CLAUDE_CODE_REMOTE:-}" != "true" ] && exit 0
```

**Start dockerd if down; wait for it:**
```bash
if ! docker info >/dev/null 2>&1; then
  nohup dockerd >/var/log/dockerd.log 2>&1 &
  for i in {1..30}; do docker info >/dev/null 2>&1 && break; sleep 1; done
fi
```

**Frozen lockfile install** (a plain `pnpm install` rewrites the lockfile's
peer-dependency serialization on every boot, leaving an uncommitted diff):
```bash
pnpm install --frozen-lockfile --prefer-offline
```

**Docker Hub rate-limit fallback** — fresh sandboxes often can't pull the
Postgres image ("unauthenticated pull rate limit"). Fall through to no-auth
pull-through mirrors and retag under the canonical name the compose file
expects:
```bash
DB_IMAGE=$(grep -m1 -E '^\s*image:' "$COMPOSE_FILE" | awk '{print $2}')
if ! docker image inspect "$DB_IMAGE" >/dev/null 2>&1; then
  if ! docker pull "$DB_IMAGE" >/dev/null 2>&1; then
    for mirror in "mirror.gcr.io/library/$DB_IMAGE" "public.ecr.aws/docker/library/$DB_IMAGE"; do
      docker pull "$mirror" >/dev/null 2>&1 && { docker tag "$mirror" "$DB_IMAGE"; break; }
    done
  fi
fi
docker compose up -d db
# then poll docker inspect -f '{{.State.Health.Status}}' <container> until "healthy"
```

**Playwright Chromium install with CDN fallback** — `cdn.playwright.dev`
may be network-blocked. Try the standard installer first; on failure, ask
Playwright's own binary (`playwright install chromium --dry-run`) for the
exact install dir + version, then pull the matching Chrome-for-Testing zip
directly from Google's public bucket
(`https://storage.googleapis.com/chrome-for-testing-public/...`). Resolve
the browser revision **per workspace** if you have more than one
playwright-core in the tree — don't `find … | head -1` and guess.

```bash
PW_BROWSERS_DIR="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
mkdir -p "$PW_BROWSERS_DIR"
pnpm --filter web exec playwright install chromium \
  || { # CDN blocked → parse --dry-run plan, curl the CFT zip, unzip into the install dir, touch INSTALLATION_COMPLETE
       pnpm --filter web exec playwright install chromium --dry-run; }
```

**Stub `.env.local`** so Next.js can boot under Playwright — modules read
env eagerly at import time, placeholder values are fine for tests that don't
hit third-party services:
```bash
if [ ! -f apps/web/.env.local ]; then
  cat > apps/web/.env.local <<'ENVEOF'
DATABASE_URL=postgresql://USER:PASS@localhost:5433/myapp
NEXTAUTH_URL=https://localhost:3001
NEXTAUTH_SECRET=test-secret-not-for-production
GOOGLE_CLIENT_ID=stub-google-client-id
# ... stub every var read at import time ...
ENVEOF
fi
```

**Persist env for the agent shell** (so your interactive commands see the db url):
```bash
[ -n "${CLAUDE_ENV_FILE:-}" ] && echo 'export DATABASE_URL="...myapp"' >> "$CLAUDE_ENV_FILE"
```

The hook lives at `.claude/hooks/session-start.sh`. There's a Claude Code
skill named **`session-start-hook`** specifically for authoring these — ask
Claude to invoke it when setting one up in the new project.

### Mid-session recovery (put this in CLAUDE.md)

If `docker info` errors with "Cannot connect to the Docker daemon,"
**dockerd crashed — Docker is still installed.** Restart, don't conclude
the sandbox lacks Docker:
```bash
sudo rm -f /var/run/docker.pid
sudo nohup dockerd > /var/log/dockerd2.log 2>&1 &
sleep 5 && sudo docker info >/dev/null && echo ok
sudo docker compose -f infra/docker-compose.yml up -d db
until pg_isready -h localhost -p 5433 -U USER >/dev/null 2>&1; do sleep 1; done
pnpm dev:db:prepare:e2e   # if you need the e2e DB
```
Same for the image rate-limit: pull from `mirror.gcr.io` /
`public.ecr.aws` and retag, as above.

---

## 6. Screenshot / visual-review workflow (PR screenshots)

The transferable pattern for getting visual diffs into a PR a reviewer can
actually see:

- Run Playwright locally in the sandbox (Chromium + dev server are present)
  to produce PNGs of affected routes only — map touched files → routes,
  don't screenshot the whole app.
- **Before/after, not just after.** Capture HEAD ("after"), then
  `git checkout HEAD^ -- <changed files>` (NOT `git stash` — stash silently
  no-ops on a clean tree and you get two AFTERs), re-run, restore.
- **Pixel-diff sanity gate before posting.** A 4px CSS change on a 390px
  full-page mobile shot is ~1% of width and invisible once GitHub scales
  the PNG down — worse inside a multi-column markdown table. Compute the
  diff % and re-shoot with an **element-level crop**
  (`locator.screenshot()` or `page.screenshot({ clip })`) when it's < ~5%.
  Bump `deviceScaleFactor: 2` for sharpness.

| pct diff | meaning | action |
|---|---|---|
| `0%` | identical | capture failed (before/after revert didn't move the tree) — re-shoot |
| `< 2%` | invisible at thumbnail scale | element-level crop or full-width display, no table |
| `2–5%` | borderline | element crop; full-width stacked at minimum |
| `> 5%` | clearly visible | full-page ok if displayed at usable size |

- Embed before/after as consecutive **full-width** images, not table cells.
- Host PNGs on an **orphan branch** (`pr-screenshots`) and reference via
  `https://github.com/<owner>/<repo>/raw/pr-screenshots/...` — never commit
  screenshots to `main` or the PR branch.

---

## 7. Checklist to port this to a new project

1. Pick a dedicated Playwright port + an isolated test database name.
2. Add a `testRouteGuard()` and put all `/api/test/*` routes behind it
   (require both `ENABLE_TEST_ROUTES=1` and the e2e db name).
3. Add `dev:e2e` / `start:e2e` scripts that set the e2e DATABASE_URL +
   `ENABLE_TEST_ROUTES=1` inline.
4. Add db lifecycle scripts: reset (drop/create), migrate, `prepare:e2e`.
5. Write `playwright.config.ts` with `webServer` pointing at `dev:e2e`
   (local/https) vs `start:e2e` (CI/http), viewport projects, and a `setup`
   project for shared seed.
6. Add `tests/helpers/auth.ts` (worker-partitioned login/seed) and a
   `global.setup.ts` for once-only shared data.
7. Write `.claude/hooks/session-start.sh` (the `session-start-hook` skill
   helps) to boot docker + db + migrate + install Chromium with fallbacks +
   stub `.env.local`.
8. Document the mid-session docker/db recovery steps in CLAUDE.md so future
   sessions don't wrongly conclude "no Docker/Postgres in the sandbox."
