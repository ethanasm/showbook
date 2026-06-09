# Security review

**Date:** 2026-06-09
**Branch:** `claude/security-review-report-qie5uc`
**Scope:** Full-codebase review of the current state — web app (`apps/web`),
mobile app (`apps/mobile`, where most recent work has landed), and the shared
tRPC API (`packages/api`). Focus on **critical** and **high** severity issues.
**Method:** Source review of the auth/token surfaces, every HTTP route under
`apps/web/app/api`, the tRPC routers (object-level access control / IDOR), the
mobile token/storage/deep-link/network paths, and the SSRF/image-proxy and
media-upload boundaries. Each finding below was read and confirmed in source;
several candidate findings were dropped after verification (see "Verified safe
— not findings").

## TL;DR

- **No critical issues found.** There is no unauthenticated auth bypass, RCE,
  SQL injection, or unauthenticated data breach.
- **2 high** issues, both broken-access-control / abuse-of-public-endpoint, not
  memory/crypto bugs. Both are exploitable by an authenticated (or, for H2, any
  unauthenticated) caller and warrant a fix.
- The codebase has a **strong** baseline: closed-by-default admin gating
  re-derived per request, bearer-never-falls-back-to-cookie, SSRF host
  allowlists on the image proxies, path-containment on local media writes,
  timing-safe admin-token comparison, secrets in SecureStore on mobile, and ATS
  enforced in prod. The high findings are gaps in that baseline, not a weak
  foundation.

All seven were **fixed in the same PR** that introduced this report — the
status column reflects the fix shipped, not the as-found state.

| ID | Severity | Area | Status |
|----|----------|------|--------|
| H1 | HIGH | tRPC IDOR — venue scrape config (`venues.saveScrapeConfig` / `scrapeStatus`) | Fixed — follow/ownership gate (`assertVenueAccess`) |
| H2 | HIGH | Unauthenticated `telemetry.logEvent` — log forgery + Axiom field-cap exhaustion | Fixed — context-key allowlist, server-set `event`/`userId`, per-IP rate limit |
| M1 | MEDIUM | `eventbrite/callback` does not validate the token response | Fixed — reject non-string/empty `access_token` |
| M2 | MEDIUM | `test/login` falls back to an empty JWT secret (`?? ''`) | Fixed — fail closed (500) when no secret |
| L1 | LOW | Partial Gmail access token (head+tail) written to logs | Fixed — log token length only |
| L2 | LOW | `admin/sql` permits recursive CTEs within the statement timeout | Fixed — reject `WITH RECURSIVE`, timeout 5s→3s |
| L3 | LOW | `telemetry.logEvent` / `crash-report` unauthenticated + no rate limit | Fixed — per-IP rate limits on both |

---

## HIGH

### H1 — IDOR: any authenticated user can read/write/delete any venue's scrape config

**Files:** `packages/api/src/routers/venues.ts:414-450` (`saveScrapeConfig`),
`packages/api/src/routers/venues.ts:457-478` (`scrapeStatus`)

Both procedures are `protectedProcedure` and key only on `input.venueId`, with
**no check** that the caller owns or follows the venue:

```ts
saveScrapeConfig: protectedProcedure
  .input(z.object({ venueId: z.string().uuid(), config: /* { url, frequencyDays } | null */ }))
  .mutation(async ({ ctx, input }) => {
    // ...
    await ctx.db
      .update(venues)
      .set({ scrapeConfig: config })
      .where(eq(venues.id, input.venueId));   // ← venueId only; no userId / follow check
    return { success: true };
  })
```

Contrast with the correct pattern a few procedures up — `venues.rename`
(`venues.ts:221-240`) first selects from `userVenueFollows` scoped to
`ctx.session.user.id` and throws `FORBIDDEN` otherwise. `saveScrapeConfig`,
the null-config delete branch, and `scrapeStatus` all skip that gate.

**Impact.** Any signed-in user can:
- Overwrite or delete the scrape config of **any** venue in the system — the
  config is shared/visible to everyone who follows that venue, so this is
  cross-tenant data tampering.
- Set an **attacker-controlled `url`** (validated only as `z.string().url()`)
  that is later fetched **server-side** by the Playwright venue scraper
  (`packages/scrapers`) and run through the LLM extraction whose output becomes
  announcements shown to other users. This turns a write-IDOR into an
  attacker-steered server-side fetch + a content-injection vector into other
  users' feeds.
- Enumerate every venue's scrape config and run history via `scrapeStatus`
  (information disclosure of what's monitored and from where).

**Mitigating context.** Showbook is invite-/allowlist-gated, so the attacker
must already be an approved user — this bounds external exploitation and is why
this is HIGH, not critical. It is still a clear break of the intended
per-follower authorization model.

**Fix.** Gate both procedures on the same follows/ownership check used by
`venues.rename` before reading or writing `scrapeConfig`. Consider whether the
scraper should additionally enforce an SSRF host policy on the configured `url`
(see L2 rationale — the scraper is the actual fetch boundary).

### H2 — Unauthenticated `telemetry.logEvent`: log forgery + Axiom field-cap exhaustion

**File:** `packages/api/src/routers/telemetry.ts:42-65`

```ts
logEvent: publicProcedure                          // ← intentionally unauthenticated
  .input(z.object({
    event: z.string().min(1).max(80),
    message: z.string().min(1).max(2000),
    level: z.enum(['warn','error']).default('error'),
    context: z.record(z.string(), z.unknown()).optional(),  // ← arbitrary keys
  }))
  .mutation(({ ctx, input }) => {
    const clipped = clipContext(input.context);    // caps total bytes (8 KB), NOT key count
    const payload = {
      event: `mobile.${input.event}`,
      userId,
      ...(clipped ?? {}),                           // ← spread LAST, at top level
    };
    log.warn/error(payload, input.message);
  })
```

This endpoint is mounted on the public tRPC router, so it is reachable by
anyone with `fetch`. Two distinct problems, both stemming from the unbounded
`context` bag being **spread at the top level after** `event`/`userId`:

1. **Log forgery / spoofing.** Because `...clipped` is spread *after* the
   explicit fields, attacker-supplied keys **override** them. A request with
   `context: { event: 'auth.user_created', userId: '<victim-id>' }` produces a
   log line attributed to an arbitrary user and an arbitrary (even server-
   namespaced) event name. This corrupts the audit/observability trail and can
   trip alerting (e.g. the `error_volume` morning health check).

2. **Axiom 257-column field-cap exhaustion (denial of observability).** Each
   unique top-level key spread into the payload becomes a new column in the
   `prod-mobile` Axiom dataset. The 8 KB clip bounds *bytes*, not the *number*
   of distinct keys — dozens of short unique keys fit per request, and across
   requests an attacker can permanently exhaust the 257-column cap. Per
   `CLAUDE.md` / `docs/specs/operations/axiom-dataset-cutover.md`, hitting this
   cap causes **all** subsequent writes that introduce unseen fields to be
   silently rejected — this is exactly the failure that dropped mobile
   telemetry for ~2 months in 2026-05, and recovery requires recreating the
   dataset.

**Why HIGH.** Unauthenticated, trivially scriptable, and the impact
(silent, sustained loss of all mobile telemetry + forged audit records) is a
documented real-world operational hazard for this project.

**Fix.** Don't spread caller context at top level. Either (a) nest it under a
single fixed `context` column and JSON-stringify it (stable one-column field
surface), or (b) allowlist a fixed set of context keys and drop the rest, and
cap key count (e.g. ≤ 25). In all cases set `event`/`userId` **after** the
spread so they can't be overridden. Apply the same key-count guard to the
`crash-report` route (it already rejects on size, not key count — though it
does not spread an arbitrary bag, so it is lower risk).

---

## MEDIUM

### M1 — Eventbrite OAuth callback does not validate granted scopes

**File:** `apps/web/app/api/eventbrite/callback/route.ts` (token exchange,
~lines 103-124)

The Gmail callback validates that the returned token carries the required
scopes and the Spotify callback constrains scope server-side; the Eventbrite
callback parses `access_token` and hands it back without checking `scope`. A
downgraded/partial grant surfaces later as opaque import failures rather than a
clear authorization error. Lower security impact than a classic bug, but it
weakens the consent guarantee relative to the other two providers. Parse and
assert the required scope before returning the token.

### M2 — `test/login` falls back to an empty JWT signing secret

**File:** `apps/web/app/api/test/login/route.ts:40`

```ts
secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? '',
```

If both secrets are unset, the route mints a session JWT signed with the empty
string — a forgeable, zero-entropy secret. **This is not reachable in
production:** `testRouteGuard()` requires `ENABLE_TEST_ROUTES=1` **and** the
active database to be `showbook_e2e` (`apps/web/app/api/test/_guard.ts`), and a
prod deploy satisfies neither. It is downgraded from the "critical" an
automated pass might flag, to a **hardening footgun**: a cryptographic signing
secret should never silently default to empty. Replace the `?? ''` with an
explicit `throw`/500 when no secret is configured, so a misconfiguration fails
closed rather than producing forgeable tokens.

---

## LOW / notes

- **L1 — Partial access token in logs.** `apps/web/app/api/gmail/callback/route.ts:238-242`
  logs `head` (first 8 chars) + `tail` (last 4) of the live Gmail access token
  under a `tokenInfo` field deliberately named to evade pino's `*.token`
  redaction. It's a small leak of a short-lived token to Axiom for debugging;
  prefer logging only `length` (drop head/tail) so no secret material lands in
  the log store.

- **L2 — `admin/sql` recursive CTEs.** `WITH` is an allowed verb
  (`apps/web/lib/admin-query.ts:25-32`); a token holder could run a recursive
  CTE that burns CPU/memory up to the 5 s `statement_timeout`. The endpoint's
  defense-in-depth is otherwise excellent (timing-safe token compare,
  `BEGIN READ ONLY` as the real boundary, separate read-only DB role, per-IP
  rate limit, 2-conn cap, row cap). Accepted; optionally tighten
  `statement_timeout` and/or alert on repeated timeouts.

- **L3 — Unauthenticated telemetry/crash endpoints, no rate limit.**
  `telemetry/*` and `mobile/crash-report` are public by design (capture
  pre-auth failures) and rely on Showbook being single-tenant. Acceptable as
  documented, but fixing H2 is independent of and more important than rate
  limiting here.

---

## Verified safe — not findings (candidates that were checked and cleared)

These were flagged as suspicious during the review and confirmed safe in
source, recorded so the next pass doesn't re-litigate them:

- **Media-upload path traversal — defended.** `apps/web/app/api/media/upload/route.ts`
  only checks the `showbook/<userId>/` prefix, but the storage layer
  (`packages/api/src/media-storage.ts`) calls `assertSafeKey` (rejects `..`,
  backslashes, absolute paths, and enforces a `SAFE_KEY_RE`) **and** a
  `path.relative` containment check against the media root before any fs write.
  No traversal.
- **OAuth `postMessage` target origin — safe.** The callbacks post to
  `window.opener` with `window.location.origin` as the target origin
  (`gmail/callback/route.ts:259`, etc.). The popup is same-origin with its
  opener, so this correctly restricts delivery to the app's own origin. Not an
  open-redirect / token-leak.
- **Admin tRPC mutations — properly gated.** Every `admin.*` backfill/enqueue
  mutation uses `adminProcedure` (`packages/api/src/routers/admin.ts`), which
  re-derives admin status from `ADMIN_EMAILS` (closed-by-default,
  `packages/api/src/admin.ts` / `trpc.ts:81-92`) on **every** call.
- **Bearer auth does not fall back to cookie.** `resolve-session.ts` returns
  null on an invalid bearer rather than retrying cookie auth — prevents a
  bad-bearer → cookie-session confusion.
- **Image proxies — strong SSRF posture.** `venue-photo` / `performer-photo` /
  `show-cover` enforce `ALLOWED_PROXY_HOSTS` + a stricter
  `ALLOWED_REDIRECT_HOSTS`, one-hop manual redirect handling, a content-type
  allowlist that excludes `image/svg+xml`, CSP headers, and require auth.
- **Mobile token/secret storage — correct.** Session JWT and Google tokens live
  in `expo-secure-store` (`apps/mobile/lib/auth.ts`), never in the SQLite query
  cache (which holds only non-secret query results in the app-private sandbox);
  ATS allows cleartext only for `localhost` in dev (`app.config.ts`); tRPC
  attaches the bearer per-request; no `react-native-webview` loading untrusted
  content; no secrets baked into the bundle (all `EXPO_PUBLIC_*` are client IDs
  / public keys).
- **Per-row ownership across shows/media/spotify/performers.** Mutations on
  user-owned data consistently filter on `ctx.session.user.id`
  (`and(eq(shows.id, …), eq(shows.userId, userId))`, media asset+show ownership
  checks, follow ops scoped to the session user). `venues` scrape config (H1)
  is the outlier.

---

## Fixes shipped in this PR

1. **H1** — `venues.saveScrapeConfig` (both branches) and `scrapeStatus` now
   call a shared `assertVenueAccess` (follow OR show at the venue), mirroring
   `venues.rename`. The web venue-detail page only renders
   `ScrapeConfigSection` for users who pass that gate.
2. **H2** — `telemetry.logEvent` now drops context keys outside a curated
   allowlist (bounding the Axiom field surface), sets `event`/`userId` *after*
   the context spread so they can't be forged, and applies a per-IP rate
   limit (client IP threaded through the tRPC context).
3. **M1** — `eventbrite/callback` validates the token response and refuses to
   reflect a missing/empty `access_token` as a credential.
4. **M2** — `test/login` returns 500 instead of signing with an empty secret.
5. **L1** — the Gmail callback logs only the access token's length.
6. **L2** — the admin SQL validator rejects `WITH RECURSIVE`; statement
   timeout tightened 5s → 3s.
7. **L3** — per-IP rate limits added to `telemetry.logEvent` and the
   `mobile/crash-report` route.

Tests: new unit coverage for the telemetry allowlist / forgery / drop paths
and the recursive-CTE rejection; venue unit + integration tests updated for
the new authorization gate (FORBIDDEN cases added).
