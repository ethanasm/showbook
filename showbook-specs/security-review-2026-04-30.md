# Security review

**Date:** 2026-04-30
**Branch:** `claude/fix-url-encoding-getevent-E5FHM`
**Scope:** Audit of LOW-severity findings raised by an external review.
**Method:** Source review of the flagged files plus call-graph trace of the
user-input → outbound-fetch path for L1.

## Findings

### L1 — Ticketmaster path IDs not URL-encoded — **fixed**

`packages/api/src/ticketmaster.ts` interpolated `tmEventId`, `tmVenueId`, and
`tmAttractionId` straight into `/events/{id}.json`, `/venues/{id}.json`,
`/attractions/{id}.json`. The event ID flows from user input via
`fetchTMEventByUrl` (`packages/api/src/routers/enrichment.ts:129`):

```ts
const pathMatch = input.url.match(/\/event\/([A-Za-z0-9]+)/);
const queryMatch = input.url.match(/[?&]eventId=([A-Za-z0-9]+)/);
const eventId = pathMatch?.[1] ?? queryMatch?.[1] ?? input.url.trim();
```

The two regex branches are bounded to `[A-Za-z0-9]+`, but the **fallback**
hands the raw trimmed URL to `getEvent`. Without encoding, a crafted input
could rewrite the path (e.g. `?` to inject query params, `/` to traverse to a
sibling endpoint). The base URL is locked to `app.ticketmaster.com`, so this
isn't classic SSRF, but it lets an unauthenticated string steer our API key
across arbitrary Discovery endpoints — exactly what the original audit called
out.

**Fix:** wrap each path-interpolated id with `encodeURIComponent()` at the
client layer so callers can't bypass it. Tests added in
`packages/api/src/__tests__/ticketmaster.test.ts` assert that path-significant
characters (`/`, `?`, `#`, space) are percent-encoded for all three getters.

### L2 — Stray `console.error` in client component — **fixed**

`apps/web/app/(app)/shows/View.client.tsx:444` logged Gmail-scan failures via
`console.error` while also surfacing the message through `setGmailError(msg)`.
The console line was redundant — it didn't reach any sink (the observability
package is pino-based and server-only, so it can't be imported into a
`"use client"` file), and the user-visible error path was already covered.
Server-side scan logging stays in `apps/web/app/api/gmail/scan/route.ts` where
the pino logger is available.

**Fix:** removed the `console.error`; the existing `setGmailError(msg)` call
is the only state change needed.

### L3 — Self-signed cert preference in `server.mjs` — **no code change, documented here**

If `/app/certs/localhost-cert.pem` is mounted at runtime, `server.mjs` boots
HTTPS with a self-signed cert and `cloudflared` then needs `noTLSVerify: true`
to talk to it. Cleaner is plain HTTP on loopback to `cloudflared`.

**Action:** none in this branch. Operationally, either drop the cert mount in
prod or document the origin URL the tunnel must use. Tracked here so the next
infra pass can pick it up alongside `cloudflare-tunnel-setup.md`.

### L4 — In-process rate limiter buckets reset on restart — **accepted, already documented**

`packages/api/src/rate-limit.ts` keeps buckets in an in-memory `Map`. Any
container restart (deploy, crash, OOM) zeroes every quota, including the
LLM/day budget. `GUARDRAILS.md` already calls this out. With a single
container this is acceptable; if we ever scale horizontally or care about
strict daily caps across deploys, move buckets to Postgres or Redis.

**Action:** none.

## Summary

| ID | Severity | Status |
|----|----------|--------|
| L1 | LOW | Fixed (encoded path ids in `ticketmaster.ts`, tests added) |
| L2 | LOW | Fixed (dropped redundant `console.error`) |
| L3 | LOW | Operational; documented above for follow-up |
| L4 | LOW | Accepted; pre-existing documentation in `GUARDRAILS.md` |
