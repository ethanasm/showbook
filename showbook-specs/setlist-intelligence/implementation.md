# Setlist intelligence — implementation plan

The shipping plan for the full setlist intelligence feature, including
the Spotify integration (§13 of `feature-plan.md`,
plain-language version in `…-music-layer.md`).

This plan is opinionated: it commits to specific decisions where the
prior docs left options open. Where a decision is still a coin-flip, it
shows up in §11 (Open questions).

---

## 1. The anchor decision: connect Spotify once

**Connect Spotify exactly once per user, in-context, the first time
they touch any Spotify-using feature. Persist the token. Never prompt
again unless Spotify itself revokes our access.**

This rules out three approaches that prior docs floated:

- **Per-feature scope ladder** (the *"toggle this Preferences setting,
  re-OAuth, toggle the next one"* model from §13l) — rejected. Asks
  the user for the same thing four different times.
- **One-shot OAuth per click** (the existing artist-import pattern) —
  rejected. The whole point of "connect Spotify" should be that once
  done, it stays done.
- **A buried "Connect Spotify" toggle in Preferences** — rejected.
  The connect modal appears wherever the user tries to use a
  Spotify-requiring feature, not in a settings drawer they have to
  go find.

Concrete UX:

1. User taps **Import from Spotify** on Discover, or **Hype playlist
   on Spotify** on a show, or **Save to Spotify** on a past show, or
   any other Spotify-touching feature.
2. If a valid token exists → the action fires immediately. Done.
3. If no token (or token revoked) → a `<SpotifyConnectModal>` appears
   in the same place. One button: **Connect Spotify**. Tapping opens
   the OAuth popup. On success, the token is encrypted, stored, and
   the action that was originally requested fires automatically. No
   second click required.
4. From then on, every Spotify feature on the user's account works
   without further prompts.

The modal text is generic enough to fit any entry point:

```
┌─ Connect Spotify ──────────────────────────────┐
│                                                  │
│   Showbook uses Spotify to make playlists,      │
│   identify songs, and surface stats about your  │
│   shows. Connect once and we'll handle the rest.│
│                                                  │
│   We'll never post on your behalf or share      │
│   your data. You can disconnect any time from   │
│   Preferences or your Spotify account.          │
│                                                  │
│              [ Connect Spotify → ]              │
│                                                  │
│              Not now                             │
└──────────────────────────────────────────────────┘
```

A short copy variant lives next to each entry point's CTA so users
know what they're about to do (e.g. *"Connect Spotify to make a hype
playlist for tonight's show"*) but the modal itself stays universal.

---

## 2. Scopes: ask for everything upfront

Spotify will show a consent screen listing every requested scope. To
honor "connect once," we batch all the scopes setlist intelligence
needs into a single OAuth.

| Scope | Powers |
|-------|--------|
| `user-follow-read` | Spotify-follow rail · Spotify artist import (existing) |
| `playlist-modify-private` | Hype playlist · post-show "what I heard" playlist · year-end soundtrack |
| `ugc-image-upload` | Branded covers on the playlists above |
| `user-library-read` | Fan-loyalty ring · "songs you discovered live" rail · personal-weight chips on predicted setlists |
| `user-library-modify` | The ⚡ "save this song" button on the discovered-live rail |
| `user-read-recently-played` | Pre-show priming stat · listening-peak hints |
| `user-read-currently-playing` | Live-mode setlist capture (deferred but cheap to include) |
| `user-top-read` | Top-tracks blend into predicted setlists · personal-weight chips |

Eight scopes. Spotify renders these as a bullet list on its consent
screen — users click "agree" once, we store the resulting refresh
token, done.

**Why not a smaller initial scope?** If we ship with three scopes and
add more later, Spotify forces a re-auth dialog the moment a user hits
a feature whose scope wasn't in the original grant. That's exactly the
"asking again" the user vetoed. Up-front bundling is the only way to
honor *connect once*.

**Privacy posture:** all scopes are *read-only* except for
`playlist-modify-private` (writes private playlists), `ugc-image-upload`
(writes the cover art on those private playlists), and
`user-library-modify` (writes only when the user explicitly taps "save
this song"). Nothing automated touches the user's library or feed.

---

## 3. The new shared infrastructure

These pieces unblock everything else and ship in Phase 0.

### 3.1. Token table

```sql
-- packages/db/drizzle/00XX_user_spotify_tokens.sql
CREATE TABLE "user_spotify_tokens" (
  user_id           text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  access_token_enc  text NOT NULL,
  refresh_token_enc text NOT NULL,
  scope             text NOT NULL,
  expires_at        timestamp NOT NULL,
  spotify_user_id   text NOT NULL,
  display_name      text,
  product           text,                      -- 'free' | 'premium' | 'open'
  -- Trail of token health:
  last_used_at      timestamp,
  last_refreshed_at timestamp,
  revoked_at        timestamp,
  revoked_reason    text,                      -- '401_from_spotify' | 'user_disconnect'
  created_at        timestamp NOT NULL DEFAULT now(),
  updated_at        timestamp NOT NULL DEFAULT now()
);
```

PK is `user_id` because each user has at most one Spotify connection.
Tokens are encrypted at rest using `process.env.TOKEN_KEY` (a 32-byte
key set per-environment; rotation is a separate runbook). We use AES-256-GCM
in `packages/api/src/crypto.ts`.

### 3.2. Token helper

```ts
// packages/api/src/spotify-tokens.ts
export async function ensureFreshUserToken(userId: string): Promise<string | null> {
  // Returns access token if connected, null if not.
  // Auto-refreshes when within 60s of expiry.
  // Sets revoked_at and returns null on Spotify 401.
  const row = await db.query.userSpotifyTokens.findFirst({
    where: and(
      eq(userSpotifyTokens.userId, userId),
      isNull(userSpotifyTokens.revokedAt),
    ),
  });
  if (!row) return null;
  if (row.expiresAt > new Date(Date.now() + 60_000)) {
    await markUsed(userId);
    return decrypt(row.accessTokenEnc);
  }
  // Refresh.
  return refreshAndPersist(userId, row);
}

export async function isSpotifyConnected(userId: string): Promise<boolean> {
  const row = await db.query.userSpotifyTokens.findFirst({
    where: and(eq(userSpotifyTokens.userId, userId), isNull(userSpotifyTokens.revokedAt)),
    columns: { userId: true },
  });
  return !!row;
}

export async function disconnectSpotify(userId: string, reason: string): Promise<void> {
  // Set revoked_at + revoked_reason; do NOT delete the row (audit trail).
  // Cascading clear of derived data — fan-loyalty stats, priming-stat columns, etc.
}
```

`ensureFreshUserToken` is the ONLY way any backend code touches a user
Spotify token. Direct queries on the table are forbidden. This guarantees
the refresh + revoked-handling logic is in one place.

### 3.3. The connect modal + hook

```tsx
// apps/web/components/spotify/SpotifyConnectModal.tsx
interface SpotifyConnectModalProps {
  open: boolean;
  ctaLabel: string;          // e.g. "Connect to make a hype playlist"
  onConnected: () => void;   // resume the original action
  onClose: () => void;
}
```

```ts
// apps/web/components/spotify/useSpotifyConnection.ts
export function useSpotifyConnection() {
  const status = trpc.spotify.connectionStatus.useQuery();
  const mutate = trpc.spotify.persistToken.useMutation();

  const requireConnection = useCallback(
    async (action: () => void | Promise<void>) => {
      if (status.data?.connected) return action();
      // Open modal; on success, fire action.
      setPendingAction(() => action);
      setModalOpen(true);
    },
    [status.data?.connected],
  );

  return { status, requireConnection, modalOpen, pendingAction, ... };
}
```

Every component that needs Spotify wraps its action in
`requireConnection(() => doTheThing())`. The hook handles the modal,
the OAuth popup, persisting, and re-firing the original action.

The mobile mirror (`apps/mobile/components/SpotifyConnectSheet.tsx`)
uses the existing `Sheet` primitive instead of an overlay — same
behavior, native presentation.

### 3.4. The OAuth callback evolves

Today's `apps/web/app/api/spotify/callback/route.ts` returns the access
token to the client via `postMessage`. We change it so:

1. Callback exchanges the code for an access + refresh token.
2. Encrypts both with `TOKEN_KEY` and writes the row to
   `user_spotify_tokens`.
3. Sends a `postMessage` to the opener: `{ type: 'spotify-connected' }`
   (no token — token never leaves the server).
4. Opener calls `trpc.spotify.connectionStatus.invalidate()` so the
   cached "not connected" state flips to "connected" and the original
   action fires.

The existing `useSpotifyImport.ts` is migrated to use this flow — it
no longer reads the access token from `localStorage`; it just listens
for the `spotify-connected` event and calls
`trpc.spotifyImport.listFollowed.mutate({})` (no `accessToken`
argument; the server uses `ensureFreshUserToken`).

### 3.5. Disconnect flow

A "Disconnect Spotify" button lives in Preferences (under
Integrations). Tap → confirms → calls `trpc.spotify.disconnect`. The
server marks `revoked_at`, clears any Spotify-derived stats from
`shows` rows (fan-loyalty %, priming counts, playlist URLs), and
returns success. The token row stays in the DB with the revoked
flag for audit purposes; Phase 11 ships a weekly cron that hard-
deletes rows where `revoked_at < now() - interval '30 days'`.

#### Disconnect cleanup registry (SI-09)

`disconnectSpotify(userId, reason)` walks two named lists kept
beside the helper:

- `USER_SCOPED_PURGE` — every column / table that contains
  user-specific Spotify-derived data. On disconnect, each entry is
  cleared / deleted for the disconnecting user only.
- `CATALOG_KEEP` — every Spotify-shaped column / table that is
  catalog-shared (true for every Showbook user, not personalized).
  Disconnect leaves these untouched; wiping them would break the
  feature for every other user.

A unit test introspects the schema, finds every Spotify-shaped
entity — `spotify_*` columns on user-owned tables (`users`,
`shows`) and any table named `user_spotify_*` — and asserts each
appears in exactly one of the two arrays. Anything missing fails
the build. When a future phase adds a new Spotify column, the
failing test forces an explicit categorization decision in the
same PR. The contract is documented in implementation.md §11 Q10.

V1 lists (extend as new phases ship columns):

```ts
const USER_SCOPED_PURGE = [
  // Phase 3
  { table: 'shows', column: 'spotify_playlist_url', filter: 'user_id' },
  { table: 'shows', column: 'spotify_attended_playlist_url', filter: 'user_id' },
  // Phase 7
  { table: 'shows', column: 'spotify_prep_track_count', filter: 'user_id' },
  { table: 'shows', column: 'spotify_post_track_count', filter: 'user_id' },
  { table: 'users', column: 'spotify_year_playlists', filter: 'id' },
  // Phase 9
  { table: 'user_spotify_skipped_artists', mode: 'delete', filter: 'user_id' },
  // Phase 11+ phase columns go here as they land...
] as const;

const CATALOG_KEEP = [
  // Phase 3
  'songs.spotify_track_id',
  'songs.spotify_track_id_resolved_at',   // SI-11
  // Phase 7+
  'songs.spotify_audio_features',
  'songs.spotify_preview_url',
  'songs.isrc',
  'songs.spotify_album_id',
  'songs.spotify_album_name',
  'songs.spotify_album_release',
  'songs.spotify_album_type',
] as const;
```

Note: there is **no** `user_spotify_saved_tracks` table — Phase 7
uses on-demand `/me/tracks/contains` calls instead of caching the
user's library (privacy decision, see §13c). One less entry in
`USER_SCOPED_PURGE`.

---

## 4. Phase-by-phase implementation

Each phase is a coherent shippable chunk. Phases don't depend on
later ones except where called out.

### Phase 0 — Foundation (~1 week)

**Goal:** unblock everything below. Nothing user-visible.

Schema migrations:
- `tour_setlists`, `songs`, `setlist_song_appearances` per
  `feature-plan.md` §2
- `user_song_stats` materialized view
- `user_spotify_tokens` per §3.1 above
- `prediction_eval_runs` per §15i
- `performers.setlist_style` + `performers.setlist_style_inferred_at`
- New columns on `songs` for §15c gap-based prediction
  (`historical_play_count`, `historical_mean_gap`, `last_played_date`,
  `current_gap_shows`)

Code:
- `packages/api/src/spotify-tokens.ts` — `ensureFreshUserToken`,
  `isSpotifyConnected`, `disconnectSpotify`
- `packages/api/src/crypto.ts` — AES-256-GCM helpers + `TOKEN_KEY`
  env var
- `packages/api/src/setlistfm.ts` extension — add `fetchArtistSetlists`
  (paginated `/artist/{mbid}/setlists`)
- `packages/api/src/routers/spotify.ts` — `connectionStatus`,
  `persistToken`, `disconnect`, `revokeAndReconnect`
- Migrate `apps/web/app/api/spotify/callback/route.ts` to persist
  instead of postMessage
- Migrate `apps/web/components/preferences/useSpotifyImport.ts` to use
  persistent token (no access token in client)
- `apps/web/components/spotify/SpotifyConnectModal.tsx` +
  `useSpotifyConnection.ts`
- Mirror on mobile: `apps/mobile/components/SpotifyConnectSheet.tsx`

Tests:
- Unit: encryption round-trip, refresh logic, revoked-handling
- Integration: full OAuth → persist → use in a tRPC procedure flow
- Maestro: connect-modal opens → user taps connect → mock OAuth →
  modal closes → original action fires

Exit criteria:
- The existing artist-import flow works end-to-end with persisted
  tokens (no behavior change for users who connect, but they're
  no longer asked again on subsequent imports)
- A new test scaffolding feature (e.g. a stub "echo my Spotify name"
  procedure) confirms the persisted token round-trips

---

### Phase 1 — Predicted setlist algorithm (Stable-style MVP) (~2 weeks)

**Goal:** the Tate McRae case end-to-end on web. No mobile yet.

Code:
- `packages/api/src/setlist-predict.ts` — the tour-aware probability
  model from §4c with Bayesian smoothing
- `packages/jobs/src/setlist-corpus-fill.ts` — three modes (`predict`,
  `deep`, `refresh`) per §3a
- `packages/jobs/src/song-index-rebuild.ts` — the indexer per §3b
- `scripts/backfill-song-index.ts` — one-time backfill of existing
  `shows.setlists` jsonb into the index
- New tRPC procedures in `packages/api/src/routers/setlist-intel.ts`:
  - `predictedSetlist({ showId })`
  - `songsHeardMost({ scope, limit })`
  - `tourDebutsCaught({ performerId? })`
  - `setlistDiff({ showIdA, showIdB })`
  - `firstTimes({ })`
- Web UI: predicted-setlist tab on `/(app)/shows/[id]/`, using the
  components from `ui-spec.md`:
  - `PredictionHero`
  - `SpoilerCurtain`
  - `PredictionSongRow`
  - `ProbabilityBar`
  - `EncoreDivider`
  - `RotatingSlotCard` (used for the Tate "guest duet" rotation)

Triggers wired:
- On user follow of an artist → queue `setlist-corpus-fill` predict
- On `shows-nightly` for any artist with a `watching` show in the
  next 30 days → queue `setlist-corpus-fill` predict
- On show-detail page open → debounced corpus refresh if stale

Exit criteria:
- For a synthetic seeded user with 3 followed artists, the predicted-
  setlist tab loads on a `watching` show in <500ms
- The Tate McRae worked example (
  `worked-examples.md` §1) renders
  with the documented confidence + 21-song core
- `pnpm verify:e2e` includes a Playwright spec for the spoiler-
  curtain reveal flow

---

### Phase 2 — Stable-style polish + Songs page (~1 week)

**Goal:** the "Songs" segment alongside Setlist + Predicted, plus
artist-page "songs you've heard live" + tour-debut catches.

Code:
- Web `/(app)/songs/` index — table view of every song the user has
  heard live
- Per-song detail page `/(app)/songs/[id]/`
- Artist page `/(app)/artists/[id]/` extensions: songs-you've-heard
  section, tour-debut catches section
- Show detail Songs segment (third tab)

Exit criteria:
- The `firstTimes` rail on Home renders for a test user with ≥1
  tour-debut catch
- Song detail page opens to <300ms paint

---

### Phase 3 — Spotify export (Hype + Save) (~1 week)

**Goal:** the two playlist buttons work end-to-end. Branded covers.

Code:
- `packages/api/src/routers/setlist-intel.ts` additions:
  - `exportPlaylistPredicted({ showId })`
  - `exportPlaylistAttended({ showId })`
- `packages/api/src/playlist-cover.ts` — Satori SVG → JPEG cover
  generator (uses existing image stack); covers cached in R2 keyed
  by `(playlistId, version)`
- `packages/jobs/src/spotify-track-resolve.ts` — populates
  `songs.spotify_track_id` for every (performer, song) combo
- New `shows.spotify_playlist_url` column
- New `shows.spotify_attended_playlist_url` column (separate from
  the predicted one — they're different playlists)
- Show detail action bar buttons: "Hype playlist" (watching/ticketed)
  and "Save tonight to Spotify" (past)
- Both wrapped in `requireConnection(...)` so first-time use auto-
  triggers the connect modal

Exit criteria:
- Tap "Hype playlist" on a fresh-account show → connect modal →
  OAuth → playlist appears in user's Spotify with branded cover →
  button on show detail flips to "Open in Spotify"
- Subsequent taps on any other Spotify-using feature: zero prompts
- Resolved-vs-unresolved song count is honest (toast: "Created — 13
  of 16 found")

---

### Phase 4 — Eval harness (~1 week)

**Goal:** measure that "94% confident" predictions are actually right
94% of the time. Block release on calibration.

Code:
- `scripts/eval-setlist-predictor.ts` — for the past 30 days of
  `tour_setlists`, predict each setlist using the corpus
  *as it would have looked the day before* and compare to actual
- Daily cron writing `prediction_eval_runs` rows with Brier score,
  per-bin calibration curve, precision-at-10
- Web admin page `/(app)/admin/eval` (gated by `ADMIN_EMAILS`) for
  visualizing the calibration curve and Brier history
- Release gate per §15q: stable-style mean Brier ≤ 0.15; rotating-
  style mean precision-at-10 ≥ 0.4

Exit criteria:
- The eval cron has been running for 14 days with no manual fixes
  required
- Calibration curve is within 20 percentage points of perfect for
  every probability bin

---

### Phase 5 — Style classifier + Rotating display (~2 weeks)

**Goal:** the Phish case end-to-end.

Code:
- `packages/api/src/setlist-style.ts` — classifier with auto-infer
  + manual seed override per §11 question 4 below
- `packages/jobs/src/setlist-style-refresh.ts` — nightly recompute
  per performer with ≥5 corpus setlists
- `packages/api/src/setlist-predict-rotating.ts` — gap-based
  prediction model with multi-night anti-repeat + position pools
- `packages/api/src/multi-night-run-detector.ts` — venue + date
  proximity heuristic; resolves through `venues` table when possible
- New components per UI spec:
  - `MultiNightContextBanner`
  - `GapChartRow`
  - `PositionPoolCard`
  - `BustoutCandidateRow`
  - `ShowModeOddsCard`
- Show detail predicted-setlist segment becomes a switcher on
  `prediction.style` — mounts `<StablePrediction>` or
  `<RotatingPrediction>`

Schema additions for §15c:
- Nightly job updates `songs.current_gap_shows`,
  `songs.historical_mean_gap` per performer

Exit criteria:
- Phish worked example (§2 of worked-examples) renders the
  documented gap chart, position pools, and multi-night anti-repeat
  exclusions
- For a tour with all 3+ nights at one venue, multi-night detection
  fires automatically

---

### Phase 6 — Theatrical + Improvised displays (~1 week)

**Goal:** Beyoncé and King Gizzard worked examples.

Code:
- `packages/api/src/setlist-predict-theatrical.ts` — deterministic
  setlist + rotating-slot detection
- `packages/api/src/setlist-predict-improvised.ts` — show-mode
  detection + vibe sketch + popular picks
- New components: `ActDivider`, `VibeSketchCard`, action card

Exit criteria:
- Beyoncé and King Gizzard worked examples render their documented
  outputs
- The single `<PredictedSetlist style={prediction.style} />`
  component switches correctly across all four styles

---

### Phase 7 — Music layer v2: library, priming, year-end (~2 weeks)

**Goal:** the features that need to act on their own (background
jobs against the persisted token).

Code:
- `packages/jobs/src/spotify-library-sync.ts` — nightly per-user
  `/me/tracks` page-through into `user_spotify_saved_tracks`
- `packages/jobs/src/spotify-recently-played.ts` — pulls last 50
  plays per user; updates `shows.spotify_prep_track_count` /
  `spotify_post_track_count` for any show within the ±6h window
- `packages/jobs/src/year-end-soundtrack.ts` — Dec 31 03:00 ET cron;
  builds the per-user "Showbook · YYYY" playlist
- Show detail additions:
  - Fan-loyalty ring
  - "Songs you discovered live" rail (with save buttons →
    `setlistIntel.saveDiscoveredSong` mutation)
  - Pre-show priming one-liner
- New email template: year-end soundtrack delivery
- Personal-weight chips on predicted-setlist rows (§15j) — this
  layer's first appearance

Exit criteria:
- For a connected user with a recent show, the fan-loyalty ring +
  discovered-live rail render on Show detail
- Priming stat populated on a show 24h after it transitions to past
- Year-end soundtrack works end-to-end against a seeded
  Dec-1-to-now corpus

---

### Phase 8 — Vibe radar + energy arc (gated on Spotify API access) (~1 week)

**Goal:** if the audio-features endpoint is reachable, ship #3 + #4.
If not, ship via AcousticBrainz fallback for older tracks.

Code:
- `packages/jobs/src/spotify-audio-features.ts` — probe + batch fetch
- `packages/api/src/acousticbrainz.ts` — fallback client for older
  tracks via cached MBIDs
- `show_vibe` materialized view per §13b
- New components: `VibeRadar`, `EnergyArc`, set-length inline
- The probe call lives in Phase 0's foundation work so we know the
  status before committing to this phase's scope

Exit criteria:
- For a test show with all songs resolved, the vibe radar renders
  with all 7 axes
- For a show with mixed resolved/unresolved songs, the radar shows
  a coverage % and degrades gracefully

---

### Phase 9 — Spotify-follow rail + 30-second previews + Web Playback (~1 week)

**Goal:** the small wins.

Code:
- Discover page rail: artists user follows on Spotify but not on
  Showbook — `setlistIntel.spotifyFollowsDiff` procedure
- 30s preview play buttons on every setlist row (mobile uses
  `expo-av`; web uses an inline `<audio>`)
- Web Playback SDK integration for Premium subscribers (web only)
- "Save discovered song" → `user-library-modify` writes

Exit criteria:
- For a user with ≥3 Spotify-only follows, the rail appears on
  Discover with one-tap follow
- 30s previews play inline on web + mobile
- Premium users get full-track playback on web; non-Premium users
  see a graceful "preview" badge instead

---

### Phase 10 — Mobile parity + iPad three-pane (~1 week)

**Goal:** every web surface mirrored on phone + iPad.

Code:
- `apps/mobile/app/show/[id].tsx` predicted segment + style switcher
- `apps/mobile/app/song/[id].tsx` per-song detail
- `apps/mobile/app/songs/index.tsx` Songs power view (iPad three-pane
  variant)
- iPad three-pane right pane: `SetlistLab` per UI spec §6
- Mobile cache + outbox additions:
  - Add `'setlistIntel.exportPlaylistPredicted'` and
    `'setlistIntel.exportPlaylistAttended'` to the `PendingMutation`
    union in `apps/mobile/lib/cache/outbox.ts`
- `apps/mobile/lib/spotify-connection.ts` — mobile mirror of the
  web hook

Exit criteria:
- Predicted segment renders on iPhone, iPad, and Android sample
  devices with all four styles
- iPad three-pane SetlistLab right pane shows on a concert show
  detail
- Maestro flow `e2e/flows/predicted-setlist.yaml` passes on Android

---

### Phase 11 — Polish + §15 deferred (~2 weeks)

**Goal:** the smaller §15 wins that compound the value.

Code:
- §15m — album-drop forward signal (album release-date enrichment
  feeds an "expected from new album" weight into prediction)
- §15g — special-event detection (Halloween, NYE, residency
  patterns) with manual rules table
- §15f — set count / show-length prediction
- §15n — community correction loop ("report a missing song")
- §15o — spoiler-blur propagation across digest emails + Brain replies
- Confidence calibration UI in admin: weekly Brier history chart

Exit criteria:
- Adding a manual special-event rule for Phish Halloween produces
  the documented "we won't predict this one" empty state
- Album-drop forward signal lifts new-album track probability on
  shows in the ±60-day release window

---

## 5. Total estimated effort

~14 weeks single-developer, with parallel paths possible after Phase 0.
Phase 0 → 1 → 2 → 3 is a clean critical path that gets the stable-
style end-to-end. Phases 4 and 5 can ship in parallel with each
other once Phase 3 is in. Phase 7's three jobs can ship one at a
time; they don't block each other.

A small team could ship the v1 (stable-style + Spotify export) in
~5 weeks if Phase 0 is done first and Phases 1, 2, 3 are taken in
parallel by 3 developers.

---

## 6. Files this feature creates or substantially edits

By package, for context.

```
packages/db/
  drizzle/00XX_setlist_intel_foundation.sql       NEW
  drizzle/00XX_user_spotify_tokens.sql            NEW
  drizzle/00XX_setlist_predict_columns.sql        NEW
  drizzle/00XX_song_gap_columns.sql               NEW
  drizzle/00XX_show_vibe_view.sql                 NEW
  schema/songs.ts                                 NEW
  schema/tour_setlists.ts                         NEW
  schema/setlist_song_appearances.ts              NEW
  schema/user_spotify_tokens.ts                   NEW
  schema/prediction_eval_runs.ts                  NEW
  schema/special_event_rules.ts                   NEW
  schema/index.ts                                 EDIT
  schema/performers.ts                            EDIT (setlist_style cols)
  schema/shows.ts                                 EDIT (spotify_playlist_url cols, prep/post counts)

packages/api/src/
  setlist-predict.ts                              NEW
  setlist-predict-rotating.ts                     NEW
  setlist-predict-theatrical.ts                   NEW
  setlist-predict-improvised.ts                   NEW
  setlist-style.ts                                NEW
  multi-night-run-detector.ts                     NEW
  song-index.ts                                   NEW
  spotify-tokens.ts                               NEW
  spotify-catalog.ts                              NEW (audio features, top tracks, etc.)
  acousticbrainz.ts                               NEW (fallback)
  playlist-cover.ts                               NEW (Satori → JPEG)
  crypto.ts                                       NEW (AES-256-GCM)
  setlistfm.ts                                    EDIT (add fetchArtistSetlists)
  spotify.ts                                      EDIT (add scope set + refresh)
  routers/setlist-intel.ts                        NEW
  routers/spotify.ts                              NEW
  routers/spotify-import.ts                       EDIT (use persistent token)
  __tests__/                                      MANY NEW

packages/jobs/src/
  setlist-corpus-fill.ts                          NEW
  song-index-rebuild.ts                           NEW
  setlist-style-refresh.ts                        NEW
  spotify-track-resolve.ts                        NEW
  spotify-audio-features.ts                       NEW
  spotify-library-sync.ts                         NEW
  spotify-recently-played.ts                      NEW
  year-end-soundtrack.ts                          NEW
  prediction-eval.ts                              NEW
  registry.ts                                     EDIT (register all new jobs)

apps/web/
  app/(app)/shows/[id]/predicted/                 NEW (route + components)
  app/(app)/shows/[id]/page.tsx                   EDIT (add segment switcher)
  app/(app)/songs/page.tsx                        NEW
  app/(app)/songs/[id]/page.tsx                   NEW
  app/(app)/admin/eval/page.tsx                   NEW
  app/api/spotify/callback/route.ts               EDIT (persist instead of postMessage)
  components/spotify/SpotifyConnectModal.tsx      NEW
  components/spotify/useSpotifyConnection.ts      NEW
  components/predicted-setlist/                   NEW (all 14 components)
  components/preferences/SpotifyImportModal.tsx   EDIT (drop one-shot accessToken arg)
  components/preferences/useSpotifyImport.ts      EDIT (use persistent token)

apps/mobile/
  app/song/[id].tsx                               NEW
  app/songs/index.tsx                             NEW
  app/show/[id].tsx                               EDIT (segment switcher)
  components/SpotifyConnectSheet.tsx              NEW
  components/PredictionHero.tsx                   NEW
  components/PredictionSongRow.tsx                NEW
  ... (every component from UI spec §2)           NEW
  lib/cache/outbox.ts                             EDIT (new mutation kinds)
  lib/spotify-connection.ts                       NEW

packages/emails/src/
  YearEndSoundtrack.tsx                           NEW

scripts/
  backfill-song-index.ts                          NEW
  eval-setlist-predictor.ts                       NEW
```

---

## 7. Observability events

New `<component>.<action>.<outcome>` events the implementation must
emit (extend the curated list in repo-root `CLAUDE.md`):

- `setlistfm.artist_setlists.fetched`
- `setlist.corpus_fill.{started,complete,failed}`
- `setlist.song_index.{built,partial,failed}`
- `setlist.predict.served` (with payload: confidence, style, sample_size)
- `setlist.predict.cache_hit` / `cache_miss`
- `setlist.style.classified`
- `setlist.eval.run_complete`
- `spotify.connect.{started,success,failed,revoked}`
- `spotify.token.{refreshed,refresh_failed}`
- `spotify.export_playlist.{success,partial,failed}`
- `spotify.audio_features.{ok,unavailable,deprecated}`
- `spotify.library_sync.{ok,partial,rate_limited}`
- `spotify.recently_played.{ok,no_data}`
- `year_end_soundtrack.{built,delivered,failed}`

---

## 8. Tests + release gate

Per the existing `pnpm verify:coverage` 80% gate (web + mobile
scopes independent).

Unit (per package):
- Encryption round-trip; refresh logic; revoked-handling
- Each prediction model (stable, rotating, theatrical, improvised)
  with synthetic corpora
- Style classifier with seeded corpora at each style boundary
- Setlist.fm client `fetchArtistSetlists` paging
- Token helper edge cases (expired, refresh-failed, 401-on-use)
- Bayesian smoothing math
- Multi-night-run detector

Integration:
- Connect → persist → predict → export round-trip
- The eval cron against a seeded historical corpus
- Disconnect → revoked_at flips; subsequent predict still works,
  but Spotify-derived rails disappear

E2E (Playwright):
- Connect modal → OAuth (mock) → predicted-setlist tab loads
- "Hype playlist" first tap on a fresh account opens connect
- Subsequent tap goes straight to playlist creation
- Disconnect from Preferences → re-tap Hype playlist re-prompts

E2E (Maestro, Android):
- predicted-setlist flow per Phase 10
- spotify-export flow

Release gate (additive to existing CI):
- Eval Brier ≤ 0.15 stable; precision-at-10 ≥ 0.4 rotating
- No flake-rate regression on the connect-modal E2E

---

## 9. Risks worth restating

| Risk | Mitigation |
|------|-----------|
| Spotify revokes the API access between phases | Probe at start of Phase 0; AcousticBrainz fallback for vibe features only; rest of feature is unaffected |
| TOKEN_KEY rotation strategy unclear | Generate once per environment with `openssl rand -hex 32`; don't rotate unless a leak is suspected, in which case every user reconnects on next Spotify action (no batch re-encrypt). See §11 Q2. |
| Persisted token leaks via logging | Pino redaction already covers `accessToken`/`refreshToken`; add tests that `JSON.stringify(row)` masks the encrypted columns; never log raw token in any path |
| OAuth popup blocked by browser | Detect `popupRef === null` and surface a "Allow popups for showbook.app and try again" toast |
| Spotify rate limits during a heavy backfill | Concurrency 1 per token, 200ms minimum interval (mirror Gmail client); `spotify-track-resolve` job is the heaviest — cap to 100 tracks/run |
| Migrating existing artist-import users | Existing one-shot users will hit the connect modal once on their next Spotify action; persisted from then on. No data migration needed (the existing flow doesn't store anything to migrate). |

---

## 10. The §13 features mapped to phases

| Capability (from music-layer doc) | Ships in |
|-----------------------------------|----------|
| #1 Hype playlist | Phase 3 |
| #2 What-I-heard playlist | Phase 3 |
| #3 Vibe radar | Phase 8 (gated) |
| #4 Energy arc | Phase 8 (gated) |
| #5 Set length | Phase 8 |
| #6 Discovered-live + fan-loyalty ring | Phase 7 |
| #7 Pre-show priming stat | Phase 7 |
| #8 Year-end soundtrack | Phase 7 |
| #9 Spotify-follow rail | Phase 9 |
| #10 30-second previews + Web Playback | Phase 9 |

The "v1 / v2" split from the music-layer doc collapses with the
connect-once decision — there's no architectural difference between
the playlist-export features and the library-sync features anymore.
They all hit the same `ensureFreshUserToken` helper. The only
remaining grouping reason is order-of-implementation.

---

## 11. Open questions

These are the actual blocking decisions where reasonable defaults
exist but I want to flag before we start.

### Q1. Audio-features API access (gates Phase 8)

We don't know whether Spotify grandfathered our app's access to the
deprecated audio-features endpoint. **Action:** Phase 0 ends with a
probe call that writes the answer to a config flag. If access is
denied, Phase 8 ships with AcousticBrainz fallback only; the feature
flag drives the UI's "we couldn't compute a vibe for this show" empty
state on tracks newer than 2022.

**Default if not answered:** ship Phase 8 with the AcousticBrainz
fallback; don't request the upgrade from Spotify.

### Q2. TOKEN_KEY rotation

How often do we rotate the AES key? **Resolved: don't, for v1.**
Rotating the key invalidates every persisted `user_spotify_tokens`
row (decrypt fails → `ensureFreshUserToken` returns null → every
connected user is re-prompted on their next Spotify action). For a
self-hosted single-tenant app with a static `.env.prod`, the
operational tax of regular rotation isn't worth the marginal
defense.

**Decision:** generate `TOKEN_KEY` once per environment with
`openssl rand -hex 32`, commit it to `.env.prod`, and forget about
it unless a leak is suspected. If a leak is suspected, the runbook
is "generate a new key, paste it into `.env.prod`, redeploy" —
every user reconnects Spotify once, no batch re-encrypt job needed.
`scripts/rotate-token-key.ts` is dropped from the plan.

**What's still required:** document this stance in `.env.example`
so an operator who rotates the key understands they're about to
log out every Spotify connection.

### Q3. Style classifier seed list

Phish, Pearl Jam, Springsteen, Dead & Co, Goose, Umphrey's, Bruce
Springsteen, Wilco, Sons of Kemet, King Gizzard — these are *known*
to be rotating- or improvised-style. Auto-classification works once
corpus accrues, but a fresh user following any of them gets a
mis-classified prediction for the first 24 hours. **Action:** ship a
short curated seed list (~30 artists by MBID) in
`packages/api/src/setlist-style-seeds.ts`. Auto-classifier runs as
usual; seed entries get applied at first observation and aren't
overridden until the auto-classifier disagrees three runs in a row.

**Default if not answered:** seed list ships with ~30 well-known
acts the developer enumerates personally.

### Q4. Festival shows — predict per-headliner?

A festival has multiple performers. Each plays a 60–90 minute set.
Do we render a single predicted setlist per performer (one tab per),
or a unified "festival vibe" prediction? **Action:** Phase 5 ships
per-headliner prediction (each headliner gets a sub-section in the
predicted-setlist tab). **Default:** one prediction per headliner;
the show detail's setlist already per-performers.

### Q5. Spoiler-blur default

Stable-style and theatrical-style ship with `spoilerBlurDefault: true`.
But: many users explicitly *want* the prediction. **Action:** add a
top-level Preferences toggle `setlist_spoilers: 'always_blur' |
'never_blur' | 'style_default'` with `style_default` as the system
default. The first time the curtain appears, a small "always show
me predictions" CTA below the reveal button changes the preference
in one tap. **Default:** `style_default`.

### Q6. `shows.spotify_playlist_url` lifecycle

If the user creates a hype playlist for a show, then later edits the
predicted setlist (via the "Edit" CTA), does the playlist auto-
update? **Action:** no. The playlist URL is one-shot — re-tapping
the button overwrites the playlist (same URL). Editing the
prediction in Showbook doesn't trigger a write to the user's Spotify
library without an explicit re-tap. **Default:** stale-by-design;
re-tap to refresh.

### Q7. Calibration release gate timing

§15q says "block release if Brier > 0.15." But we can't measure
Brier until we have a month of predictions. Chicken-and-egg.
**Action:** ship Phase 1 (predicted setlist) without the gate, run
the eval cron in shadow mode (no UI surface) for 30 days, then
enable the gate retroactively in Phase 4. **Default:** shadow mode
through Phase 4; gate enforces from Phase 5 onward.

### Q8. Setlist.fm rate-limit upgrade request

Default tier is 1440/day. Phase 5's nightly style-refresh job + the
ongoing corpus-fill could push us close. **Action:** monitor in
Phase 0/1; request the free upgrade if we cross 1000/day for three
consecutive days. **Default:** request upgrade preemptively at the
start of Phase 5 (don't wait for the squeeze).

### Q9. Personal-weight chips — universal or opt-in?

The chips (`💛 saved`, `🎯 first time`, `⭐ top track`) require
`user-library-read` and `user-top-read` scopes. Both are in the
upfront scope set, so technically every user with Spotify connected
gets them. But: some users may not want their library mixed into
every prediction. **Action:** show by default. Add an "off"
toggle in Preferences. **Default:** on for connected users; users
who feel pestered turn off.

### Q10. Disconnect — what gets purged?

Today's `disconnectSpotify` clears: fan-loyalty %, priming counts,
playlist URLs (the URLs themselves on Spotify are private to the
user — disconnecting just unlinks them from Showbook). **Action:**
purge user-personal columns on `shows` and `users` (playlist URLs,
prep/post counts, year-playlists map); `songs.spotify_track_id`
remains (catalog data, shared across users); `tour_setlists`
remain. **Default:** purge user-personal data only; keep the
catalog data that's not user-derived.

There is no `user_spotify_saved_tracks` table to purge — the v1
plan's nightly library cache was dropped in favor of on-demand
`/me/tracks/contains` calls (see §13c + Phase 7). One less table
to purge, one less privacy surface to defend.

---

## 12. What "done" looks like

When all 11 phases are merged, a user opens Showbook and:

1. Clicks a watching show's "Hype playlist" button.
2. Sees the connect modal once. Taps connect. OAuth. Done.
3. Spotify gets a new playlist with a branded cover.
4. They never see the connect modal again.
5. The next show they go to has a vibe radar, an energy arc, a fan-
   loyalty ring, a priming stat, and a "songs you discovered live"
   rail without any further interaction.
6. On Dec 31, an email arrives with their year as a Spotify
   playlist.
7. On the Discover page, a rail shows artists they follow on
   Spotify but not on Showbook — one tap each.
8. The Brain can answer "what was my smallest, saddest, most
   acoustic show" using the data the music layer surfaced.
9. They can disconnect Spotify any time from Preferences; the
   feature gracefully reduces to its non-Spotify shape.