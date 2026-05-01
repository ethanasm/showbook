# Showbook — AI Opportunities

Research notes mapping where AI (Groq today; possibly other providers later)
could extend Showbook beyond its current extraction-focused use. Inventory of
what exists, design principles drawn from current code, and a prioritized
backlog of new opportunities with concrete extension points.

Status: Draft — research only. Nothing in this file is a committed
decision. Promote individual items to `decisions.md` (with a `D##` number)
once we agree to ship them.

---

## 1. Current AI Surface

All LLM calls go through `@showbook/observability` (`traceLLM`, `withTrace`)
and the wrapper in `packages/api/src/groq.ts` (or
`packages/scrapers/src/llm.ts` for the scraper). Two models are in use:
`llama-3.3-70b-versatile` for text and
`meta-llama/llama-4-scout-17b-16e-instruct` for vision. Per-user quota is
enforced via `packages/api/src/llm-quota.ts`
(`SHOWBOOK_LLM_CALLS_PER_DAY`, defaults to 50).

| Function | Where | Trace | Mode | Purpose |
|----------|-------|-------|------|---------|
| `parseShowInput` | `packages/api/src/groq.ts:108` | `groq.parseShowInput` | User | Chat-mode Add → `{headliner, venue_hint, date_hint, seat_hint, kind_hint}` |
| `extractShowFromEmail` | `packages/api/src/groq.ts:161` | `groq.extractShowFromEmail` | User | Gmail confirmation → ticket fields + confidence |
| `validateAndDedupTickets` | `packages/api/src/groq.ts:255` | `groq.validateAndDedupTickets` | Background | Post-Gmail dedup pass |
| `extractShowFromPdfText` | `packages/api/src/groq.ts:306` | `groq.extractShowFromPdfText` | User | PDF ticket → ticket fields |
| `extractCast` (vision) | `packages/api/src/groq.ts:377` | `groq.extractCast` | User | Playbill image → cast list |
| `extractEventsFromPage` | `packages/scrapers/src/llm.ts:83` | `scrapers.extractEventsFromPage` | Background | Venue website → events (with `sourceQuote` anti-hallucination) |

Everything currently in production is **structured extraction**. Nothing
yet uses an LLM for **generation, ranking, recommendation, summarization,
or natural-language interaction with a user's existing data.** That is
where the opportunities below sit.

---

## 2. Design Principles (carry over from current code)

These constraints come from how the existing AI features are built. New
work should preserve them so it benefits from the same observability,
cost control, and safety properties.

1. **Schema validation at every boundary.** Every Groq response is parsed
   via Zod (`parsedShowInputSchema`, `extractedTicketInfoSchema`,
   `castResponseSchema`). New procedures must do the same — no raw
   `JSON.parse` flowing into the DB.
2. **Anti-hallucination guards on extracted facts.** The scraper requires
   `sourceQuote` to be a verbatim substring of the page. Any new
   extraction over user data should similarly cite or constrain its
   output.
3. **`traceLLM` + `withTrace` wrapping is mandatory.** Don't construct a
   raw Groq client; extend `packages/api/src/groq.ts` (or the scrapers
   helper) so every call is traced and logged. CLAUDE.md is explicit
   about this.
4. **Per-user quota.** Any new user-initiated LLM procedure must call
   `consumeLLMCall` (see existing tRPC procedures in
   `packages/api/src/routers/enrichment.ts`). Background jobs operate
   under a shared budget — track tokens via `groqUsage` and store on
   the job's run row (cf. `groqTokensUsed` on `venue_scrape_runs`).
5. **Graceful degradation.** All current LLM helpers return `null` /
   throw rather than producing partial garbage on failure. The app
   keeps working without `GROQ_API_KEY` set (tests rely on this).
6. **Don't log secrets, PII, or raw image bytes.** `extractCast` already
   hides image bytes from Langfuse — replicate that pattern for new
   vision use.

---

## 3. Opportunities, by Tier

Each entry: what it does → why it's worth doing → where it plugs in →
risks / open questions → rough effort.

### Tier 1 — High value, low risk, fits existing infra

#### O1. Show recap on transition to `past`
**What.** When `shows-nightly` transitions a `ticketed` show to `past`,
generate a one-line recap from its setlist (if present), venue,
headliner, support, and the user's optional `notes`. Store on a new
`shows.recap_text` column. Surface in the Shows list, show-detail page,
and "On this day" digest section (O3).

**Why.** Showbook's value compounds with history; a tap-friendly
sentence ("Radiohead opened with *Daydreaming*; second-row at MSG.")
makes the archive scannable years later. Pure backend job — no UI
flow to design.

**Where.**
- New helper in `packages/api/src/groq.ts`:
  `generateShowRecap(input: { headliner, venue, kind, setlist?, support?, notes? }) → string`.
- Schedule from the existing `shows-nightly` job (after the
  `ticketed → past` transition, before the setlist enrichment retry).
- Migration: `recap_text text null` on `shows`. Re-runnable; backfill
  past shows in a one-shot script with `--limit` flag (mirrors
  `backfill-performer-images`).

**Risks.** Hallucinated setlist details if `notes` are vague — mitigate
by passing only verifiable structured fields, never inviting the model
to invent songs. Use temperature 0.2.

**Effort.** ~1 day. New prompt + Zod (just `{ recap: string }`),
one job hook, one column, one display surface.

#### O2. Personalized digest preamble
**What.** The current `DailyDigest` template at `packages/emails/src/`
renders static lists. Add a 1–2 sentence opener at the top of the
email: *"3 new announcements at venues you follow, including
**Phoebe Bridgers at the Greek**. Your next ticketed show is in
4 days."* Generated per user from the data already assembled for the
digest.

**Why.** Email open rates rise when subject lines / preheaders are
specific. Today's digest is pleasant but generic. Cost is one LLM
call per recipient per day — well within Groq's free tier.

**Where.**
- Extend `runDailyDigest` (the job referenced in CLAUDE.md): build the
  existing payload, then call a new `generateDigestPreamble({
  newAnnouncements, upcomingShows, todayShows })` helper before
  rendering.
- Use the preamble as both the email preheader and a leading
  `<Text>` block in the React Email template.
- Skip the LLM call if the payload is empty (no new announcements
  *and* no upcoming) — render a stock string.

**Risks.** Tone drift / over-promising. Constrain with a strict
prompt and a max-length Zod schema (e.g. `z.string().max(240)`).

**Effort.** ~0.5 day.

#### O3. "On this day" digest section
**What.** New section in the daily digest: *"On this day in 2024 you
saw The Strokes at Forest Hills."* Sourced from `shows` where
`extract(month from date) = today.month AND extract(day from date) =
today.day`. The recap text from O1 is the body line; no LLM call
needed at digest time once recaps exist.

**Why.** Reinforces the journaling feel. Anchors the email to the
user's history, not just upcoming events. Free once O1 is shipped —
this is just a SQL query and a new template block.

**Where.** Same `runDailyDigest` job + template. No new LLM call.

**Effort.** ~2 hours after O1 lands.

#### O4. Year-in-review email (annual job)
**What.** Once a year (last week of December) send a special digest:
total shows, top 3 venues by visit count, top performer, "longest
streak", cumulative miles travelled (we already have venue lat/lng),
and an LLM-generated narrative paragraph tying it together.

**Why.** Spotify Wrapped-style moment is a high-engagement vehicle
for a personal tracker like this. All data is already in the DB;
LLM just writes the connective copy.

**Where.**
- New `runYearInReview` pg-boss job, scheduled via the existing
  `pgboss.schedule` pattern (cf. CLAUDE.md "scheduled backfill
  jobs"). Run on Dec 28 at 9:00 ET.
- New React Email template `YearInReview.tsx` next to
  `DailyDigest.tsx`.
- LLM helper `generateYearInReviewNarrative(stats)` returning a
  capped paragraph + 3-bullet "highlights" array.

**Risks.** First run is in December; until then we can preview with
`pnpm email:smoke` against a fixture user's prior-year data. Add a
`SHOWBOOK_YIR_DRY_RUN=1` env flag for testing.

**Effort.** ~2 days (template design + job + prompt iteration).

### Tier 2 — Moderate effort, real product value

#### O5. Theatre synopsis enrichment
**What.** When a show's `kind = theatre` and we have a
`production_name` (e.g. *"Hadestown"*), generate a 2–3 sentence plot
synopsis stored on a new `productions` table (or
`shows.synopsis_text`). Useful years later when the user revisits an
old theatre entry.

**Why.** Setlists serve concerts as a memory anchor; theatre has no
equivalent. Synopsis fills that gap. One call per unique production
across all users (cache aggressively — *Hadestown* needs one row).

**Where.**
- New `productions` table keyed on
  `(lower(production_name), kind = 'theatre')`. Stores `synopsis`,
  `created_at`, `source = 'llm'`.
- Job: `backfill-theatre-synopses`, daily at 06:00 ET. Picks
  productions referenced by ≥1 show without an entry.
- LLM helper with a *grounded* prompt: include the show year and
  any cast we've extracted so the model targets the right production
  (there are multiple shows called *"Company"*, etc.).

**Risks.** Hallucinated plot details for obscure regional productions.
Mitigation: include a `confidence` field; only display if `high`. For
`medium`/`low`, store but don't surface — or fall back to a
"Synopsis not available" UI string.

**Effort.** ~2 days.

#### O6. Email subject pre-classifier (cost optimization)
**What.** Before `bulkScanGmail` sends a full email body to
`extractShowFromEmail` (~8000 chars), run a cheap subject-only
classifier. Skip messages clearly not ticket confirmations. Either a
small/quick LLM (`llama-3.1-8b-instant` on Groq) or a rule-based
heuristic with a thin LLM tiebreaker.

**Why.** `bulkScanGmail` is the heaviest LLM consumer per user
session. Cutting the obvious negatives could halve quota burn and
double end-to-end speed. We already track `tokensUsed` for scrapers —
add the same metric here so we can measure the win.

**Where.**
- New helper `classifyEmailSubject(subject, from) → 'likely' |
  'unlikely' | 'unknown'` in `packages/api/src/groq.ts`.
- Wire into `bulkScanGmail` at
  `packages/api/src/routers/enrichment.ts` ~line 354: short-circuit
  `unlikely` before the body fetch + extraction.
- Track skipped count + saved-tokens estimate on the bulk-scan run
  log.

**Risks.** False negatives skip real tickets. Start with a very
conservative `unlikely` threshold (e.g. only obvious shipping /
newsletter patterns). Keep an audit log so we can measure.

**Effort.** ~1 day, plus tuning.

#### O7. Tour name detection & grouping
**What.** Many TM event names embed a tour name ("*Olivia Rodrigo —
GUTS World Tour*"). Today we store the raw event name. An LLM pass
over a performer's announcements (or shows) could extract the tour
name and group all dates under one Tour entity. UI surfaces a "Shows
on this tour" link from the show-detail page.

**Why.** Aligns with the journaling vision: *"the night I saw the
Eras Tour"* is more meaningful than *"the Taylor Swift show on
2023-05-13."* Also enables future "tour completionist" badges /
stats.

**Where.**
- New `tours` table: `id, performer_id, name, started_at, ended_at,
  source`.
- Job: `extract-tours`, runs after each `discover-ingest` Phase 1
  completes, scoped to performers whose announcement set changed.
- LLM helper `extractTourName({ performerName, eventNames[] }) → {
  tour: string | null, confidence }`. Only persist if confidence
  is high and at least 3 events share the inferred name.
- Backfill once over existing shows.

**Risks.** Performer name pollution (model invents a tour for a
one-off concert). Require ≥3 matching events as a real-world
sanity check.

**Effort.** ~3 days incl. UI link + table.

#### O8. Performer recommendations
**What.** "You follow Big Thief and The National. You might like
Bon Iver." Surfaced in the empty state of `/discover` Followed
Artists tab and as a periodic "Suggested artists" digest section.

**Why.** Today, Discover is fully reactive — it shows you what's
happening at things you already follow. Recommendations turn it into
a discovery surface in the literal sense.

**Where.** Two viable shapes:
- **Pure-LLM (cheap, ship-first).** Job: `generate-artist-recs`,
  weekly per user. Build prompt from `{ followedPerformers,
  pastShowsByKind, topVenues }` and ask for 5 candidates with a
  one-line reason each. Validate each candidate exists in TM via
  `searchExternal` before persisting.
- **Embeddings (deeper, pricier).** Compute embeddings for every
  Performer (Groq does not currently expose embeddings → use a
  lightweight provider, e.g. `text-embedding-3-small` from OpenAI
  at $0.02/1M tokens, behind a `packages/api/src/embeddings.ts`
  wrapper that mirrors the `groq.ts` pattern). Recommend by cosine
  similarity over the user's followed set.

**Recommendation:** ship the pure-LLM version first; revisit
embeddings only if quality is poor.

**Risks.** Recommending an artist the user has already seen 10
times. Filter against `user_performer_follows` and the user's
existing show history before display.

**Effort.** ~3 days for the LLM version; +1 week if we add
embeddings.

#### O9. Conversational chat-mode Add (multi-turn)
**What.** The `parseChat` endpoint exists but the UI is stubbed
(`apps/web/app/(app)/add/page.tsx:26` defines `Mode = "Form" |
"Chat"`). Build the Chat mode UI as a real conversation: user types
*"I saw Radiohead last night"*, model responds *"Got it — which
venue?"*, etc., until enough fields are gathered, then drop into the
existing enrichment pipeline.

**Why.** Single-shot extraction works but requires the user to
remember to put everything in one message. A conversational flow is
faster to type and more forgiving on phones. Aligns with D3
("chat-mode Add → LLM parsing, same pipeline") — this is the
natural UX evolution of an already-decided feature.

**Where.**
- New tRPC procedure `enrichment.chatTurn({ history, userMessage })
  → { reply, parsedSoFar, complete }`.
- Wrap `parseShowInput` to accept partial state; system prompt asks
  for the next missing field as a question.
- UI: a thread view replacing the form on the Chat tab. Reuse
  existing post-parse enrichment confirmation step.

**Risks.** Model wanders into open-ended chatter. Constrain via a
strict system prompt and a `complete: boolean` schema field that
tells the UI when to switch to enrichment.

**Effort.** ~3 days incl. UI.

### Tier 3 — Speculative or specialized

#### O10. Vision-based setlist OCR
**What.** When setlist.fm has no record (about 30% of the long tail),
let the user upload a photo of a handwritten setlist, the stage
screen, or a fan post. Vision LLM extracts song titles in order.

**Why.** Closes the data gap for shows where setlist.fm gives up.
Already have the vision plumbing (`extractCast`).

**Risks.** Setlists in photos are often partial / out of order /
illegible. Frame the result as a *"draft from photo"* the user
edits, not authoritative.

**Effort.** ~2 days.

#### O11. Discover natural-language filter
**What.** A free-text filter on `/discover`: *"only metal shows
under $80"*, *"comedy in Brooklyn"*. LLM converts the prompt into a
structured filter (kind, region, max price) applied server-side.

**Why.** Power-user feature. Differentiates from Bandsintown-style
fixed filters.

**Risks.** Latency budget — must feel instant. Cache the
last-prompt → filter mapping per session. Probably not worth it
until we have more volume on Discover.

**Effort.** ~2 days.

#### O12. Venue scraper prompt auto-tuning
**What.** When `extractEventsFromPage` returns few/zero events for a
venue that visibly has events, run a second pass with a variant
prompt (e.g. *"this site uses 'performance' instead of 'show'"*).
Track per-venue success rate in `venue_scrape_runs`.

**Why.** The scraper is the most prompt-sensitive surface. Currently
the prompt is one-size-fits-all.

**Risks.** Cost doubles for every retry. Only retry if the first
pass returned 0 events on a venue that historically has > 0.

**Effort.** ~1 day for retry logic; ongoing tuning.

#### O13. Performer / venue name normalization
**What.** Use an LLM as a tiebreaker in `matchOrCreatePerformer` and
`matchOrCreateVenue` when fuzzy matching produces multiple
candidates. Today the user is shown the candidates (D4); an LLM
could rank them by likelihood given the rest of the show context
(date, venue, support acts).

**Why.** Reduces candidate-picker friction. Fits cleanly into
existing entry points.

**Risks.** Wrong merges propagate forever. Keep the user-confirmation
UI (D4) and only use the LLM to pre-sort, never auto-pick.

**Effort.** ~1 day.

#### O14. Show photo alt-text generation
**What.** When users upload show photos to R2 (`media` router), run
a vision LLM pass to generate alt-text + searchable tags ("crowd
silhouette under purple stage lights"). Stored on the photo row.

**Why.** Accessibility + future search-by-photo-content. Free for
us — Groq vision is cheap.

**Risks.** Privacy — photos may contain identifiable people. Only
process photos the user has explicitly uploaded to their own show.

**Effort.** ~1 day.

---

## 4. Cross-Cutting Concerns

### Quota and cost
The current quota model (`SHOWBOOK_LLM_CALLS_PER_DAY=50` per user) was
sized around the user-initiated extraction calls (Gmail scan, PDF
upload, playbill). Adding **background** generation calls (recaps,
synopses, recommendations, year-in-review) doesn't consume the
per-user quota — they run under shared infra budget. Add a
`SHOWBOOK_LLM_BACKGROUND_TOKENS_PER_DAY` envelope (default
generous, e.g. 10M tokens/day) tracked centrally so a runaway job
doesn't exhaust the API key.

### Provider lock-in
Every helper goes through `packages/api/src/groq.ts`. If we ever
need a non-Groq model (e.g. embeddings via OpenAI for O8, audio via
a future provider for O10), follow the same pattern: a
`packages/api/src/embeddings.ts` (or `audio.ts`) with the same
trace-then-call-then-validate shape, never importing the SDK
directly elsewhere.

### Observability events
New events to add to the curated list in CLAUDE.md as features land:
- `recap.generate.{ok,failed,skipped}` (O1)
- `digest.preamble.{ok,failed}` (O2)
- `productions.synopsis.{ok,failed}` (O5)
- `gmail.classify.{likely,unlikely,unknown}` (O6)
- `tours.detect.{created,updated,no_match}` (O7)
- `recs.generate.{ok,empty}` (O8)

### Testing
The current LLM testing pattern (mock the Groq client via
`__test.setClient`, assert on parsed output) works well. Apply the
same style to all new helpers. Reserve E2E tests with a real key
(à la `playbill-cast-extract.spec.ts`) for the highest-value
visual/vision flows only.

### Safety
The system has no public-facing user-generated text surface today —
shows are personal. Generated text (recaps, synopses, narratives)
inherits this scoping, which sidesteps most LLM-content safety
concerns. If a future feature shares generated text across users
(social, public profiles), revisit and add a moderation pass.

---

## 5. Recommendation: First Three to Ship

If we pick three to do next, in order:

1. **O1 Show recap on transition to `past`** — smallest, most
   self-contained, sets up the data for O3 (and later O4, O5).
   Visible the next morning to any user who attended a show
   yesterday. Builds the "background-generation under shared
   quota" pattern.
2. **O2 Personalized digest preamble** — one-line code change to
   the most-read surface in the app. Immediate engagement signal
   we can measure (open rate, CTR).
3. **O6 Gmail subject pre-classifier** — pure cost win on the
   heaviest LLM path. Lets us afford the rest of this list
   without raising quotas.

Everything past those three should be re-evaluated against actual
usage data once the first three are live for a couple of weeks.
