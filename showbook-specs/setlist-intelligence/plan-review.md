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

### SI-09 · Disconnect doesn't actually clean up the user's Spotify-derived stats

**What "disconnect Spotify" is.** A button in Preferences (Phase 0+)
that lets the user sever Showbook's link to their Spotify account.
After disconnecting, every Spotify-powered feature should stop
working and any personalized stats we derived from their Spotify
account (fan-loyalty %, "what I heard" playlist URLs, songs they
played the week before a show) should disappear.

**Why it matters.** Trust + privacy. A user who hits "Disconnect"
expects their personal stats to be wiped — keeping them feels
creepy and breaks the implied contract. It also matters for any
future GDPR-style data-deletion request.

**The bug.** Today's disconnect just flips a `revoked` flag on the
token row. It doesn't wipe any derived data. As Phases 3 and 7 add
new Spotify-powered columns (playlist URLs, priming counts,
"songs you discovered live" lists), we'll add the column but
forget to extend the cleanup. Result: a user disconnects, their
personal stats remain visible on their show pages forever.

**The nuance.** Not all Spotify data is personal. The fact that
"Funeral by Phoebe Bridgers" has Spotify track ID `4uLU6hMCjMI...`
is a fact about the song, true for every user. Wiping that
catalog-shared data on one user's disconnect would break the app
for everyone else. The cleanup has to distinguish per-user
columns (wipe) from catalog-shared columns (keep).

Implementation.md §11 Q10 already names this split. The columns
break down like this:

| Data | Scope | Wipe on disconnect? |
|---|---|---|
| Playlist URLs we created on the user's behalf | User's show | Yes |
| Pre-show / post-show track counts | User's show | Yes |
| Year-end playlist IDs | User's row | Yes |
| The user's top-tracks cache | User's row | Yes |
| Skipped-artist list (Discover preference) | User's row | Yes |
| Spotify track IDs on songs | Shared catalog | No |
| Audio features (energy, valence…) on songs | Shared catalog | No |
| Album / preview / ISRC metadata on songs | Shared catalog | No |

(The earlier draft included a `user_spotify_saved_tracks` cache
on this list. That table was dropped — fan-loyalty and
discovered-live now use on-demand `/me/tracks/contains` calls so
we never persist a copy of the user's saved library. One less
column for SI-09 to track.)

**Options:**

- **A. Reminder comment.** Put a `// also clear: X, Y, Z` comment
  in `disconnectSpotify`. Fragile — comments rot.
- **B. Two named lists + a build-failing test.** Maintain a
  `USER_SCOPED_PURGE` list and a `CATALOG_KEEP` list in code. A
  test scans the schema for anything Spotify-shaped (`spotify_*`
  columns / `user_spotify_*` tables) and fails the build if
  something appears in neither list — forces an explicit decision
  whenever a new Spotify column lands.
- **C. Database-level cascade.** Use foreign-key cascades to auto-
  delete derived rows when the token row goes. Doesn't fit our
  schema (the derived columns live on `shows`/`songs`, which don't
  FK to `user_spotify_tokens`).

---

### SI-10 · Revoked token rows pile up forever

**What revoked rows are.** When a user disconnects Spotify (SI-09)
or Spotify itself revokes our access, we don't delete their token
row from the database. Instead we mark it `revoked_at = now()` and
keep the row as an audit trail (so we can answer "did this user
ever connect?"). The spec says we should actually delete revoked
rows after 30 days.

**Why it matters.** Mild hygiene. The 30-day audit window is
useful for support cases ("when did I disconnect?"). After 30
days, the row has no operational value.

**The bug.** The "after 30 days, delete" step was specified but
never scheduled. Revoked rows live forever.

**How big the problem is.** Tiny. Each row is ~200 bytes. Even
with 10,000 users and 10% disconnecting per year, that's about
200 KB of orphan data per year. Negligible storage; just an
unkept promise.

**Options:**

- **A. Add a small weekly cron** that deletes rows where
  `revoked_at < now() - interval '30 days'`. About five lines of
  code; fits the existing pg-boss cron framework.
- **B. Skip it.** Accept the slight bloat as not worth fixing.

---

### SI-11 · Once Spotify says "no match" for a song, we never re-check

**What this is about.** When Phase 3 ships, a background job
tries to look up the Spotify track ID for each song in our
database. Sometimes Spotify has no match — bootleg recordings,
live-only cuts, unusual covers. To avoid re-asking Spotify on
every page load, we mark the song with a sentinel value
(`spotify_track_id = '__none__'`) meaning "we tried, no luck."

**Why it matters.** Without the sentinel, every Spotify miss
would hammer their API forever, blowing our rate budget and
slowing every page that displays the song.

**The bug.** The sentinel is permanent. But Spotify's catalog
grows — live cuts and re-issues land on streaming months after a
show. A song that doesn't match today might match in 6 months.
We'd never re-check and the user sees "no Spotify link" forever,
even after the artist actually uploaded it.

**Options:**

- **A. Add a "last attempted at" timestamp; re-check sentinels
  older than 90 days.** One small column, one filter in the job.
  Cheap and bounded.
- **B. Track every attempt in a separate `song_resolution_attempts`
  table.** Heavier; useful for debugging which songs we've tried
  and failed.
- **C. Accept staleness.** No automatic re-check; user has to
  manually trigger a re-resolve (button somewhere?).

---

### SI-12 · Nightly Spotify-library sync might exceed daily API budget ✅ RESOLVED (obsolete)

The original concern: Phase 7's nightly job pulled each user's
full Spotify saved-tracks library (~100 paged calls per power
user × 250 users/run × 4 runs = 25k calls/night), brushing
Spotify's daily quota.

**Resolved by dropping the library cache entirely.** Fan-loyalty
+ discovered-live now use Spotify's `/me/tracks/contains`
endpoint on demand, per show — one API call per show pageload
covering ~20 track IDs. No nightly job, no bulk cache, no
cross-user batch load. The privacy footprint also shrinks (no
mirror of the user's saved library lives in our DB). See Phase 7
spec for the `tracksContains` wrapper.

---

### SI-13 · No way to tune the prediction algorithm after launch

**What this is about.** The prediction algorithm has knobs:
- Weights for recent setlists vs older ones (1.0 → 0.04 across 5 tiers)
- Strength of the Bayesian prior (α=2, β=2)
- Active-tour anchor threshold (0.8) and floor probability (0.85)
- Various thresholds inside the style classifier.

Today they're hand-tuned constants in the code.

**Why it matters.** Phase 4's calibration eval will tell us
*whether* the predictions are well-calibrated. But if calibration
drifts after 6 months of corpus growth — say, the model becomes
overconfident — we'd want to re-tune the knobs to fix it.

**The bug.** No automated way to find good knob values. We'd
have to manually try combinations and re-run the eval each time.
Slow and error-prone.

**How big the problem is.** Zero until calibration drifts. Could
be months, could be never. The math is sound today.

**Options:**

- **A. A small tuning script.** Grid-search across knob values
  using saved eval history; print the configuration that
  minimizes Brier score on a held-out test set. Manual to run,
  but replaces guesswork with data.
- **B. Full A/B harness.** Production runs two model versions in
  shadow; eval picks the winner. Much heavier infra; the right
  call only after multiple major model overhauls.
- **C. Defer until we actually need to re-tune.** Build A then.

---

### SI-14 · The release gate for Phish-style artists measures the wrong thing

**What the release gate is.** Phase 4 sets a quality bar that the
prediction algorithm has to clear before Phase 5 (the rotating-
style display) can ship to users. For rotating-style artists the
bar is "precision-at-10 ≥ 0.4" — of the top 10 highest-
confidence song picks, at least 4 should actually play.

**Why it matters.** The gate determines whether we ship a
feature. Wrong metric → we either ship something users find
unhelpful (false-pass) or block a good feature (false-fail).

**The bug.** The rotating-style UX isn't a top-10 ranked list —
it's a **gap chart with ~30 candidate songs** plus position
pools. The user's mental model is "did the songs that actually
played appear in the chart somewhere?" — that's **recall-at-K**,
not precision-at-K.

Precision-at-10 measures "are our top picks right?" Recall-at-30
measures "did we cover the actual setlist with our broader pool?"
For the way the Phish UX is shown, the second question is the
one users will judge.

**Options:**

- **A. Switch to recall-at-K (K≈15, a typical Phish set length).**
  Better matches the UX's mental model. Single config change.
- **B. Use both: precision-at-10 ≥ 0.4 AND recall-at-15 ≥ 0.55.**
  Tighter gate, harder to pass; rejects models that are
  precise-but-narrow.
- **C. Switch to F1 (balanced precision/recall).** Harder to
  communicate to non-stats users.

---

## Minor / nice-to-have

### SI-15 · Math treats all songs as equally likely before evidence

**What this is about.** The prediction algorithm uses Bayesian
smoothing — a math trick that keeps the model honest when
evidence is thin. With α=β=2 (the prior parameters), a song that
played 3-of-3 recent shows comes out at 71% probability rather
than 100% (because 3 setlists is too small a sample to claim
certainty).

**Why it matters.** Smoothing keeps confidence numbers honest
during cold-start. Without it, "we have 1 setlist and the song
appeared in it" would read as 100% — wildly overconfident.

**The bug (small).** The smoothing assumes every song has the
same baseline probability before evidence. For a Phish with 800
historical songs, the model implicitly says "all 800 are equally
likely tonight." But "You Enjoy Myself" (played 600+ times in
history) should have a stronger baseline than "Camel Walk"
(played 12 times).

**How big the problem is.** Probably small. The model self-
corrects as corpus fills.

**Options:**

- **A. Weight each song's prior by `historical_play_count`** —
  we already track this column for §15c (gap-based predictions).
  Songs played a lot get a stronger baseline.
- **B. Drop smoothing entirely for songs with N≥5 appearances.**
  Simpler but loses cold-start calibration.
- **C. Wait and see.** Let Phase 4's eval tell us if this matters.

---

### SI-16 · The vibe radar might have no data for new tours

**What the vibe radar is.** Phase 8 ships a 7-axis chart on Show
detail showing the audio profile of the show — energy,
danceability, valence ("happiness"), acousticness, etc. — averaged
across the songs played. Data comes from Spotify's
`audio-features` endpoint.

**Why it matters.** Distinctive feature; "show vibe at a glance"
is the kind of stat people screenshot and share.

**The bug.** Spotify **deprecated** the `audio-features` endpoint
for new applications in late 2024. We don't yet know if Showbook
was grandfathered in (we have to make a probe call to find out).
If we don't have access, the backup data source is
**AcousticBrainz** — a community database that froze in 2022.
That means ~100% miss rate for any song released in 2023 or
later. The vibe radar for a 2025 pop tour would be empty.

**Options:**

- **A. If Spotify denies access, drop Phase 8 from v1 entirely.**
  Vibe radar / energy arc are nice-to-haves, not core.
- **B. Build a tiny on-device ML model** that estimates audio
  features from Spotify's 30-second preview MP3s. Heavy infra; a
  separate project on its own.
- **C. Pay for a third-party data source** (Reccobeats, Songdata,
  etc.). New external dependency + monthly cost.
- **D. Make Phase 8 conditional on the probe result.** Probe
  ends Phase 0, decide at the start of Phase 8 based on what we
  got back.

---

### SI-17 · "First time hearing this song live" claim might be wrong

**What this rail is.** A user-facing feed (Phase 2) titled
something like "Songs you heard live for the first time" — fun
nostalgia. "The first time you heard 'Funeral' live was at MSG
on July 12, 2024."

**Why it matters.** Memory-prosthetic appeal — this is the kind
of stat that makes the app feel sticky.

**The bug.** The current spec computes "first time" by looking
at the EARLIEST date the song appeared across **all setlists in
our database**, including the corpus of other fans' setlists we
pulled from setlist.fm. If another fan attended an earlier show
that we have in our corpus, the user's "first time" claim is
wrong from the user's point of view.

**How big the problem is.** Common — the corpus typically has
more setlists than any single user attended.

**Options:**

- **A. Compute "first time" only across the user's own attended
  shows.** Honest from the user's perspective. The semantic
  shifts to "first time YOU heard this song live."
- **B. Keep the global semantic but rename the rail.** Call it
  "Tour debut you caught" instead — that's actually accurate for
  the global MIN query.
- **C. Ship both rails.** "First time you heard it" (user-scoped,
  option A semantic) AND "Tour debut you caught" (global, option
  B semantic). They answer different questions; both are
  interesting.

---

### SI-18 · We collect user feedback we have no plan to use

**What this is about.** Phase 11 ships a "was this prediction
useful?" thumbs-up/down on every prediction. Data goes into a
`prediction_feedback` table.

**Why it would matter.** Useful signal for improving predictions
— e.g., if 80% of users thumbs-down our Phish predictions, we
know the rotating-style algorithm has a real-world problem
even if the math eval says it's fine.

**The bug.** The plan ships the UI and the table but **doesn't
specify how the feedback feeds back into the algorithm**. We'd
be collecting data with no closing-the-loop step.

**Why this is bad.** Data debt. Collecting with no plan to use is
worse than not collecting — it implies a promise to the user
("your feedback matters") that we don't keep.

**Options:**

- **A. Drop the thumbs UI.** Don't collect what we won't use.
- **B. Commit to a Phase 12** that wires feedback into the eval
  harness (per-style satisfaction score alongside Brier).
- **C. Defer the wiring; collect data passively.** Use later if
  we ever need it.

---

### SI-19 · Spotify's developer policy on branded playlists

**What this is about.** Phase 3 creates playlists on the user's
Spotify with custom cover art and "Showbook" branding in the
description ("Made by Showbook · 13 of 16 songs").

**Why it matters.** Spotify's developer policy has specific
requirements about how third-party apps can interact with their
API and brand the artifacts they create. Apps that ignore the
rules can have their developer account suspended — which would
kick **every Showbook user's Spotify connection** offline at
once.

**The bug.** Nobody has read Spotify's current developer policy
to confirm what's required (mandatory "Powered by Spotify"
attribution? Logo placement? Disclaimer text?).

**Options:**

- **A. 30-minute legal sanity-check before Phase 3 ships.**
  Owner reads Spotify's developer policy + branding guidelines,
  lists any required attributions, updates the playlist cover /
  description templates. Cheap.
- **B. Ship and react if Spotify complains.** Risky — the
  reaction is account suspension, not a friendly email.

---

### SI-20 · The Phase 1 backfill script can't resume if it crashes

**What the backfill script is.** A one-shot job that walks every
existing show's setlist and indexes the songs into the new
schema (Phase 1). Runs once when Phase 1 ships so historical
shows participate in the "songs you've heard most" stats.

**Why it matters.** Without it, "songs heard most" / "tour
debuts" only work for shows added AFTER Phase 1. The whole
historical archive is stat-invisible.

**The bug.** The script is a single pass over all shows. If it
crashes halfway (DB connection lost, container OOM), you have
to start over from row 1.

**How big the problem is.** Small for self-hosted Showbook
(thousands of shows, full run ~17 minutes). Real for a hypo-
thetical hosted Showbook at 100k+ shows.

**Options:**

- **A. Add a `--since-show-id` resume flag** so a crashed run
  picks up where it died.
- **B. Track progress in a `backfill_runs` cursor table.**
  Heavier; only needed if we run multiple backfills.
- **C. Accept that a full re-run takes 17 minutes** and is
  re-runnable from scratch. Idempotent already.
