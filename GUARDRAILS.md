# Showbook guardrails

This is the canonical list of safety/cost limits enforced by the application
itself — the things that protect a Showbook deployment from accidental or
hostile cost-runaway, abuse, or data exposure. Repository-level controls
(branch protection, secret scanning, Dependabot) are configured in the
GitHub Settings UI and live outside this file.

Every limit listed here is per-user unless noted otherwise. State for
in-process rate limiters lives in a `Map` in
`packages/api/src/rate-limit.ts` — it is reset on server restart and is not
shared across multiple Next.js processes. For a single self-host deployment
this is sufficient; if you scale horizontally you'll want to swap that
helper for a Redis-backed implementation.

---

## Auth and session gates

| Gate | Where | Behaviour |
|------|-------|-----------|
| Sign-in allowlist | `apps/web/lib/auth-allowlist.ts`, wired in `apps/web/auth.config.ts` | If `AUTH_ALLOWED_EMAILS` and `AUTH_ALLOWED_DOMAINS` are both unset → open sign-up. If either is set → sign-in callback denies anyone not on the list. |
| tRPC `protectedProcedure` | `packages/api/src/trpc.ts` | Every mutation/query in the app routers requires a valid session. |
| `/api/test/*` triple gate | `apps/web/app/api/test/_guard.ts` | Refuses to run unless **all three** are true: `NODE_ENV !== 'production'`, `ENABLE_TEST_ROUTES === '1'`, and the active DB name matches `TEST_DATABASE_NAME` (default `showbook_e2e`). |
| iCal feed authorization | `apps/web/app/api/shows/[id]/ical/route.ts`, `apps/web/app/api/announcements/[id]/ical/route.ts` | Show feeds require the requesting user to own the show. Announcement feeds require an active follow on the linked venue or performer. |
| Venue-photo proxy | `apps/web/app/api/venue-photo/[venueId]/route.ts` | Requires a session. Without it Google Places photo enumeration would burn the operator's API quota anonymously. |
| Gmail scan REST | `apps/web/app/api/gmail/scan/route.ts` | Requires a session. |

---

## Per-user rate limits

Implemented via `enforceRateLimit(key, { max, windowMs })` from
`packages/api/src/rate-limit.ts`. Hitting the limit raises a tRPC
`TOO_MANY_REQUESTS` (HTTP 429).

### Per-minute (cheap searches)

| Procedure / route | Limit | Source |
|-------------------|-------|--------|
| `venues.search` | 60 / min | `packages/api/src/routers/venues.ts` |
| `performers.search` | 60 / min | `packages/api/src/routers/performers.ts` |
| `performers.searchExternal` | 30 / min | `packages/api/src/routers/performers.ts` |
| `enrichment.searchTM` | 60 / min | `packages/api/src/routers/enrichment.ts` |
| `enrichment.fetchTMEventByUrl` | 60 / min | same |
| `enrichment.fetchSetlist` | 30 / min | same |
| `enrichment.searchPlaces` | 30 / min | same |
| `enrichment.placeDetails` | 30 / min | same |

### Per-hour (bulk Gmail scans)

| Procedure / route | Limit | Env override |
|-------------------|-------|--------------|
| `/api/gmail/scan` (REST) | 5 / hr | hard-coded |
| `enrichment.bulkScanGmail` (tRPC) | 5 / hr | `SHOWBOOK_BULK_SCAN_PER_HOUR` |
| `enrichment.gmailCollectMessages` | 5 / hr | same env, shared bucket (`bulk-scan:<userId>`) |

### Per-day (LLM calls)

A single per-user budget shared across every user-initiated Groq call. Each
of the procedures below increments the same `llm:<userId>` bucket before
invoking the model.

| Procedure | Source |
|-----------|--------|
| `enrichment.parseChat` (chat-mode Add) | `packages/api/src/routers/enrichment.ts` |
| `enrichment.extractCast` (playbill vision) | same |
| `enrichment.extractFromPdf` | same |
| `enrichment.scanGmailForShow` | same |
| `enrichment.bulkScanGmail` | same |
| `enrichment.gmailProcessBatch` | same |

| Limit | Env override |
|-------|--------------|
| 50 / day | `SHOWBOOK_LLM_CALLS_PER_DAY` |

---

## Per-call size caps

These bound the cost of a single request, independent of how often the user
calls.

| Cap | Default | Env override | Source |
|-----|---------|--------------|--------|
| Gmail messages collected per `/api/gmail/scan` | 200 | hard-coded `MAX_MESSAGES_PER_SCAN` | `apps/web/app/api/gmail/scan/route.ts` |
| Gmail messages collected per `bulkScanGmail` / `gmailCollectMessages` | 200 | `SHOWBOOK_BULK_SCAN_MESSAGE_CAP` | `packages/api/src/llm-quota.ts` |
| `gmailProcessBatch` `messageIds[]` length | 50 | hard-coded zod `.max(50)` | `packages/api/src/routers/enrichment.ts` |
| Email body fed to Groq | 8 000 chars | hard-coded `.slice(0, 8000)` | `packages/api/src/groq.ts` |
| PDF text fed to Groq | 8 000 chars | hard-coded | same |

---

## Media storage quotas

All defaults are env-tunable (see `packages/api/src/media-config.ts`).
Enforced server-side at the `createUploadIntent` mutation
(`packages/api/src/routers/media.ts`).

| Quota | Default | Env override |
|-------|---------|--------------|
| Global (all users combined) | 8 GiB | `MEDIA_GLOBAL_QUOTA_BYTES` |
| Per user | 1 GiB | `MEDIA_USER_QUOTA_BYTES` |
| Per show | 300 MiB | `MEDIA_SHOW_QUOTA_BYTES` |
| Photo source upload | 20 MiB | `MEDIA_PHOTO_MAX_SOURCE_BYTES` |
| Photo stored (post-encode) | 5 MiB | `MEDIA_PHOTO_MAX_STORED_BYTES` |
| Video stored | 150 MiB | `MEDIA_VIDEO_MAX_BYTES` |
| Photos per show | 30 | `MEDIA_SHOW_MAX_PHOTOS` |
| Videos per show | 2 | `MEDIA_SHOW_MAX_VIDEOS` |
| Allowed image MIME types | `image/jpeg,png,webp,heic,heif` | `MEDIA_ALLOWED_IMAGE_TYPES` |
| Allowed video MIME types | `video/mp4` | `MEDIA_ALLOWED_VIDEO_TYPES` |
| Local upload route enabled | only when `MEDIA_STORAGE_MODE=local` | hard-coded — production R2 mode uses presigned URLs |

---

## Output validation

LLM responses are not trusted blindly. Every Groq call funnels through
`traceLLM` in `packages/api/src/groq.ts`, and the JSON output is validated
against a zod schema (`parsedShowInputSchema`,
`extractedTicketInfoSchema`, `castResponseSchema`) before being returned to
callers. A response that doesn't match the schema is either dropped (where
the caller can tolerate `null`) or surfaced as a thrown error — it never
flows into the database.

The venue-photo proxy additionally checks that upstream returns a
`content-type: image/*` header before forwarding bytes, and stamps
`X-Content-Type-Options: nosniff` on the response.

---

## Upstream-protective limits

These don't protect Showbook directly — they protect the upstream APIs from
us, which keeps the operator's quota healthy.

| Limit | Source |
|-------|--------|
| Ticketmaster: 5 req/sec across all users (200 ms `MIN_INTERVAL_MS`, single in-process token) | `packages/api/src/ticketmaster.ts` |
| Ticketmaster: automatic backoff + retry on HTTP 429 | same |
| Groq email-extraction: up to 3 retries with `Retry-After` honoured | `packages/api/src/groq.ts` (`extractShowFromEmail`) |

---

## Repository-level controls (configured in GitHub Settings)

These aren't enforced by the code in this repo — they're toggled in the
GitHub UI by the repo owner. Listed here so the full picture lives in one
place.

- Branch protection on `main`: PR required, status checks required, no
  force-push, no deletion.
- Secret scanning + push protection.
- Dependabot alerts (version-update config in `.github/dependabot.yml`).
- CodeQL default setup for JS/TS.
- Workflow permissions defaulted to read-only.
- "Allow GitHub Actions to create and approve pull requests" disabled.

---

## Tests

Coverage for the cost-bearing guardrails lives in:

- `packages/api/src/__tests__/llm-quota.test.ts` — defaults, env overrides, throw shape, per-user separation for `enforceLLMQuota` and `enforceBulkScanRateLimit`.
- `packages/api/src/__tests__/enrichment-router-quotas.test.ts` — every rate-limited tRPC procedure on the enrichment router, asserting `TOO_MANY_REQUESTS` once the bucket is exhausted, plus the zod `messageIds.max(50)` cap on `gmailProcessBatch`.
- `apps/web/lib/__tests__/auth-allowlist.test.ts` — sign-in allowlist matching (open mode, exact email, domain match, case-insensitivity).

Run the whole unit suite with `pnpm test:unit`; for just the new
quota tests, `pnpm --filter @showbook/api exec node --import tsx --test src/__tests__/llm-quota.test.ts`.
