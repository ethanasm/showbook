# Setlist Intelligence — plan review (gaps & holes)

Captured 2026-05-09 after Phase 0 shipped (#145, merged with main).
Severity is "what's most likely to bite," not impact alone. Items are
keyed `SI-NN` so we can reference them in commits / PRs.

---

## Critical — will bite the moment we start Phase 1 (or sooner)

### SI-01 · `TOKEN_KEY` env var isn't plumbed into any environment

Phase 0 introduced `TOKEN_KEY` (32-byte hex/base64) and the
encrypt/decrypt path in `packages/api/src/crypto.ts`, but nobody set
it in `.env.dev`, `.env.prod`, the Docker compose files, or the
`db:prepare:e2e` env. The first time anyone tries to connect Spotify
in dev/prod (not the unit/integration tests, which set it locally)
`getKey()` throws.

We have a runbook gap and a config gap.

### SI-02 · No `headliner_performer_id` on `shows`

Multiple phases (Phase 3 `exportPlaylistPredicted({ showId,
performerId })`, Phase 5 `predictedSetlist({ showId })` switching on
`performer.setlistStyle`) assume "the headliner" is a first-class
lookup. Today it's a query against `show_performers WHERE role =
'headliner' ORDER BY sort_order LIMIT 1`. Either we ship that lookup
as a helper everyone uses, or we add a denormalized FK. Currently
nobody owns it.

### SI-03 · `shows.date` is nullable for `watching` shows

Phase 1 makes Predicted the default segment for `watching/ticketed`
shows, but the algorithm needs a `targetDate`. What's the prediction
for a multi-night theatre run the user hasn't picked a night for?
Spec is silent.

### SI-04 · Corpus-fill skips performers with no MBID, with no fallback

Most small artists — Ticketmaster gives us MBIDs for major performers,
MusicBrainz coverage thins fast for indie acts. Their
`predictedSetlist` will permanently return `tourCoverage: 'cold'`. The
plan never names this; the §15h "festival vs headline" filter is the
closest thing. Need either a name-based fallback or a UX path that
says "we can't predict this artist" honestly.

### SI-05 · Phase 3's "hype button hidden for rotating-style" depends on Phase 5

Phase 3 spec line 159 says hide for rotating, but
`performer.setlistStyle` doesn't get classified until Phase 5.
Sequence-wise, Phase 3 ships hype buttons that show for Phish too.
Either Phase 3 needs to inline a quick classifier, or Phase 5 has to
land first.

### SI-06 · Prediction-cache signature has a race

`corpus_signature = max(tour_setlists.fetched_at)` is computed
*outside* the SELECT that returns the corpus rows. If the corpus-fill
job inserts a row between those two queries, we cache a stale-marked
prediction that includes the new row. Fix: take both inside one
transaction, or hash the row IDs instead.

---

## Significant — can ship Phase 0 but need a plan

### SI-07 · Tour-ID synthesis collisions are real, not theoretical

§15r mentions year-salting but punts to Phase 11. Sabrina has reused
tour names across years; Phish has "Summer Tour 2025"/"2026";
Coldplay's "Music of the Spheres" runs three years. The current
`(performerId, lower(tour.name))` synthesis fuses them, and the
365-day Tier D bound doesn't help when the same tour name
*legitimately* spans multiple years. Worth salting now, not in
Phase 11.

### SI-08 · Mobile connect flow is plausibly broken in practice

`WebBrowser.openAuthSessionAsync(authUrl, redirectUri)` resolves on
redirect-to-redirectUri *with the URL*, but the iOS
ASWebAuthenticationSession only intercepts redirects matching its
registered URL scheme. Pointing at our HTTPS web callback works only
if the app supports universal links for that domain — Showbook today
uses `showbook://` for deep links and we didn't verify universal-link
config. Worth a manual smoke test in iOS Simulator before claiming
Phase 0 mobile parity.

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
