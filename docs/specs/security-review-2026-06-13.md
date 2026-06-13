# Security review

**Date:** 2026-06-13
**Branch:** `claude/showbook-security-review-2ek2ut`
**Scope:** Full-codebase review of the current state — every HTTP route under
`apps/web/app/api`, the tRPC routers (`packages/api`) for object-level access
control / IDOR, the auth / session / mobile-token surfaces, the media-upload
and SSRF/image-proxy boundaries, the Playwright venue scraper, and the
dependency tree. Focus on **critical** / **high** / **medium** severity.
**Method:** Source review (each finding read and confirmed in source; the SSRF
finding additionally verified with a local proof-of-concept), plus
re-verification that the prior review's fixes are still present.

This builds on the previous full reviews:
- [`security-review-2026-06-09.md`](security-review-2026-06-09.md) (7 findings, all fixed)
- [`security-review-2026-04-30.md`](security-review-2026-04-30.md)

## TL;DR

- **No critical issues.** No unauthenticated auth bypass, RCE, SQL injection,
  or unauthenticated data breach.
- **1 high, 1 medium, 1 low** — all fixed in the same PR as this report (the
  status column reflects the shipped fix, not the as-found state).
- The 2026-06-09 baseline **holds**: all seven prior fixes verified present in
  current source. The new H1 is the unaddressed half of that review's H1 —
  the scrape-config URL is now access-gated (`assertVenueAccess`) but was still
  fetched server-side with no SSRF policy, which the prior review explicitly
  deferred ("Consider whether the scraper should additionally enforce an SSRF
  host policy").

| ID | Severity | Area | Status |
|----|----------|------|--------|
| H1 | HIGH | SSRF + local-file read via venue scraper URL (`file://` / internal hosts), exfiltrated through `scrapeStatus` | Fixed — `assertPublicHttpUrl` guard at the fetch boundary + sync guard in the config schema |
| M1 | MEDIUM | Gmail mobile-bearer paths skip the AUTH_ALLOWED_* re-check (deauthorization not enforced for ≤30 days) | Fixed — `isEmailAllowed` re-check on both bearer paths |
| L1 | LOW | Gmail **scan** route logs head+tail of the live access token (the 2026-06-09 L1 fix patched only the sibling callback) | Fixed — log token `length` only |

Informational (no fix shipped): two dev-only `esbuild` advisories
(`tsx` / `drizzle-kit`, build-time only); the in-memory per-process rate
limiter is fine for the single-process self-host but would weaken under
horizontal scaling.

---

## HIGH

### H1 — SSRF + local-file read via the venue scraper's configured URL

**Files:**
- `packages/api/src/scrape-config.ts` (URL accepted as `z.string().url()` only)
- `packages/scrapers/src/run.ts:56` / `packages/scrapers/src/runtime.ts:45-59` /
  `packages/scrapers/src/extract.ts:14-30` (server-side `fetch` + Playwright `page.goto`)
- `packages/api/src/routers/venues.ts:557-579` (`scrapeStatus` reads the result back)

The venue scrape config URL is set by `venues.saveScrapeConfig`. The
2026-06-09 review's **H1** fixed the *authorization* gap there — both
`saveScrapeConfig` and `scrapeStatus` now call `assertVenueAccess` (follow OR a
show at the venue). But the URL itself was validated only as
`z.string().url()`, and the weekly discover-ingest cron
(`packages/jobs/src/registry.ts:628`, `runScrapers`, Mondays 06:00) fetches it
**server-side** with no SSRF policy:

1. `isAllowedByRobots(cfg.url)` does `fetch(\`${url.protocol}//${url.host}/robots.txt\`)`.
2. `loadAndExtract(cfg.url)` opens it in headless Chromium via `page.goto(url)`.

`z.string().url()` accepts `file://`, `http://127.0.0.1:3002/…`,
`http://169.254.169.254/…`, and LAN IPs (verified — `new URL` / zod accept all
four, including `file:///etc/passwd`). Chromium **navigates `file://` URLs**, and
`document.body.innerText` returns the file contents. The first 2 KB of the
rendered text is persisted to `venue_scrape_runs.pageHtmlExcerpt`
(`run.ts:93`), and `scrapeStatus` returns the full last-run row
(`select()` — all columns) to anyone who passes `assertVenueAccess`.

**Proof of concept (confirmed locally).** Driving Playwright exactly as
`loadAndExtract` does:

```
page.goto('file:///tmp/fake-secret.env')
document.body.innerText
  -> "AUTH_SECRET=supersecret123\nPOSTGRES_PASSWORD=hunter2"
```

**Impact.** Any approved (invite-gated) user who follows a venue — or creates
their own venue, which gives them a show at it — can set
`scrapeConfig.url = 'file:///…/.env.prod'` (or `http://localhost:3002/api/...`,
or any LAN host), wait for the weekly cron, then read the first 2 KB of the
response back via `scrapeStatus.lastRun.pageHtmlExcerpt`. Reading `.env.prod`
leaks `AUTH_SECRET`, the Postgres password, and third-party API keys →
full server compromise. Because Chromium executes JavaScript, internal HTTP
targets are reached with a full browser, not a blind request.

**Bounding factors (why HIGH, not critical):** requires an approved account
(Showbook is invite/allowlist-gated), the cron runs weekly (slow loop), and the
deployment is a self-hosted desktop — so there is no cloud-metadata credential
endpoint, and the blast radius is the home LAN + the local filesystem. The
local-file-read of `.env.prod` is the sharpest edge.

**Fix (shipped).** New `packages/api/src/url-guard.ts`:
- `assertPublicHttpUrlSync` — rejects non-`http(s)` schemes (kills `file://`,
  `ftp://`, `gopher://`), embedded credentials, `localhost`, and IP-literal
  hosts in loopback / private / link-local / CGNAT / reserved ranges. Wired
  into `scrapeConfigSchema` via `.refine`, so `saveScrapeConfig` rejects these
  at write time (and `parseScrapeConfig` drops any pre-existing bad row).
- `assertPublicHttpUrl` — the synchronous check plus DNS resolution, rejecting
  any hostname that resolves to a private/reserved address. Called at the top
  of the per-venue loop in `run.ts` **before** the robots fetch and the
  `page.goto`, so a blocked URL marks the run `error` (event
  `scrape.venue.url_blocked`) and never touches the network/filesystem.

Residual: this does not pin the resolved IP, so a determined attacker could
still race a DNS rebind between the check and the connect (TOCTOU). The
structural + resolved-IP checks close the overwhelming majority of the surface
(`file://`, literal private IPs, hostnames currently pointing at private space);
full rebind protection would require pinning the resolved address through to the
Chromium connect and is tracked as a possible hardening follow-up.

---

## MEDIUM

### M1 — Gmail mobile-bearer paths skip the allowlist re-check

**Files:** `apps/web/app/api/gmail/scan/route.ts:29-40`,
`apps/web/app/api/gmail/route.ts:40-52`

The canonical mobile-bearer resolver `resolveTrpcSession`
(`apps/web/app/api/trpc/[trpc]/resolve-session.ts:86-95`) re-checks the
`AUTH_ALLOWED_*` allowlist on every bearer decode — the same rule as the cookie
path's `jwt` callback — so a user removed from the allowlist loses mobile access
on the next request rather than retaining it until their 30-day JWT expires.
The media-upload and image-proxy routes route through it.

The two Gmail routes each rolled their **own** bearer decode with **no**
allowlist check (`decoded.id` used directly). Both are scoped strictly to the
caller's own `userId` / own Gmail OAuth tokens, so there is no cross-tenant
reach — the gap is that a **deauthorized** account keeps self-access to its own
Gmail-import surface for up to the token lifetime, inconsistent with every other
authenticated surface. The 2026-06-09 review verified `resolve-session.ts` but
did not examine these two hand-rolled helpers.

**Fix (shipped).** Both bearer paths now call
`isEmailAllowed(decoded.email, readAllowlistFromEnv())` after decode and treat a
non-allowlisted email as unauthenticated, matching `resolveTrpcSession`.

---

## LOW

### L1 — Gmail scan route logs head+tail of the live access token

**File:** `apps/web/app/api/gmail/scan/route.ts:264-279`

The 2026-06-09 review's **L1** removed the head/tail token fingerprint from the
Gmail **callback** log but missed the sibling **scan** route, which still
emitted `tokenInfo.head` (first 8 chars) + `tokenInfo.tail` (last 4) of the live
Gmail bearer on every scan. pino's redaction (`*.token` etc.) does **not** match
`tokenInfo.head`/`.tail`, so 12 chars of secret material shipped to Axiom. Low
(short-lived, high-entropy token, 12 of ~200+ chars), but it violates the
"never log secrets" rule and was inconsistent with the callback fix.

**Fix (shipped).** The scan log now emits `tokenInfo.length` only, mirroring the
callback.

---

## Verified safe — not findings

Re-confirmed in current source (so the next pass doesn't re-litigate):

- **All seven 2026-06-09 fixes present:** venue scrape-config IDOR
  (`assertVenueAccess` on `saveScrapeConfig`/`scrapeStatus`/`rename`/`resetName`),
  telemetry log-forgery / Axiom field-cap (`ALLOWED_CONTEXT_KEYS`, server-set
  `event`/`userId` after the context spread, per-IP rate limit), eventbrite
  callback token validation, `test/login` fail-closed on empty secret, gmail
  *callback* token-length-only logging, `admin/sql` `WITH RECURSIVE` rejection +
  3 s timeout, telemetry/crash-report rate limits.
- **tRPC object-level access control:** every id-keyed `protectedProcedure`
  traced to a `ctx.session.user.id` ownership filter or a verified access gate;
  no new IDOR. `adminProcedure` / `eval.*` re-derive admin status per request
  from `ADMIN_EMAILS`. The newer `admin.renameVenue` / `admin.updateVenueLocation`
  (#561) and per-user venue names (#547) are admin-gated / follow-gated and
  select-then-update (no mass assignment).
- **#597 showtime uploads:** `media.createUploadIntent` still gates on
  `getShowOwnedByUser` (own-show only); #597 only widened *when* the owner may
  upload (`hasShowStarted`), not *who*. Storage keys remain server-generated and
  hard-scoped to `showbook/${userId}/shows/${showId}/`.
- **iCal / account-export:** auth-gated and IDOR-scoped to the session user.
- **Image proxies** (`venue-photo`/`performer-photo`/`show-cover`): auth +
  `ALLOWED_PROXY_HOSTS` + stricter `ALLOWED_REDIRECT_HOSTS`, one-hop manual
  redirect, content-type allowlist excluding SVG, CSP. `show-cover` also checks
  show ownership.
- **OAuth callbacks** (gmail/spotify/eventbrite): `state` validated against an
  httpOnly cookie, session re-checked, script payloads escaped, `postMessage`
  targets `window.location.origin`.
- **mobile-token bridge:** verifies the Google ID token audience, rejects
  `email_verified === false`, applies the allowlist, fails closed without
  `AUTH_SECRET`, rate-limited; tokens live in `expo-secure-store`; bearer never
  falls back to cookie on a bad decode (`resolve-session.ts`).
- **Media path traversal:** `assertSafeKey` + `path.relative` containment on the
  local-disk write path; R2 keys are flat (a `..` segment is a literal key, no
  traversal); oversize + content-type guards on both declared and actual bytes.
- **Crypto:** `timingSafeEqual` for `ADMIN_QUERY_TOKEN` and unsubscribe HMACs;
  no security use of `Math.random()`; no hardcoded secrets; `EXPO_PUBLIC_*` are
  client IDs / public URLs only.

## Dependency audit (informational)

`pnpm audit` reports two `esbuild` advisories (GHSA-gv7w-rqvm-qjhr high,
plus a low arbitrary-file-read), both reached only via `tsx` and
`drizzle-kit` — **dev/build-time toolchain**, not runtime/production
dependencies, and the high one is a Deno-specific RCE via `NPM_CONFIG_REGISTRY`.
Low real-world relevance for a self-hosted app; bump when the toolchain
naturally moves to `esbuild >= 0.28.1`.

## Fixes shipped in this PR

1. **H1** — `packages/api/src/url-guard.ts` (`assertPublicHttpUrl` /
   `assertPublicHttpUrlSync` / `isPrivateOrReservedIp` / `BlockedUrlError`),
   wired into `scrapeConfigSchema` (write-time) and `scrapers/run.ts`
   (fetch-time, with the `scrape.venue.url_blocked` event).
2. **M1** — `isEmailAllowed` re-check on both Gmail bearer paths.
3. **L1** — Gmail scan log emits token `length` only.

Tests: new `url-guard.test.ts` (IP-range classification, scheme/credential/
loopback rejection, `file://` rejection, public-URL allow); new
`saveScrapeConfig` case rejecting `file://` / localhost / private-IP / metadata
URLs. `pnpm verify`-scope lint + typecheck + unit tests green across the
affected projects.
