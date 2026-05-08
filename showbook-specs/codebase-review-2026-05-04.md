# Codebase review — 2026-05-04

**Branch:** `claude/codebase-review-9oJKM`
**Commit:** `a0fb2b5191fccd7bba428cbaf1244360668723ed` ("fix(mobile): align Expo SDK 55 deps + EAS config to fix iOS build (#77)")
**Reviewer:** Claude (Opus 4.7)
**Scope:** Whole monorepo, risk-tiered, written-doc-only.

## Executive summary

Showbook is a small but mature monorepo with strong baseline hygiene: every tRPC router uses `protectedProcedure` or `adminProcedure` (zero public procedures in routers), no hardcoded secrets in source, no `TODO`/`FIXME` debt markers, Drizzle is used consistently with parameterised queries, and the pg-boss `runJob` wrapper is uniformly applied across all 11 handlers. Auth-surface code is conspicuously well-engineered — the mobile token bridge documents its concurrency model in prose, `/api/admin/sql` has six-layer defense-in-depth, and `validateAdminQuery` explicitly disclaims its non-security role. CLAUDE.md guidance is broadly followed.

The headline risks are not in the security surface but in **two latent bugs in the daily/weekly background pipeline** that will cause silent user-visible damage in steady-state production, plus one **observability hole in app-startup error reporting**:

- **[P1-01](#p1-01-discover-ingest-phase-4-deletes-ongoing-multi-night-runs)** — Discover ingest's Phase 4 prune deletes multi-night runs once their *first* night is 7 days past, regardless of whether `runEndDate` is still in the future. Theatre productions and festivals will vanish from Discover mid-engagement.
- **[P1-02](#p1-02-daily-digest-can-double-send-on-pg-boss-retry)** — `runDailyDigest` does not check `lastDigestSentAt` against today's date before sending, so any pg-boss retry mid-batch (the configured retryLimit is 3) re-emails everyone already processed in the failed run.
- **[P1-03](#p1-03-instrumentationts-uses-consoleerror-and-swallows-pg-boss-startup-failure)** — `apps/web/instrumentation.ts` violates the observability rule by using `console.error`, and the swallowed pg-boss startup failure means a job-system outage produces no Axiom signal at all.

Beyond these three, there is a meaningful secondary tier of P2 findings around input-shape laxity (`z.any()` for `sourceRefs`), redaction list completeness, and unbounded result-set ingestion in `/api/admin/sql`. Maintainability debt is concentrated in four large UI files (>1.5k LOC each) and the 1.1k-LOC `shows.ts` router; coverage on `packages/jobs/src/discover-ingest.ts` and `packages/jobs/src/health-check.ts` is the largest test gap.

CLAUDE.md guidance is mostly accurate; one note ("the pino err serializer currently does NOT include `err.cause`") is **stale** — the serializer at `packages/observability/src/logger.ts:25-28` walks the cause chain recursively. Worth fixing the doc so the next reviewer doesn't re-derive it.

**Overall health:** Solid. P1 items are tractable (one is a one-line comparison change, one is a two-line guard, one is removing a console.error). No P0 items.

---

## Methodology & scope

**What was deep-read end-to-end** (line-by-line):

- `apps/web/app/api/auth/mobile-token/route.ts` (208 LOC)
- `apps/web/lib/mobile-token.ts` (283 LOC)
- `apps/web/app/api/admin/sql/route.ts` (249 LOC)
- `apps/web/lib/admin-query.ts` (117 LOC)
- `packages/api/src/routers/shows.ts` (1,107 LOC)
- `packages/jobs/src/discover-ingest.ts` (783 LOC)
- `packages/jobs/src/notifications.ts` (453 LOC)
- `packages/jobs/src/health-check.ts` (274 LOC)
- `packages/jobs/src/registry.ts` (350 LOC)
- `packages/observability/src/logger.ts` (134 LOC)
- `apps/mobile/lib/network.ts` (522 LOC)
- `packages/db/schema/announcements.ts` (76 LOC)
- `apps/web/instrumentation.ts` (12 LOC)

**What was scanned but not deep-read:** the four 1k+ LOC UI files (`add/page.tsx`, `ShowsListView.tsx`, `discover/View.client.tsx`, `shows/[id]/page.tsx`), the remaining tRPC routers, the remaining 8 pg-boss handlers, schema-ts files for tables other than announcements.

**What was not reviewed:** `design/` (per CLAUDE.md — reference-only); generated Drizzle migrations under `packages/db/drizzle/*.sql`; Playwright-bound scrapers in `packages/scrapers/{run,runtime,extract,cli}.ts`; the test-only `/api/test/*` routes; the lockfile.

**Verification commands run** (all read-only):

```bash
git rev-parse HEAD                                                     # → a0fb2b5
git status --short                                                     # → clean
rg -n "console\.(log|warn|error|debug)" apps packages --glob '!**/*.test.*'
rg -n "publicProcedure|adminProcedure|protectedProcedure" packages/api/src/routers --count-matches
rg -nP "(api[_-]?key|secret|password|token)\s*[:=]\s*['\"]" apps packages
grep -rohE 'process\.env\.[A-Z_]+' apps packages --include='*.ts' --include='*.tsx' --include='*.mjs' | sort -u
find . -name "*.integration.test.ts" -not -path "*/node_modules/*"
find apps packages \( -name "*.ts" -o -name "*.tsx" \) -not -path "*/node_modules/*" | xargs wc -l | sort -rn | head -25
rg -n "TODO|FIXME|XXX|HACK" apps packages --glob '!**/*.test.*'
rg -n "@ts-ignore|@ts-expect-error|as any|as unknown as" apps packages --glob '!**/*.test.*'
```

`pnpm verify` was not run (timebox), so the doc treats whatever's currently green as the baseline. If a finding here surfaces a test failure, treat that as a separate issue.

---

## Findings by severity

### P1 — Fix this iteration

#### P1-01 — Discover ingest Phase 4 deletes ongoing multi-night runs

- **Tier:** P1
- **Focus:** Correctness
- **Location:** `packages/jobs/src/discover-ingest.ts:762-770`; schema at `packages/db/schema/announcements.ts:43-46`; insert site at `packages/jobs/src/discover-ingest.ts:319-339` (`upsertRun`)
- **Evidence:**

  ```ts
  // discover-ingest.ts:762-770
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const cutoffDate = sevenDaysAgo.toISOString().split('T')[0];
  const deleted = await db
    .delete(announcements)
    .where(lt(announcements.showDate, cutoffDate))
    .returning({ id: announcements.id });

  // upsertRun fresh-row insert at line 319-339
  await db.insert(announcements).values({
    ...
    showDate: run.runStartDate,    // ← run rows pin showDate to the FIRST night
    runStartDate: run.runStartDate,
    runEndDate: run.runEndDate,
    performanceDates: run.performanceDates,
    ...
  });
  ```

  For run rows, `showDate` is `runStartDate`. The Phase 4 prune predicate is `showDate < cutoff` — `runEndDate` is never consulted.

- **Why it matters:** A multi-night run starting Apr 15 with performances through Aug 30 has `showDate = 2026-04-15` for its lifetime. The next weekly Phase 4 prune (Mondays per `registry.ts:338`, `'0 6 * * 1'`) after Apr 22 deletes the row, even though performances are happening that week and for months after. Theatre productions, comedy residencies (multi-night Madison Square Garden runs), and festivals are exactly the cases this hits — the high-signal Discover content. The cleanup happens silently and isn't recoverable without a re-ingest.
- **Suggested fix:** Change the predicate to `lt(announcements.runEndDate ?? announcements.showDate, cutoffDate)` semantically — in Drizzle this is `or(and(isNull(announcements.runEndDate), lt(showDate, cutoff)), and(isNotNull(runEndDate), lt(runEndDate, cutoff)))`, or simpler: emit the predicate as `sql\`coalesce(${announcements.runEndDate}, ${announcements.showDate}) < ${cutoffDate}\``. Add an integration test under `packages/jobs/src/__tests__/` that seeds a run with `runStartDate = 30 days ago, runEndDate = 30 days hence` and asserts the prune leaves it intact.
- **Effort:** S (one-line predicate change + one new integration test)
- **Confidence:** High

---

#### P1-02 — Daily digest can double-send on pg-boss retry

- **Tier:** P1
- **Focus:** Correctness (idempotency)
- **Location:** `packages/jobs/src/notifications.ts:236-250` (eligibleUsers query) and `:419-430` (send-then-update); pg-boss retry config at `packages/jobs/src/boss.ts` (`retryLimit: 3, retryDelay: 60`)
- **Evidence:**

  ```ts
  // notifications.ts:236-250 — eligibleUsers selects everyone with emailNotifications=true.
  // No filter on lastDigestSentAt.
  const eligibleUsers = await db
    .select({ userId, email, displayName, lastDigestSentAt: ...lastDigestSentAt })
    .from(userPreferences)
    .innerJoin(users, eq(userPreferences.userId, users.id))
    .where(and(eq(userPreferences.emailNotifications, true), isNotNull(users.email)));

  // ...later, per user, after computing today/upcoming/announcements...
  // notifications.ts:419-430
  await resend.emails.send({ from, to: user.email, subject, html, headers: { 'X-Entity-Ref-ID': idempotencyKey } });
  await db.update(userPreferences).set({ lastDigestSentAt: new Date() })
    .where(eq(userPreferences.userId, user.userId));
  ```

  The `idempotencyKey` (`sha256(userId:todayStr).slice(0, 32)`) is sent as the `X-Entity-Ref-ID` header. **Resend does not deduplicate based on this header by default** — it's a custom header.

- **Why it matters:** If `runDailyDigest` processes 200 users, sends to 100, and then fails on user 101 (e.g. a transient DB connection loss), pg-boss retries the whole job up to 3 times after 60s/120s/240s. The retry re-fetches eligibleUsers (no `lastDigestSentAt` filter), so the 100 already-emailed users get a second copy, then a third on the next retry. Resend's per-message idempotency (if turned on with `idempotencyKey` in the SDK call) would help, but the current code only sets a custom header.
- **Suggested fix:** Two layers, either is sufficient on its own; do both for belt-and-suspenders:
  1. **Pre-send guard:** at the top of the per-user loop, skip the user if `user.lastDigestSentAt` is later than today's ET start: `if (user.lastDigestSentAt && user.lastDigestSentAt >= startOfTodayET) { skipped++; continue; }`. Cheap, prevents the bulk of the duplication.
  2. **Resend SDK idempotency:** Resend's SDK supports `idempotencyKey` as a top-level option (not a header) — pass `idempotencyKey` rather than (or in addition to) the custom header. Their server-side dedup window is 24h, which matches our daily cadence.

  Add an integration test that runs `runDailyDigest` twice in succession with the same fixtures and asserts the second run sends 0.
- **Effort:** S (add the pre-send guard + a regression integration test)
- **Confidence:** High

---

#### P1-03 — `instrumentation.ts` uses `console.error` and silently swallows pg-boss startup failure

- **Tier:** P1
- **Focus:** Observability
- **Location:** `apps/web/instrumentation.ts:1-12`
- **Evidence:**

  ```ts
  export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
      const { startBoss, registerAllJobs } = await import('@showbook/jobs');
      try {
        const boss = await startBoss();
        await registerAllJobs(boss);
      } catch (error) {
        console.error('Failed to start pg-boss:', error);
      }
    }
  }
  ```

- **Why it matters:** Two problems compounded:
  1. CLAUDE.md is unambiguous that `console.*` is forbidden in app code: *"All new code MUST use the shared `@showbook/observability` package — no `console.log/warn/error` and no direct `langfuse` / `pino` imports. This is enforced by review and applies to every package."* This is the *first* code path that runs on web-process startup; getting it wrong sets a bad pattern.
  2. The `catch` swallows the error. A pg-boss startup failure means **none of the daily crons fire** — no shows-nightly transition, no setlist retry, no daily digest, no health check. Because the error goes only to `console.error` (not Axiom) and is swallowed, the operator gets **no Axiom alert and no health-check failure** — the health-check job itself can't run if pg-boss didn't start. This is a silent total outage of the background pipeline.
- **Suggested fix:**

  ```ts
  import { logger, flushObservability } from '@showbook/observability';

  export async function register() {
    if (process.env.NEXT_RUNTIME !== 'nodejs') return;
    const { startBoss, registerAllJobs } = await import('@showbook/jobs');
    try {
      const boss = await startBoss();
      await registerAllJobs(boss);
      logger.info({ event: 'pgboss.boot.ok' }, 'pg-boss started and jobs registered');
    } catch (err) {
      logger.error({ event: 'pgboss.boot.failed', err }, 'Failed to start pg-boss');
      await flushObservability(); // ensure the line gets to Axiom before we move on
      // Don't re-throw: re-throwing would crash the web process, which is worse
      // than running a degraded web with no jobs. The Axiom signal + the
      // missing health-check.start event are the alerting path.
    }
  }
  ```

  Add the `pgboss.boot.failed` event to the curated list in CLAUDE.md, and consider an Axiom monitor that alerts on its absence (or pairs with `pgboss.started`).
- **Effort:** XS
- **Confidence:** High

---

### P2 — Schedule

#### P2-01 — `shows.ts` router accepts `z.any()` for `sourceRefs`

- **Tier:** P2
- **Focus:** Security / Maintainability
- **Location:** `packages/api/src/routers/shows.ts:458` (create) and `:756` (update)
- **Evidence:**

  ```ts
  sourceRefs: z.any().optional(),     // line 458
  ...
  sourceRefs: z.any().optional(),     // line 756
  ```

  No shape validation; arbitrary JSON gets persisted into a JSONB column and read back later by the same user.

- **Why it matters:** This is per-user data in a JSONB column, so the blast radius is bounded — a user can't hurt anyone but themselves, and only with crafted client requests. But:
  - It's the only `z.any()` in the entire router surface (verified via `rg "z\.any\(\)" packages/api/src/routers`). It stands out.
  - The data is read back by the UI and (per `apps/web/CLAUDE.md`) renderers should not assume specific shapes from the DB. If a UI ever does `JSON.parse` against a deeply-nested object pulled from `sourceRefs`, a malformed payload could throw at render time.
  - Storage growth is uncapped — a client can write a 10 MB JSON blob into a single row.
- **Suggested fix:** Define a `sourceRefSchema` (e.g. `z.array(z.object({ source: z.enum([...]), id: z.string(), url: z.string().url().optional() }))`) and use it in both `create` and `update`. Add a max-size guard (e.g. `.refine((v) => JSON.stringify(v).length < 10_000)`) so the JSONB payload can't grow without bound. The schema definition lives near the other input schemas at the top of the file.
- **Effort:** S
- **Confidence:** High

---

#### P2-02 — Logger redaction list misses common token field names

- **Tier:** P2
- **Focus:** Security
- **Location:** `packages/observability/src/logger.ts:37-49`
- **Evidence:**

  ```ts
  redact: {
    paths: [
      '*.apiKey',
      '*.api_key',
      '*.authorization',
      '*.password',
      '*.token',
      '*.secret',
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    censor: '[REDACTED]',
  },
  ```

- **Why it matters:** `*.token` covers fields literally named `token`, but the codebase deals with several specific token-like fields that wouldn't match: `idToken` (mobile auth — verified ID tokens that arrive in request bodies), `accessToken`, `refreshToken`, `bearer`, `jwt`, `privateKey`. The mobile-token route logs `{ event: 'auth.mobile_token_invalid', err }` (`apps/web/app/api/auth/mobile-token/route.ts:138-143`); if the upstream `verifyIdToken` ever throws an error whose serialized form includes the original `idToken` (Google's auth library doesn't today, but third-party libraries can), the unredacted token lands in Axiom.

  Pino's redact paths only match the literal property names listed; they aren't regex.
- **Suggested fix:** Extend the `paths` array:
  ```ts
  paths: [
    '*.apiKey', '*.api_key', '*.authorization',
    '*.password', '*.token', '*.idToken', '*.accessToken',
    '*.refreshToken', '*.bearer', '*.jwt', '*.privateKey',
    '*.secret', '*.client_secret',
    'req.headers.authorization', 'req.headers.cookie',
    // Catch our own custom Bearer header path on inbound mobile tRPC
    'req.headers["x-showbook-bearer"]',  // if/when one is added
  ],
  ```
  Consider a unit test in `packages/observability/src/__tests__/logger.test.ts` that logs an object with each forbidden field name and asserts the rendered line contains `[REDACTED]`.
- **Effort:** XS
- **Confidence:** High

---

#### P2-03 — `/api/admin/sql` truncates rows post-fetch instead of capping in-query

- **Tier:** P2
- **Focus:** Performance / Hardening
- **Location:** `apps/web/app/api/admin/sql/route.ts:170-224`
- **Evidence:**

  ```ts
  // route.ts:174-179
  rows = (await sql.begin('READ ONLY', async (tx) => {
    await tx.unsafe(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    const result = await tx.unsafe(validation.query);
    return result as unknown as unknown[];
  }));
  // ...
  // route.ts:222-224
  const truncated = rows.length > MAX_ROWS;
  const out = truncated ? rows.slice(0, MAX_ROWS) : rows;
  ```

- **Why it matters:** The endpoint already has solid defense-in-depth (Bearer + READ ONLY tx + 5s statement_timeout + 2-conn pool + per-IP rate limit), so this is a hardening item, not an exploit. But: `SELECT * FROM shows` against a populated prod DB returns *every row into Node memory* before the slice. Postgres-js batches network reads, so the rows accumulate as JS objects in the web process, bounded by 5s of throughput rather than by `MAX_ROWS`. On a fast SSD with a wide row that's tens of thousands of objects in 5s — enough to spike GC and slow down concurrent legitimate web traffic.
- **Suggested fix:** Two options, either is fine:
  1. **Inject a hard `LIMIT` into the query** before submitting it. `validateAdminQuery` already parses leading verbs; teach it to append `LIMIT ${MAX_ROWS + 1}` to bare-`SELECT` queries that don't already have a LIMIT clause. (The `+1` lets you preserve the `truncated` signal.) This is parser-fragile but cheap.
  2. **Stream rows.** `postgres-js` exposes a cursor mode (`tx.cursor`) — pull rows in chunks of 100, push each chunk, stop when you've accumulated MAX_ROWS. This is the textbook fix and obviously correct, but more code.

  Option 2 is the right answer if this endpoint ever gets serious traffic; option 1 is fine for the current operator-only use case.
- **Effort:** S (option 1) / M (option 2)
- **Confidence:** High

---

#### P2-04 — `runDiscoverIngest` serialises external API calls across followed venues / regions / performers

- **Tier:** P2
- **Focus:** Performance
- **Location:** `packages/jobs/src/discover-ingest.ts:637-651, 663-688, 715-748`
- **Evidence:** Each phase iterates `for (const … of …)` with `await fetchAllEvents` inside, which itself paginates serially up to 5 pages. Per-page latency is rate-limited by the TM client (200 ms minimum interval).
- **Why it matters:** As Showbook gains followers (each user contributing distinct followed venues / performers / regions), the Monday-morning `'0 6 * * 1'` cron's wall-clock time scales linearly. Today: tens of targets × 5 pages × 200 ms = ~10 seconds per phase. At 1000 targets that's ~17 minutes per phase, and three phases run sequentially — close to an hour. pg-boss has no per-job soft cap, so a runaway job can hold a connection from the dedicated pool indefinitely, and any failure mid-run loses partial progress (the `existingSourceIds` Set is in-process state).
- **Suggested fix:** Bound concurrency rather than serial:
  - Fan out the per-target `fetchAllEvents` with a small concurrency pool (3–5) using something like `pLimit` or a hand-rolled semaphore. The TM client's 200 ms global rate limit still serialises the actual HTTP requests, but pagination overlap cuts each target's wall-clock to a single page-time.
  - Consider checkpointing `existingSourceIds` per-phase (or per-N-targets) so a crash mid-run doesn't replay the whole pipeline.
- **Effort:** M
- **Confidence:** Medium (no observed prod symptom yet, but the trajectory is clear)

---

#### P2-05 — `runDailyDigest` fetches every announcement into memory regardless of relevance

- **Tier:** P2
- **Focus:** Performance / Maintainability
- **Location:** `packages/jobs/src/notifications.ts:218-234`
- **Evidence:**

  ```ts
  const allRecentAnnouncements = await db
    .select({ ... })
    .from(announcements)
    .innerJoin(venues, eq(announcements.venueId, venues.id))
    .orderBy(asc(announcements.showDate));
  ```

  No `WHERE` clause. The comment says *"This stays cheap because the daily ingest caps inserts and old rows are pruned"*, which is true today but couples the digest's correctness to the prune job.
- **Why it matters:** Coupling. If P1-01 above is fixed by no-longer-pruning runs whose first night is past, this query grows monotonically with every multi-night run. At 1k–10k announcements the in-memory filter is fine; at 100k it becomes an issue. More importantly: `bucketAnnouncementsForUser` does an O(N×U) match per user, so you pay the cross-product even though most users follow << N venues+performers. The comment also doesn't filter by `discoveredAt` — old announcements that the user never qualified for are re-shown if they ever follow the relevant venue/artist later.
- **Suggested fix:** Filter at the SQL layer. Fetch only announcements with `discoveredAt >= max(every-user's lastDigestSentAt minus FALLBACK_CUTOFF_DAYS)`, computed in one query. Or: per-user, fetch only the announcements matching that user's followed venue/performer IDs (joinable, ~tens of rows). Either way, drop the `allRecentAnnouncements` materialisation.
- **Effort:** S
- **Confidence:** High

---

#### P2-06 — `shows.create` serialises `matchOrCreatePerformer` per support act

- **Tier:** P2
- **Focus:** Performance
- **Location:** `packages/api/src/routers/shows.ts:507-521` (and the symmetric block in `update` at `:815-829`)
- **Evidence:**

  ```ts
  for (const p of input.performers) {
    const result = await matchOrCreatePerformer({...});   // sequential
    resolvedPerformers.push(...);
  }
  ```

- **Why it matters:** For a festival show with 30+ acts, this serializes 30+ matcher calls (each potentially calling Ticketmaster + MusicBrainz + DB writes). The user clicks "Save" and waits the full sum of latencies. Worst case: 30 × ~500ms = 15s on the critical path.
- **Suggested fix:** `Promise.all(input.performers.map(matchOrCreatePerformer))`. The matcher already handles concurrent inserts via the unique-index race recovery (referenced in `matchOrCreatePerformer.race_recovered` event in CLAUDE.md), so parallelism is safe. The downstream code that builds `setlistsMap` and `resolvedPerformers` is order-dependent only in the sense that input order is preserved — `Promise.all` preserves index order. Order-aware: `await Promise.all(input.performers.map(async (p) => ({ p, result: await matchOrCreatePerformer(...) })))`.
- **Effort:** XS
- **Confidence:** High

---

#### P2-07 — Two `apps/web/lib/...` and 11 `packages/jobs/...` files have no isolated tests

- **Tier:** P2
- **Focus:** Tests
- **Location:** Notably `packages/jobs/src/discover-ingest.ts` (783 LOC), `packages/jobs/src/health-check.ts` (274 LOC) — both are operationally critical and only have indirect / mocked-unit coverage.
- **Evidence:** `find . -name "*.integration.test.ts"` returns 15 files. `discover-ingest`-specific: 0. `health-check`-specific: 0 (only `health-check/checks.ts` has unit tests). `discover.ingest.targeted.*` events listed in CLAUDE.md fire via `runDiscoverIngest`, but no test asserts they fire on the right code paths.
- **Why it matters:** P1-01 above is the most expensive type of bug to catch by inspection — invisible during dev, only manifests on a multi-day timescale in prod. A canonical regression test ("seed an in-progress run, run prune, assert it survives") would catch it forever. Same applies to digest idempotency (P1-02).
- **Suggested fix:** Two new integration tests under `packages/jobs/src/__tests__/`:
  - `discover-ingest.integration.test.ts` — covers Phase 4 prune semantics, Phase 1/2/3 dedup-set growth, run upsert vs single-event upsert paths.
  - `health-check.integration.test.ts` — covers the rollup-status logic with each combination of ok/warn/fail/unknown (the unit-tested `_testing.rollupStatus` covers the pure combinator but not the email-skip/email-fail paths).
- **Effort:** M
- **Confidence:** High

---

#### P2-08 — CLAUDE.md note about `err.cause` serializer is stale

- **Tier:** P2
- **Focus:** Documentation
- **Location:** `CLAUDE.md` (the line: *"the pino err serializer currently does NOT include `err.cause`, so a thrown wrapped postgres error (Drizzle / postgres-js) loses the underlying SQLSTATE in Axiom"*) vs. `packages/observability/src/logger.ts:19-29`.
- **Evidence:**

  ```ts
  // logger.ts:19-29 — the serializer DOES walk err.cause recursively.
  export function serializeErr(err: unknown): unknown {
    if (!(err instanceof Error)) return pino.stdSerializers.err(err as never);
    const base = pino.stdSerializers.err(err) as Record<string, unknown>;
    const e = err as Error & { code?: unknown; detail?: unknown; cause?: unknown };
    if (e.code !== undefined) base.code = e.code;
    if (e.detail !== undefined) base.detail = e.detail;
    if (e.cause !== undefined && e.cause !== null) {
      base.cause = serializeErr(e.cause);
    }
    return base;
  }
  ```

- **Why it matters:** Doc rot. A reviewer reading CLAUDE.md will think this is broken and either avoid relying on `err.cause` or duplicate the logic.
- **Suggested fix:** Update the line in CLAUDE.md to *"The pino `err` serializer in `packages/observability/src/logger.ts:serializeErr` walks `err.cause` recursively and surfaces `code`/`detail` from each level — this matters for wrapped postgres errors where the SQLSTATE lives on `err.cause`."*
- **Effort:** XS
- **Confidence:** High

---

#### P2-09 — `runJob` wrapper logs raw `job.data` without future-proofing redaction

- **Tier:** P2
- **Focus:** Observability / Security
- **Location:** `packages/jobs/src/registry.ts:54`
- **Evidence:**

  ```ts
  child.info({ event: 'job.start', data: job.data }, 'Job started');
  ```

  Today's job data shapes are tiny (`{ venueId }`, `{ performerId }`, `{ regionId }` — UUIDs only). No PII, no tokens.
- **Why it matters:** The pattern is "log the whole `job.data`", which is fine *today* and a footgun *tomorrow*. The next person who adds a job with `data: { user, draftEmail, attachmentToken }` won't think to scrub. The redaction list in P2-02 catches some of this (specifically `*.token`), but the safer pattern is to per-job pick-list the fields worth logging.
- **Suggested fix:** Either:
  1. Add a `dataLogShape` parameter to `runJob` so each handler explicitly opts into which `data` fields to log; or
  2. Rely on the redaction list (assuming P2-02 is fixed) and add a code comment at line 54 reminding new-job authors that any sensitive shape they put on `job.data` will get logged.
  Option 2 is sufficient given the small surface and is a one-line change.
- **Effort:** XS (option 2)
- **Confidence:** Medium

---

#### P2-10 — Four UI files exceed 1.5k LOC each; `add/page.tsx` at 2,917

- **Tier:** P2
- **Focus:** Maintainability
- **Location:** `apps/web/app/(app)/add/page.tsx` (2,917 LOC), `apps/web/components/shows-list/ShowsListView.tsx` (2,666), `apps/web/app/(app)/discover/View.client.tsx` (1,811), `apps/web/app/(app)/shows/[id]/page.tsx` (1,280)
- **Evidence:** Top 4 entries from `find … | xargs wc -l | sort -rn | head`. These are also the four files most likely to change per feature increment.
- **Why it matters:** Not a bug today; a velocity drag tomorrow. A reviewer can't hold 2,917 LOC in their head, so PR review quality drops on these files first. Tests for "the add flow" become smoke-style end-to-end rather than focused unit tests because the component does too many things at once.
- **Suggested fix:** No big-bang split. Pick one extraction per file, per increment, when you're already in there for a feature change. Candidates by inspection (not deep-read):
  - `add/page.tsx` — the chat-mode state machine looks separable from the manual-mode form. Two files of ~1.5k each is still big but better.
  - `ShowsListView.tsx` — inline-edit logic is a likely seam (it's referenced as a known concern in earlier Reviewer notes).
  - `discover/View.client.tsx` and `shows/[id]/page.tsx` — both fit the "page = container + several inline subcomponents" pattern; subcomponents are usually safe to extract first.
- **Effort:** L total / S per increment
- **Confidence:** Medium (extraction targets are guesses without deeper read)

---

### P3 — Nits / opportunistic

Bundled into one section so they don't dilute the higher tiers.

- **P3-01 — `addPerformer` sortOrder race:** `packages/api/src/routers/shows.ts:902-952` reads `max(sortOrder)` then inserts `+1`; two concurrent calls produce duplicate sortOrders. Composite PK on `(showId, performerId, role)` prevents row collision but display order can be non-deterministic. Trivial in practice (users don't mash add-performer concurrently), but a single SQL `INSERT … (sort_order) VALUES (coalesce((select max(sort_order)+1 from …), 1))` would close it.

- **P3-02 — `updatedAt` inconsistently bumped:** `setTicketUrl`, `addPerformer`, `removePerformer` (only sometimes), `updateState`, `deleteAll` don't set `updatedAt`. `update` and `setSetlist` do. Worth a sweep.

- **P3-03 — `shows.updateState` allows only forward transitions:** `VALID_TRANSITIONS = { watching: ['ticketed'], ticketed: ['past'] }` — no way to undo "marked as past" via the API. Probably intentional but an odd-shaped UX edge.

- **P3-04 — CLI scripts use `console.*`:** `packages/jobs/scripts/{run-daily-digest.ts:17,24, bootstrap-pgboss.mjs:15,22,27, email-smoke.ts:64,65,69}`. CLAUDE.md says *"applies to every package, including CLI scripts"*. Easy to migrate to `logger`.

- **P3-05 — `apps/web/server.mjs:27,31` startup banner uses `console.log`:** Minor. Bootstraps before Next, so observability isn't loaded yet. Defensible but worth a short comment.

- **P3-06 — `apps/web/tests/helpers/seed.ts:96,100`:** Test helper, less critical, but matches the pattern.

- **P3-07 — `EMAIL_FROM` defaults to `'Showbook <digest@example.com>'`:** A real send with this default fails fast in Resend (good) but the default looks like a placeholder more than a guard. Either remove the default and require the env var, or use `null` and `throw` early.

- **P3-08 — `runDailyDigest` ET-date computation is fragile:** `notifications.ts:207-211` does `new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))` then `.toISOString().split('T')[0]`. Works because containers run UTC; would silently break under non-UTC runtimes. Use a real TZ-aware library (`date-fns-tz` is already common) or the `Intl.DateTimeFormat({...}).formatToParts()` pattern.

- **P3-09 — `useNetwork()` outside provider returns `INITIAL_STATE = { online: true }`:** `apps/mobile/lib/network.ts:156-165`. The comment acknowledges fail-open. Reasonable; worth an `__DEV__` warning so misuse is at least visible during dev.

- **P3-10 — `apps/mobile/lib/cache/db.ts:118-130` uses `as unknown as` casts** to coerce expo-sqlite types. Same pattern in `packages/jobs/src/health-check/checks.ts:258-259, 305-306, 346-347`. All look defensible (third-party type weakness), but worth a one-line comment per cast linking to the third-party type that motivated it.

- **P3-11 — `mobile-token/route.ts` uses inline body validation instead of zod:** `route.ts:78-99`. Works but inconsistent with the repo's preference. The zod-equivalent is one schema literal and `parseAsync`.

- **P3-12 — `runDailyDigest` ANNOUNCEMENT_CAP = 50 hardcoded:** No env override or per-user knob. Probably fine; flag for the next time someone touches this file.

- **P3-13 — `shows.ts: setlistsMap` collision when same name passed twice:** If `input.performers` contains two entries with the same name and no distinguishing IDs, both resolve to the same performer ID and the second's setlist silently overwrites the first's. Edge case but the silent overwrite is the issue.

- **P3-14 — `apps/web/instrumentation.ts` has no test:** Once it's fixed (P1-03), a unit test that asserts the structured log event fires on simulated startup failure would lock it in.

- **P3-15 — Dual NextAuth env var names:** Both `AUTH_SECRET` and `NEXTAUTH_SECRET` show up in `process.env` references. Pick one and document; the env survey shows both being read.

---

## Focus-area cross-cuts

### Correctness

The two highest-impact bugs are both in the daily/weekly background pipeline (**P1-01**, **P1-02**), and both are silent in dev because they only manifest at the day/week timescale or on a retry path that local dev doesn't exercise. The pattern suggests the test pyramid undercounts background-job correctness — see P2-07. The auth surfaces and tRPC routers, by contrast, have consistent ownership re-checks (every mutation in `shows.ts` does `WHERE id = ? AND userId = ?` and a SELECT-first ownership probe before destructive operations), and there are no swallowed-error patterns in the routers themselves.

### Security

The auth and admin surfaces are the strongest part of the codebase. Mobile token bridge documents its concurrency model (`upsertUserFromGoogle` in `apps/web/lib/mobile-token.ts:121-221`) more carefully than most production codebases I've seen, and `/api/admin/sql` uses six layers of defense-in-depth. The two hardening items (**P2-02** redaction-list completeness, **P2-03** result-set memory cap on `/api/admin/sql`) are small. **P2-01** (`z.any()` for `sourceRefs`) is the only place the input-validation discipline slips.

### Maintainability

Concentrated in four files (**P2-10**), all UI. The package boundaries are clean (no circular imports observed; the `@showbook/observability`, `@showbook/api`, `@showbook/db` split is doing real work). The `runJob` wrapper (`packages/jobs/src/registry.ts:47-85`) is the kind of cross-cutting shape that pays for itself — every job got idiomatic logging + tracing + flush for free. The same pattern would benefit the `shows.ts` router if its mutations grew further, but at 1.1k LOC it's still tractable.

### Tests, observability, performance

- **Tests:** the gap is `packages/jobs/{discover-ingest, health-check}` (P2-07). Everything else has at least mocked-unit coverage and most have integration coverage.
- **Observability:** the redaction list (**P2-02**), the stale CLAUDE.md note (**P2-08**), and the `instrumentation.ts` console.error (**P1-03**) are the items. The structured-event taxonomy in CLAUDE.md is curated and accurate (verified spot-check: `discover.ingest.{phase1,phase2,phase3,phase4}` events fire on the matching code paths in `discover-ingest.ts:622-630, 689-693, 749-752, 771-774`).
- **Performance:** **P2-04** (sequential discover ingest) and **P2-05** (full-table announcement scan in digest) are forecast risks rather than current symptoms. **P2-06** (sequential matcher in `shows.create`) is the only user-facing latency item.

---

## Positive observations

- **Every router uses `protectedProcedure` or `adminProcedure`.** Verified: `rg "publicProcedure" packages/api/src/routers` returns zero hits. `publicProcedure` is exported from `trpc.ts` but unused — defensive design.
- **Auth concurrency is documented in prose.** `apps/web/lib/mobile-token.ts:91-119` explains the orphan-user trade-off and why `ON CONFLICT DO NOTHING` is sufficient given the unique index. The accepted leak is small, real, and acknowledged.
- **`runJob` wrapper.** `packages/jobs/src/registry.ts:47-85` is one of the clearest 40-line cross-cutting concerns I've seen — every job gets timing, structured logging, Langfuse tracing, error logging, and observability flush, uniformly.
- **`/api/admin/sql` defense-in-depth.** Six layers documented inline at `apps/web/app/api/admin/sql/route.ts:29-42`. The author actively chose multiple layers over a complex parser (`apps/web/lib/admin-query.ts:14-21`).
- **No hardcoded secrets.** `rg -nP "(api[_-]?key|secret|password|token)\s*[:=]\s*['\"]"` returns zero non-test hits.
- **`serializeErr` walks `err.cause` recursively.** Production debuggability for wrapped postgres errors. (This is what makes CLAUDE.md's note on this stale — see P2-08.)
- **Redaction is in place** even if incomplete (P2-02). The `*.apiKey`, `*.token`, `*.secret` paths and the cookie/authorization headers cover the bulk of risk.
- **No `TODO`/`FIXME`/`XXX`/`HACK` markers anywhere.** Verified via `rg`. Either the team resolves or doesn't write — both are healthy.

---

## Out of scope (explicit)

- `design/` — hi-fi prototypes; CLAUDE.md says reference-only.
- `packages/db/drizzle/*.sql` — generated migrations; reviewed schema only.
- `packages/scrapers/{run,runtime,extract,cli}.ts` — Playwright-bound, excluded from coverage by design.
- `packages/jobs/{boss,registry,load-env-local}.ts` — orchestration wiring + dev-only; only `registry.ts` was read above and only for the `runJob` wrapper.
- `apps/mobile/{app,components}/` — layout-heavy and coverage-excluded; deep-dive `lib/` only.
- `apps/web/app/api/test/*` — test-only routes, gated behind `ENABLE_TEST_ROUTES=1` + e2e DB name.
- Snapshot test churn — none observed in source tree.
- `pnpm-lock.yaml` — no supply-chain compromise suspected.
- The shallow-clone "behind origin/main" appearance per CLAUDE.md "Working environment" section.

---

## Suggested follow-up grouping

**Fix this PR (effort: ~1 day total, all small):**
- P1-03 — replace `console.error` in `instrumentation.ts` with `logger.error` and a `pgboss.boot.failed` event.
- P2-02 — extend the redaction list with the missing token-like field names.
- P2-08 — update CLAUDE.md to reflect the `err.cause` serializer.

**Fix next iteration (effort: ~2 days total):**
- P1-01 — switch the Phase 4 prune predicate to consider `runEndDate`. Add a regression integration test.
- P1-02 — add the pre-send `lastDigestSentAt` guard. Add a regression integration test (re-run of the same job is a no-op).
- P2-01 — replace `z.any()` for `sourceRefs` with a real schema + size cap.
- P2-06 — `Promise.all` the matcher loops in `shows.create` and `shows.update`.
- P2-09 — add a code comment to `runJob` reminding new-job authors about `data` log redaction.

**Schedule (effort: ~1 week total):**
- P2-03 — inject `LIMIT` into `/api/admin/sql` queries (option 1) or stream rows (option 2).
- P2-04 — bound concurrency in `runDiscoverIngest` and add per-phase checkpointing.
- P2-05 — push announcement filtering into SQL.
- P2-07 — add `discover-ingest.integration.test.ts` and `health-check.integration.test.ts`.

**Tracked but defer:**
- P2-10 — UI file size. One extraction per feature touch, opportunistic.
- All P3 items — sweep when you're in the area for another reason.

---

## Appendix

### A. LOC ranking (top 25 source files)

```
   2917 apps/web/app/(app)/add/page.tsx
   2666 apps/web/components/shows-list/ShowsListView.tsx
   1811 apps/web/app/(app)/discover/View.client.tsx
   1280 apps/web/app/(app)/shows/[id]/page.tsx
   1223 apps/web/app/(app)/preferences/View.client.tsx
   1107 packages/api/src/routers/shows.ts
    997 apps/web/app/(app)/map/MapView.tsx
    981 apps/mobile/app/(tabs)/shows.tsx
    918 apps/web/app/(app)/home/View.client.tsx
    841 apps/mobile/app/show/[id].tsx
    838 apps/mobile/app/(tabs)/map.tsx
    783 packages/jobs/src/discover-ingest.ts
    710 apps/web/components/SetlistSectionsEditor.tsx
    695 apps/web/app/(app)/venues/[id]/page.tsx
    693 packages/api/src/routers/media.ts
    693 packages/api/src/routers/discover.ts
    671 packages/api/src/groq.ts
    644 packages/api/src/__tests__/shows.integration.test.ts
    639 apps/web/components/preferences/SpotifyImportPicker.tsx
    586 packages/api/src/routers/enrichment.ts
    579 apps/mobile/app/venues/[id].tsx
    559 apps/web/components/media/MediaSection.tsx
    552 apps/web/app/(app)/artists/View.client.tsx
    547 packages/api/src/__tests__/shows-router.test.ts
    522 apps/mobile/lib/network.ts
```

### B. `console.*` leak scan

```
packages/jobs/scripts/run-daily-digest.ts:17,24      # CLI script (P3-04)
packages/jobs/scripts/bootstrap-pgboss.mjs:15,22,27  # CLI script (P3-04)
packages/jobs/scripts/email-smoke.ts:64,65,69        # CLI script (P3-04)
apps/web/server.mjs:27,31                            # Startup banner (P3-05)
apps/web/tests/helpers/seed.ts:96,100                # Test helper (P3-06)
apps/web/instrumentation.ts:9                        # ★ P1-03
```

### C. Procedure-builder counts per router

```
packages/api/src/routers/preferences.ts     :  6
packages/api/src/routers/media.ts           :  9
packages/api/src/routers/discover.ts        : 11
packages/api/src/routers/spotify-import.ts  :  3
packages/api/src/routers/search.ts          :  2
packages/api/src/routers/performers.ts      : 13
packages/api/src/routers/venues.ts          : 14
packages/api/src/routers/enrichment.ts      : 14
packages/api/src/routers/admin.ts           :  7  (incl. adminProcedure)
packages/api/src/routers/shows.ts           : 17
                                              ────
                                              96  procedures total
```

`publicProcedure` is exported in `packages/api/src/trpc.ts:37` but used in 0 routers — every procedure is at minimum `protectedProcedure`.

### D. Env vars referenced

(via `grep -rohE 'process\.env\.[A-Z_]+' apps packages | sort -u`):

```
ADMIN_EMAILS            ADMIN_QUERY_TOKEN       AUTH_ALLOWED_DOMAINS
AUTH_ALLOWED_EMAILS     AUTH_SECRET             AXIOM_DATASET
AXIOM_ORG_ID            AXIOM_QUERY_DATASET     AXIOM_QUERY_TOKEN
AXIOM_TOKEN             CI                      DATABASE_URL
EMAIL_FROM              ENABLE_TEST_ROUTES      EXPO_PUBLIC_API_URL
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY
EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_{ANDROID,IOS,WEB}
GOOGLE_CLIENT_ID        GOOGLE_CLIENT_SECRET    GOOGLE_OAUTH_MOBILE_AUDIENCES
GOOGLE_PLACES_API_KEY   GROQ_API_KEY            LANGFUSE_BASEURL
LANGFUSE_PUBLIC_KEY     LANGFUSE_SECRET_KEY     LOG_LEVEL
MEDIA_ALLOWED_IMAGE_TYPES   MEDIA_ALLOWED_VIDEO_TYPES
MEDIA_GLOBAL_QUOTA_BYTES    MEDIA_LOCAL_UPLOAD_ROOT
MEDIA_SHOW_QUOTA_BYTES      MEDIA_STORAGE_MODE      MEDIA_USER_QUOTA_BYTES
NEXTAUTH_SECRET         NEXTAUTH_URL            NEXT_PUBLIC_APP_URL
NEXT_RUNTIME            NODE_ENV                PLAYWRIGHT_CHROMIUM_PATH
PLAYWRIGHT_PORT         PLAYWRIGHT_WORKERS      PORT
RESEND_API_KEY          SETLISTFM_API_KEY
SHOWBOOK_BULK_SCAN_MESSAGE_CAP    SHOWBOOK_BULK_SCAN_PER_HOUR
SHOWBOOK_LLM_CALLS_PER_DAY        SMOKE_OUT
SPOTIFY_CLIENT_ID       SPOTIFY_CLIENT_SECRET   TEST_DATABASE_NAME
TICKETMASTER_API_KEY    TZ
```

Notable: both `AUTH_SECRET` (used by mobile token route) and `NEXTAUTH_SECRET` (per env survey) are read — see P3-15.

### E. Type-safety escape hatches (`as any` / `as unknown as` / `@ts-ignore` / `@ts-expect-error`)

15 hits in non-test code. The vast majority are defensible (third-party type weaknesses): `apps/mobile/lib/cache/db.ts` for expo-sqlite (5), `packages/jobs/src/health-check/checks.ts` for postgres-js result rows (6), `apps/web/app/api/admin/sql/route.ts:178-179` for the same. No `as any` casts at all (only `as unknown as`). No `@ts-ignore`. Healthy.

### F. Integration test inventory

15 `*.integration.test.ts` files:

```
packages/jobs/src/__tests__/prune-orphan-catalog.integration.test.ts
packages/jobs/src/__tests__/notifications.integration.test.ts
packages/api/src/__tests__/performers-list-followed.integration.test.ts
packages/api/src/__tests__/venues.integration.test.ts
packages/api/src/__tests__/region-ingest-status.integration.test.ts
packages/api/src/__tests__/nearby-feed.integration.test.ts
packages/api/src/__tests__/user-delete-cascade.integration.test.ts
packages/api/src/__tests__/media.integration.test.ts
packages/api/src/__tests__/followed-artists-feed.integration.test.ts
packages/api/src/__tests__/shows.integration.test.ts
packages/api/src/__tests__/matcher-unique-race.integration.test.ts
packages/api/src/__tests__/media-set-performers.integration.test.ts
packages/api/src/__tests__/multi-user-isolation.integration.test.ts
apps/web/src/__tests__/mobile-token.integration.test.ts
apps/mobile/lib/__tests__/cache/outbox.integration.test.ts
```

Gap: nothing for `discover-ingest`, `health-check`, `setlist-retry`, `shows-nightly`, `backfill-*`. P2-07 covers the two highest-priority of these.

---

*End of review. Findings keyed `P{tier}-{nn}` are stable and can be referenced in commit messages or follow-up PR titles. The review document itself is intentionally self-contained — a follow-up PR can quote a finding by ID and the reader doesn't need this conversation context.*
