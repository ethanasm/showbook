# Setlist Intelligence — plan review (gaps & holes)

Captured 2026-05-09 after Phase 0 shipped (#145, merged with main).
Severity is "what's most likely to bite," not impact alone. Items are
keyed `SI-NN` so we can reference them in commits / PRs.

---

## Critical — will bite the moment we start Phase 1 (or sooner)

### SI-01 · `TOKEN_KEY` env var isn't plumbed into any environment ✅ RESOLVED

Phase 0 introduced `TOKEN_KEY` (32-byte hex/base64) and the
encrypt/decrypt path in `packages/api/src/crypto.ts`, but nobody set
it in `.env.dev`, `.env.prod`, the Docker compose files, or the
`db:prepare:e2e` env. The first time anyone tries to connect Spotify
in dev/prod (not the unit/integration tests, which set it locally)
`getKey()` throws.

**Resolved** by:
- Documenting `TOKEN_KEY` in `apps/web/.env.example` (canonical
  reference) with generation instructions
  (`openssl rand -hex 32`) and rotation guidance.
- Adding a stub key to `apps/web/.env.local` for native `pnpm dev`.
- Setting a hardcoded dev default in `docker-compose.yml` so
  `pnpm dev:up` works on a clean machine without an `.env.dev`.
- Making `TOKEN_KEY` REQUIRED in `docker-compose.prod.yml` via
  `${TOKEN_KEY:?...}` — boot fails fast if missing from `.env.prod`.
- Setting a stub key in `.github/workflows/ci.yml` for both the
  verify-coverage and Playwright e2e jobs.
- Updating `implementation.md` §11 Q2: rotation is "don't, unless a
  leak is suspected" — rotating invalidates every persisted token.
  `scripts/rotate-token-key.ts` dropped from the plan.

**Operator action required for prod:** generate the key on the
deployment host and append to `.env.prod`:

```bash
echo "TOKEN_KEY=$(openssl rand -hex 32)" >> .env.prod
```

### SI-02 · No `headliner_performer_id` on `shows` ✅ RESOLVED

Multiple phases (Phase 3 `exportPlaylistPredicted({ showId,
performerId })`, Phase 5 `predictedSetlist({ showId })` switching on
`performer.setlistStyle`) assume "the headliner" is a first-class
lookup. Today it's a query against `show_performers WHERE role =
'headliner' ORDER BY sort_order LIMIT 1`.

**Investigation:** `show_performers` has been the model since
migration `0000_marvelous_landau.sql` — never changed. The
asymmetry with `announcements` (which has a denormalized
`headliner_performer_id uuid` + `support_performer_ids uuid[]`) is
deliberate and longstanding: shows need `role` + `characterName` +
`sortOrder` per performer (theatre cast lists need this);
announcements just need to know who's headlining for the
follow/feed pipeline.

**Resolved** by:
- Lifting the existing 3-tier-fallback helper from
  `apps/web/lib/show-accessors.ts` into
  `packages/shared/src/show-accessors.ts` (`pickHeadliner`,
  `getHeadlinerId`, `getHeadliner`, `isProductionShow`,
  `getSupportPerformers`). Lives in `@showbook/shared` rather than
  `@showbook/api` because the latter transitively pulls pg-boss,
  which webpack refuses to bundle for client routes. The web file
  becomes a thin re-export plus the web-only `getHeadlinerImageUrl`
  accessor; `@showbook/api` re-exports for server-side consumers.
- Updating Phase 5 spec to use `getHeadlinerId(show)` in the
  procedure dispatch instead of the imaginary
  `show.headlinerPerformerId` column.
- Updating Phase 1 spec to document that `predictedSetlist({ showId
  })` resolves the headliner server-side via the helper, and that
  production shows (theatre/festival with `productionName`) route
  to the cold empty state because they have no performer-anchored
  predicted setlist.

No migration needed.

### SI-03 · `shows.date` is nullable for `watching` shows ✅ RESOLVED

Phase 1 makes Predicted the default segment for `watching/ticketed`
shows, but the algorithm needs a `targetDate`. What's the prediction
for a multi-night theatre run the user hasn't picked a night for?
Spec is silent.

**Investigation:**
- `shows.date` is nullable; `shows.endDate` is also nullable.
- `concert` + `comedy` rows always have `date` from the `shows.create`
  path (`date: z.string()` is required).
- `theatre` rows can have `date=NULL` when added from a multi-night
  Discover announcement without picking a night
  (`apps/web/.../discover.ts:541-545`,
  `isDatePickingRun = isRun && kind !== 'festival'`).
- `festival` rows **always** have both `date` (= run start) and
  `endDate` (= run end) — `discover.ts:547-550`. The festival is
  modeled as a single experience spanning the run.
- **Edge case the spec missed:** a `concert` residency (Adele/Bruno
  Mars at the Sphere) added via the Discover watchlist also takes
  the date-picking run path → `date=NULL` is possible for concerts
  too, not just theatre.

**Resolved by tightening the setlist-intel spec:**

1. **Setlist intelligence applies only to `kind in ('concert',
   'festival')`** — comedy and theatre have no useful setlist
   semantics (a stand-up set is a curated bit list, not a song
   list; a play has a script, not a rotating setlist). The
   predicted-setlist tab, the corpus-fill triggers, the `songs`
   index, and every related procedure short-circuit to the cold
   empty state for other kinds.
2. **`shows.setlists` jsonb column stays on all kinds.** It's
   harmless on theatre/comedy rows (just unused); enforcing a
   CHECK constraint would require a migration and pay nothing.
3. **`date IS NULL` → cold empty state**, even for concerts. The
   residency-watchlist case (concert + null date) returns the same
   "we'll know more once you pick a night" empty state as a
   theatre run. The user picks a date via the existing
   `shows.setPerformanceDate` mutation; the prediction populates on
   re-fetch.
4. **Festivals: per-headliner prediction.** Each headliner is
   predicted using `date` as the `targetDate` — the corpus weighting
   naturally pulls neighbouring-day setlists in as Tier A. No
   per-performer day-of-festival mapping is needed because
   festivals span at most ~7 days, well within the Tier A ±30-day
   window. The festival-vs-headline filter (§15h, Phase 11) handles
   the "festival sets are a short subset" accuracy issue
   separately.

These rules attach to Phase 1's `predictedSetlist({ showId })`
procedure and the segment-render gate in
`apps/web/app/(app)/shows/[id]/page.tsx`. Phase 1 + Phase 5 specs
updated to call this out.

### SI-04 · Corpus-fill skips performers with no MBID, with no fallback ✅ RESOLVED

Most small artists — Ticketmaster gives us MBIDs for major performers,
MusicBrainz coverage thins fast for indie acts. Their
`predictedSetlist` will permanently return `tourCoverage: 'cold'`. The
plan never names this; the §15h "festival vs headline" filter is the
closest thing.

**Resolved with option A (cold "no_mbid" empty state):** Phase 1
spec extended to emit `corpus.fill.no_mbid` when the performer
lacks an MBID, and `predictedSetlist` returns the `cold` empty
state with `reason: 'no_mbid'` and copy *"We can't pull recent
setlists for [artist] — they're not in the MusicBrainz database
we use as the ID source. We'll try to match on the next nightly
enrichment pass."* The existing `matchOrCreatePerformer`
enrichment back-fills MBIDs over time, so the empty state is
self-healing for any performer who eventually gets a MusicBrainz
record. Name-based search fallback (option B) considered but
deferred — false matches would poison the corpus permanently.

### SI-05 · Phase 3's "hype button hidden for rotating-style" depends on Phase 5 ✅ RESOLVED

Phase 3 spec line 159 says hide for rotating, but
`performer.setlistStyle` doesn't get classified until Phase 5.
Sequence-wise, Phase 3 ships hype buttons that show for Phish too.

**Resolved with option C (ship Phase 3 with the button visible
everywhere; Phase 5 adds the style guard):** Phase 3 spec updated
to drop the `setlistStyle === 'rotating'` hide rule from its
ship-list. The button is visible for every concert/festival in
the Phase 3 → Phase 5 window. Phish fans get a low-relevance
playlist of recent-rotation songs briefly; Phase 5 adds the hide
rule when the classifier lands. The cost is acceptable brief
misleading UX; the win is Phase 3 doesn't block on Phase 5.

### SI-06 · Prediction-cache signature has a race ✅ RESOLVED

`corpus_signature = max(tour_setlists.fetched_at)` is computed
*outside* the SELECT that returns the corpus rows. If the corpus-fill
job inserts a row between those two queries, we cache a stale-marked
prediction that includes the new row.

**Resolved with option C (`REPEATABLE READ` transaction):** Phase
1 spec adds a `loadCorpusForPrediction` helper that wraps both
queries in a `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ` —
MVCC pins both reads to the same snapshot. Both queries are
SELECT-only so isolation adds no contention. The spec includes a
unit-test outline asserting concurrent corpus-fill + prediction
read produces a consistent signature.

---

## Significant — can ship Phase 0 but need a plan

### SI-07 · Tour-ID synthesis collisions are real, not theoretical ✅ RESOLVED

§15r mentions year-salting but punts to Phase 11. Sabrina has reused
tour names across years; Phish has "Summer Tour 2025"/"2026";
Coldplay's "Music of the Spheres" runs three years. The current
`(performerId, lower(tour.name))` synthesis fuses them.

**Resolved with option A (year salt, run-bucketed by 365-day
gap):** Phase 1 spec updated. `tour_id = hash(performerId,
lower(tour.name), runYear)` where `runYear = year of
MIN(performance_date)` across rows matching the same performer +
tour name within a ±365-day window of the new setlist. A gap
larger than 365 days from any existing same-named tour starts a
fresh run with its own salt. Catches the Sabrina/Coldplay
multi-year wraparound case while cleanly separating
clearly-distinct eras with the same name. The §15r option C
sliding-window with ≤90-day gaps deferred — 365 days is the right
v1 tradeoff.

### SI-08 · Mobile connect flow is plausibly broken in practice ✅ RESOLVED (pending manual smoke test)

`WebBrowser.openAuthSessionAsync(authUrl, redirectUri)` resolves on
redirect-to-redirectUri *with the URL*, but the iOS
ASWebAuthenticationSession only intercepts redirects matching its
registered URL scheme. Pointing at our HTTPS web callback works only
if the app supports universal links for that domain — Showbook today
uses `showbook://` for deep links and we didn't verify universal-link
config.

**Resolved with option B (manual smoke test required):** Phase 0
exit criteria #5 added — mobile connect flow must be manually
smoke-tested on both iOS Simulator AND Android emulator before
claiming Phase 0 mobile parity done. If the auth session never
resolves on iOS, the fallback path is to register a
`showbook://spotify-connected` deep-link scheme + redirect to it
from the callback for in-app browser User-Agents. Tracked as a
ship-blocker on Phase 0 — code stays as-is until smoke test
either confirms it works or reveals the fix is needed.

**Owner action item:** run `pnpm mobile:ios`, click Connect Spotify,
walk through OAuth, confirm the sheet closes + connection state
updates. Same on Android emulator. Report back; if either fails,
file follow-up to wire the deep-link fallback.

### SI-09 · `disconnectSpotify`'s cascading-purge story isn't owned phase-by-phase

Phase 0 says "fan-loyalty %, priming counts, playlist URLs cleared on
disconnect." Phases 3/7 add those columns. There's no checklist that
says "when you add column X, extend `disconnectSpotify` to clear it."
Easy to forget per-phase.

### SI-10 · No hard-delete job for revoked rows

Spec says "30 days." Never scheduled. Will pile up.

### SI-11 · Negative-cache TTL on `spotify_track_id = '__none__'`

Phase 3 sets it forever for unmatched titles. Spotify catalog grows;
many "live cuts" land on streaming months later. Need either a TTL or
a periodic re-resolve.

### SI-12 · Library-sync rate-limit math doesn't add up

Phase 7 says nightly per-user rewrite of `/me/tracks` (50/page),
capped at 250 users/run × 4 runs. Power user = 5000 saved tracks =
100 paged calls. 250 × 100 = 25,000 calls/night across users.
Combined with `/me/top/tracks`, recently-played, audio-features fill,
this brushes Spotify's undocumented daily cap. The plan claims
"concurrency 1 per token" which keeps any one user safe; doesn't
address cross-user load.

### SI-13 · No A/B harness, no per-bin model tuning loop

Phase 4's eval gives us Brier + calibration, but `TIER_WEIGHTS` and
`α/β` are hard-coded. The "if calibration fails, tune the constants"
loop is manual. After 6 months of corpus growth, we'll want to
re-tune; no infrastructure for it.

### SI-14 · Phase 4 release gate uses `precision-at-10` for rotating

That's the wrong metric for a gap-chart UX where users care about
"did we surface songs that actually played." That's recall-at-K.
Worth re-thinking before Phase 5 enforces it.

---

## Minor / nice-to-have

### SI-15 · Bayesian smoothing assumes uniform priors across songs

A song that's never appeared gets the same prior as a song that has —
fine for v1, but for jam bands with 800-song catalogues this
implicitly says "all 800 are equally likely a priori," which is
wrong. Could weight by `historical_play_count` (which we already
track for §15c).

### SI-16 · AcousticBrainz fallback covers ≤2022 only

For a 2025 pop tour, ~100% miss rate. The "graceful degradation"
copy doesn't really save Phase 8 if the audio-features endpoint is
denied.

### SI-17 · `firstTimes` semantics may surprise users

§4e computes `MIN(performance_date)` across both attended *and*
corpus appearances. If another fan attended an earlier show and we
have it in the corpus, the user's "first time hearing X live" is
wrong. Needs to be scoped to `MIN(... WHERE show_id = user's show)`
or labeled differently.

### SI-18 · `prediction_feedback` collected but never acted on

Phase 11 ships the thumbs but no closing-the-loop. Either commit to
the loop or drop the feature.

### SI-19 · Spotify ToS requirements not addressed

Branded covers + made-by-Showbook playlists need to honor Spotify's
branding/attribution rules. Worth a 30-min legal sanity-check before
Phase 3 ships.

### SI-20 · Backfill script has no checkpointing

`scripts/backfill-song-index.ts` — spec says "idempotent re-run
produces zero dupes" but for a 100K-row backfill on prod,
partial-state recovery without re-walking every row is desirable.
