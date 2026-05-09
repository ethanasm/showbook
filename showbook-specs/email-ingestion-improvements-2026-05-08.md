# Email ingestion — improvement menu (2026-05-08)

## Context

Showbook's email ingestion is user-initiated: a user connects Gmail via
OAuth (`/api/gmail`), then `POST /api/gmail/scan` runs four
precision-tuned Gmail search queries, fetches up to 300 message bodies,
and pipes each through `extractShowFromEmail` (Groq `gpt-oss-120b`,
`reasoning_effort: 'low'`, JSON mode). Tickets land in the browser via
SSE; the user picks which to save as Shows. There is no inbound webhook,
no DB-backed dedup of ingested messages, and no attachment handling.

Pain points this menu addresses:

- **Recall gaps**: PDF-only confirmations, forwarded emails (forwarder
  becomes the `From:`), indie/regional venues, multi-**event** emails
  (one Ticketmaster cart containing tickets to two different concerts;
  a season-subscription email listing five distinct theatre dates;
  a venue digest covering multiple upcoming shows — today these
  collapse to a single row even though they're distinct shows), and
  the 8000-char body truncation cutting off info-bearing footers.
- **Precision/cost gaps**: every matched email burns a Groq call even
  when a 1¢ regex would reject it; only `low` confidence is filtered
  (`medium` is treated as `high`); no few-shot examples; same email
  re-extracted on every scan.

Files that anchor the system today:

- `apps/web/app/api/gmail/scan/route.ts` — orchestrator (queries → fetch
  → LLM → merge → SSE).
- `packages/api/src/gmail.ts:166-235` — query builders + sender
  allowlist (`KNOWN_TICKET_SENDERS`, `KNOWN_TICKET_DOMAINS`,
  `BULK_EXCLUSIONS`).
- `packages/api/src/gmail.ts:283-317` — MIME walker (`text/plain` +
  `text/html` only; ignores `application/pdf`).
- `packages/api/src/groq.ts:178-267` — `extractShowFromEmail` prompt +
  Zod schema + 429 retry.
- `packages/api/src/groq.ts:325+` — `extractShowFromPdfText` (already
  exists, originally only wired into the playbill-PDF tRPC procedure;
  the email-scan path now reuses it via R1).
- `packages/db/schema/shows.ts:37-77` — Show row; `sourceRefs` jsonb is
  the natural place to stash `gmailMessageId` for cross-scan dedup.

---

## Recall improvements (catch more)

### R1. Wire PDF attachments into the scan path  *(highest leverage — shipping)*

Many AXS, Telecharge, TodayTix, regional box-office, and forwarded
confirmations carry the only useful detail in a PDF. We already have
`extractShowFromPdfText` in `packages/api/src/groq.ts:325`; the MIME
walker in `extractBody` (`gmail.ts:283`) just ignores
`application/pdf`. Plan: extend `getMessageBody` to also collect
attachment refs `{ attachmentId, filename, mimeType, size }`, add
`getAttachment(accessToken, messageId, attachmentId)` (Gmail
`messages/{id}/attachments/{attId}` endpoint), then in the scan
orchestrator: if body extraction returns null/low confidence **and** a
PDF attachment exists, fall back to PDF extract via `pdf-parse`. Cap at
1 PDF per message and ~200 KB to bound Groq cost.

### R2. Detect & re-anchor forwarded emails

Forwarded confirmations make `From:` the forwarder, busting both
`KNOWN_TICKET_SENDERS` and the domain query. Add a tiny
`detectForwardedHeader(body)` helper that finds the first
`From:`/`Forwarded message` block, parses the original sender, and
passes that as `emailFrom` to `extractShowFromEmail` (and uses it in the
sender-allowlist gate from R5). Also include `Fwd:` subject prefix in
the broad query.

### R3. Allow multi-**event** emails in the schema

Scope clarification: this is **not** about multi-day festival passes
or 4-packs to one show — those are correctly one row each. It's about
emails that confirm tickets to **multiple distinct shows** in a single
message:

- A Ticketmaster cart containing tickets to two unrelated concerts.
- A theatre season-subscription email listing 5 distinct dates.
- A venue/club digest like "your upcoming tickets" covering several
  separate events.

`extractedTicketInfoSchema` (`groq.ts:23-35`) emits a single ticket,
so today these collapse to one row (usually the first event the LLM
latches onto). Change the prompt + schema to `{ events: EventInfo[] }`
where each `EventInfo` is one (artist|production, date, venue) tuple.
Festival weekends and 4-packs stay as **one** event with `quantity: N`;
the prompt must explicitly call out that distinction with examples.
Single-event payload stays as `{ events: [one] }` so downstream merge
logic is unchanged.

### R4. Smarter body truncation

`extractShowFromEmail` slices `body.slice(0, 8000)` (`groq.ts:218`).
Long Ticketmaster HTML emails frequently bury date/venue past 8 KB
behind boilerplate. Replace with a sliding window: keep the first 4 KB,
plus 4 KB from the highest-scoring window around regex matches for
date/venue/section/qty keywords. Fully drops the truncation regression
without raising token cap.

### R5. Add a fifth "long tail" Gmail query, gated by a sender allowlist

Today Tier 4 covers six domains. Add a query that sweeps anything with
`subject:(your tickets OR your order OR you're going to OR get ready
for)` + the existing `BULK_EXCLUSIONS`, then **only** keep messages
whose sender (or, after R2, original sender) matches a heuristic:
domain looks like a venue/promoter (`tickets@`, `boxoffice@`, `noreply@
*.com` with venue terms in body). This is the "indie venue" net.

---

## Precision improvements (vet more accurately)

### P1. Pre-LLM heuristic gate  *(biggest cost saver — shipping)*

Right now every one of up to 300 messages costs a Groq call. Add a
deterministic scorer (regex hits for date patterns, qty/seat/section,
venue keywords, ticket-ID patterns, $-amounts) that returns a 0-100
score. Skip Groq entirely for `score < 20`. Expect ~30-50% LLM call
reduction with negligible recall loss; protects the 5/hr rate limit
and the 50/day LLM quota.

### P2. Few-shot examples in the extraction prompt

The system prompt at `groq.ts:188-214` has rules but no exemplars. Add
2 positive (one Ticketmaster concert, one Telecharge theatre) and 2
negative (museum admission, parking pass) examples in the system
message. Smaller models on `reasoning_effort: 'low'` benefit
disproportionately from this.

### P3. Three-tier confidence handling

`groq.ts:265` currently treats `medium === high` for surfacing. Surface
medium-confidence rows in a separate "Review" bucket on the picker UI
so users explicitly confirm them. Code change is small (UI grouping +
SSE payload tweak) and improves trust without losing recall.

### P4. Cross-scan dedup via `sourceRefs`  *(shipping)*

On `shows.create`, persist `{ gmailMessageId, scanAt }` into
`shows.sourceRefs` (jsonb already exists). On the next scan, drop any
message whose ID is already referenced by a Show owned by the user
**before** the LLM call. Cuts repeat-scan cost to near zero and
prevents the "I scanned twice and now I have two pending suggestions"
foot-gun.

### P5. Lightweight feedback loop signal

When the user dismisses an extracted suggestion vs. saves it, log a
structured event (`gmail.scan.suggestion.{kept,discarded}`) keyed by
`gmailMessageId` + sender domain. Doesn't change behaviour but creates
the dataset we need to tune the prompt and the allowlist over time.

---

## Suggested ordering (recall + precision balanced)

| # | Item | Effort | Impact | Risk | Status |
|---|------|--------|--------|------|--------|
| 1 | **R1** PDF attachments | M | High recall | Low — code path exists | **shipping** |
| 2 | **P1** Pre-LLM heuristic gate | S | High cost↓, neutral recall | Low — easy to tune | **shipping** |
| 3 | **P4** Cross-scan dedup via sourceRefs | S | High cost↓ + UX | Low | **shipping** |
| 4 | **R2** Forwarded email re-anchor | S | Medium recall | Low | future |
| 5 | **P2** Few-shot examples | S | Medium precision | Low | future |
| 6 | **R3** Multi-event schema | M | Medium recall (rare emails) | Medium — schema change, festival-fanout regression risk | future |
| 7 | **R4** Smarter truncation | S | Low-Medium recall | Low | future |
| 8 | **P3** Three-tier confidence UI | S | UX/precision | Low | future |
| 9 | **R5** Long-tail query + allowlist | M | Medium recall, some noise | Medium | future |
| 10 | **P5** Feedback signal | S | Compounding | Low | future |

R1 + P1 + P4 ship together — more tickets caught, fewer Groq dollars,
no schema migration.

## Rollout safety — in-code feature flag enum (no env vars)

A single flag registry lives at
`packages/shared/src/feature-flags.ts`. Only **medium/high risk**
items get a flag; low-risk items (prompt-only edits, additive logging,
copy/UI-only changes) ship without one.

Risk classification:

- **High risk** — schema/contract changes hard to revert without data
  fixup: **R3** (multi-event schema).
- **Medium risk** — alters extraction outcomes or which messages reach
  the LLM: **R1** (PDFs), **R2** (forwarded re-anchor), **R4**
  (windowed truncation), **R5** (long-tail query), **P1** (heuristic
  gate), **P4** (cross-scan dedup).
- **Low risk — no flag** — purely additive prompt/UX/logging: **P2**
  (few-shot prompt), **P3** (Review tier UI grouping), **P5**
  (feedback log events).

Flagged items land with `state: 'OFF'` and a code path that no-ops to
current behaviour when off — proves zero regression by construction.
Flip to `'ON'` is a one-line PR + redeploy. After a clean week in
Axiom, the flag and its OFF branch are deleted in a cleanup PR.

## Verification

- `pnpm verify` (build + lint + unit) green.
- `pnpm verify:coverage` green — 80% gate on web scope.
- `pnpm test:integration` green.
- Pre-existing `gmail.test.ts` and `groq.test.ts` suites must pass
  unmodified before any new test is added — proves no contract
  regression.

Per-item unit + integration coverage and observability events for
R1/P1/P4 are described inline in the code (see `email-heuristic.ts`,
`gmail.ts` PDF helpers, and `apps/web/app/api/gmail/scan/route.ts`).

## Files that change (per shipped item)

- **R1**: `packages/api/src/gmail.ts` (+`getAttachment`, MIME walker
  collects PDFs); `apps/web/app/api/gmail/scan/route.ts` (PDF
  fallback); reuses `packages/api/src/groq.ts` `extractShowFromPdfText`.
- **P1**: new `packages/api/src/email-heuristic.ts`; called from
  `apps/web/app/api/gmail/scan/route.ts` before `extractShowFromEmail`.
- **P4**: `apps/web/app/api/gmail/scan/route.ts` (pre-LLM lookup);
  `apps/web/components/shows-list/ShowsListView.tsx` (write
  `gmailMessageId` into `sourceRefs` on create).

Future items (R2/R3/R4/R5/P2/P3/P5) keep the file map from the original
plan unchanged.
