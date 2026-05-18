# Phase 0 — Foundation

> **Goal.** Unblock everything below. Schema for the prediction
> corpus + the song index + persistent Spotify tokens. Connect-
> modal UX shipped end-to-end with no user-visible prediction
> features yet.

| Estimated effort | ~1 week |
| Critical path? | Yes — every other phase depends on this |
| Prerequisites | None |
| Ships | No user-facing prediction features. Existing artist-import flow gains persistent tokens (users stop being re-prompted on subsequent imports). |

References: [`../implementation.md`](../implementation.md) §3, §4
"Phase 0", §11 (open questions).

---

## Schema migrations

One `0NNN_setlist_intel_foundation.sql` migration with all of:

```sql
-- Corpus of setlists (other shows, fetched from setlist.fm)
CREATE TABLE tour_setlists (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  performer_id      uuid NOT NULL REFERENCES performers(id) ON DELETE CASCADE,
  tour_id           text,
  tour_name         text,
  tour_leg          text,
  performance_date  date NOT NULL,
  venue_name_raw    text,
  city              text,
  country_code      text,
  setlistfm_id      text NOT NULL,
  setlist           jsonb NOT NULL,
  song_count        smallint NOT NULL,
  fetched_at        timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tour_setlists_setlistfm_unique
  ON tour_setlists (setlistfm_id);
CREATE INDEX tour_setlists_performer_date_idx
  ON tour_setlists (performer_id, performance_date DESC);
CREATE INDEX tour_setlists_performer_tour_idx
  ON tour_setlists (performer_id, tour_id, performance_date DESC);

-- First-class song entity
CREATE TABLE songs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  performer_id             uuid NOT NULL REFERENCES performers(id) ON DELETE CASCADE,
  title                    text NOT NULL,
  is_cover                 boolean NOT NULL DEFAULT false,
  cover_of                 text,
  spotify_track_id         text,
  duration_ms              integer,
  first_known_performance  date,
  -- §15c gap-based prediction columns:
  historical_play_count    integer NOT NULL DEFAULT 0,
  historical_mean_gap      real,
  last_played_date         date,
  current_gap_shows        integer,
  created_at               timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX songs_performer_title_idx
  ON songs (performer_id, LOWER(title));
CREATE INDEX songs_spotify_idx
  ON songs (spotify_track_id) WHERE spotify_track_id IS NOT NULL;
CREATE INDEX songs_overdue_idx
  ON songs (performer_id, current_gap_shows DESC)
  WHERE historical_play_count >= 3;

-- Denormalized index for stats + prediction
CREATE TABLE setlist_song_appearances (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id           uuid NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  performer_id      uuid NOT NULL REFERENCES performers(id) ON DELETE CASCADE,
  performance_date  date NOT NULL,
  show_id           uuid REFERENCES shows(id) ON DELETE CASCADE,
  tour_setlist_id   uuid REFERENCES tour_setlists(id) ON DELETE CASCADE,
  section_index     smallint NOT NULL,
  song_index        smallint NOT NULL,
  is_encore         boolean NOT NULL DEFAULT false,
  role              text NOT NULL DEFAULT 'core',
  tour_id           text,
  tour_name         text
);
CREATE INDEX appearances_song_date_idx
  ON setlist_song_appearances (song_id, performance_date DESC);
CREATE INDEX appearances_performer_date_idx
  ON setlist_song_appearances (performer_id, performance_date DESC);
CREATE INDEX appearances_show_idx
  ON setlist_song_appearances (show_id) WHERE show_id IS NOT NULL;
CREATE INDEX appearances_performer_tour_date_idx
  ON setlist_song_appearances (performer_id, tour_id, performance_date DESC);

-- Materialized view for per-user "songs heard most" stats
CREATE MATERIALIZED VIEW user_song_stats AS
  SELECT
    s.user_id,
    a.song_id,
    a.performer_id,
    COUNT(*) AS times_heard,
    MIN(a.performance_date) AS first_heard,
    MAX(a.performance_date) AS last_heard
  FROM setlist_song_appearances a
  JOIN shows s ON s.id = a.show_id
  GROUP BY s.user_id, a.song_id, a.performer_id;
CREATE UNIQUE INDEX user_song_stats_pk
  ON user_song_stats (user_id, song_id, performer_id);
CREATE INDEX user_song_stats_user_count_idx
  ON user_song_stats (user_id, times_heard DESC);

-- Performer-level setlist style (fills in Phase 5)
ALTER TABLE performers
  ADD COLUMN setlist_style text,
  ADD COLUMN setlist_style_inferred_at timestamp;

-- Cache for predictSetlist outputs
CREATE TABLE prediction_cache (
  performer_id          uuid NOT NULL REFERENCES performers(id) ON DELETE CASCADE,
  target_date           date NOT NULL,
  corpus_signature      text NOT NULL,    -- max(fetched_at) of underlying corpus
  prediction_json       jsonb NOT NULL,
  computed_at           timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (performer_id, target_date)
);
```

A separate migration `0NNN_user_spotify_tokens.sql`:

```sql
CREATE TABLE user_spotify_tokens (
  user_id            text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  access_token_enc   text NOT NULL,
  refresh_token_enc  text NOT NULL,
  scope              text NOT NULL,
  expires_at         timestamp NOT NULL,
  spotify_user_id    text NOT NULL,
  display_name       text,
  product            text,
  last_used_at       timestamp,
  last_refreshed_at  timestamp,
  revoked_at         timestamp,
  revoked_reason     text,
  created_at         timestamp NOT NULL DEFAULT now(),
  updated_at         timestamp NOT NULL DEFAULT now()
);
```

Schema files in `packages/db/schema/` for each new table; export
from `index.ts`.

---

## Code

### `packages/api/src/crypto.ts` (new)

AES-256-GCM helpers:

```ts
export function encrypt(plaintext: string): string;   // returns iv:tag:ciphertext base64
export function decrypt(encrypted: string): string;
```

Key source: `process.env.TOKEN_KEY` — 32 bytes hex-decoded. Fail
fast in `loadConfig()` if not set in non-test environments.

### `packages/api/src/spotify-tokens.ts` (new)

```ts
export async function ensureFreshUserToken(userId: string): Promise<string | null>;
export async function isSpotifyConnected(userId: string): Promise<boolean>;
export async function disconnectSpotify(userId: string, reason: string): Promise<void>;
```

`ensureFreshUserToken` is the **only** way other code touches a user
Spotify token. Auto-refreshes when within 60s of expiry. Sets
`revoked_at` and returns `null` on Spotify 401.

### `packages/api/src/setlistfm.ts` (edit)

Add `fetchArtistSetlists(artistMbid, opts)` for paginated
`/artist/{mbid}/setlists`. Up to N pages (caller decides), 20
setlists per page, newest first. Reuses existing 500ms rate
limiter + 429 retry path.

### `packages/api/src/spotify.ts` (edit)

Extend the OAuth scope set to the eight scopes from
[`../implementation.md`](../implementation.md) §2.

### `packages/api/src/routers/spotify.ts` (new)

```ts
spotify.connectionStatus    // -> { connected: boolean, displayName?, product? }
spotify.persistToken        // -> called by callback
spotify.disconnect          // -> revokes + purges Spotify-derived stats
```

### `apps/web/app/api/spotify/callback/route.ts` (edit)

Was: returns the access token to the client via `postMessage`.
Becomes: exchanges code → persists encrypted token row →
`postMessage({ type: 'spotify-connected' })` (no token).

### `apps/web/components/spotify/SpotifyConnectModal.tsx` (new)

Universal connect modal — one button "Connect Spotify". Tied to the
existing one-shot OAuth popup pattern but the success path now
persists server-side instead of returning a token to the client.

### `apps/web/components/spotify/useSpotifyConnection.ts` (new)

```ts
function useSpotifyConnection(): {
  status: { connected: boolean };
  requireConnection: (action: () => void | Promise<void>) => Promise<void>;
  modalOpen: boolean;
  ...
};
```

Pattern: every Spotify-using surface wraps its action in
`await requireConnection(() => doTheThing())`.

### `apps/mobile/components/SpotifyConnectSheet.tsx` (new)

Mobile mirror using the existing `Sheet` primitive. Same
behavior. Pulls connection status via `useCachedQuery` so the
phone shows the right state offline.

### `apps/mobile/lib/spotify-connection.ts` (new)

Mobile mirror of the web `useSpotifyConnection` hook.

### Migration of existing artist-import

- `apps/web/components/preferences/useSpotifyImport.ts` — drop the
  `accessToken` argument from `listFollowed` / `importSelected`
  mutations. The server resolves the token via
  `ensureFreshUserToken(ctx.session.user.id)`.
- `packages/api/src/routers/spotify-import.ts` — same change on
  the server side.

Existing one-shot users hit the connect modal exactly once on their
next Spotify action. From then on, persisted.

---

## Tests

### Unit

- `packages/api/src/__tests__/crypto.test.ts` — encrypt → decrypt
  round-trip; rejects malformed input; key length validation
- `packages/api/src/__tests__/spotify-tokens.test.ts` — mocked DB:
  fresh-token path, near-expiry refresh path, expired-revoked path,
  401-on-use path
- `packages/api/src/__tests__/setlistfm-artist-setlists.test.ts` —
  paginated fetch happy path, page-cap, 429 retry, 404 graceful

### Integration

- `packages/api/src/__tests__/spotify-connect-flow.integration.test.ts`
  — exchange → persist → fetch with `ensureFreshUserToken` →
  refresh round-trip with the test DB

### E2E (Playwright)

- `apps/web/tests/spotify-connect.spec.ts` — first-time connect
  modal flow with a mocked OAuth callback; assert the modal closes
  and the original action fires

---

## Observability events

Add to the curated list in repo-root `CLAUDE.md`:

- `spotify.connect.{started,success,failed,revoked}`
- `spotify.token.{refreshed,refresh_failed}`
- `setlistfm.artist_setlists.fetched`

---

## Exit criteria

1. Existing artist-import works end-to-end with persistent tokens.
2. The audio-features probe has been run by the operator against
   their own connected Spotify account, and the in-code feature
   flag `SpotifyAudioFeaturesAvailable` (in
   `packages/shared/src/feature-flags.ts`) reflects the result.
   Phase 8 reads `isFeatureOn('SpotifyAudioFeaturesAvailable')`
   at job start to decide whether to ship natively or get dropped
   from v1 (SI-16). See the "Audio-features probe" section below
   for the runbook.
3. `pnpm verify:e2e` includes the connect-modal Playwright spec
   and it passes.
4. The Phase 0 migration runs cleanly on a freshly-created DB and
   on a copy of prod data.

(Earlier drafts of this list included two items now dropped:
(a) a scaffolding "echo my Spotify name" admin tRPC procedure —
the audio-features probe script in #2 already exercises the
same chain end-to-end (decrypt token → live Spotify call → print
result), so a separate procedure was redundant; and (b) a manual
mobile smoke test (SI-08) on iOS Simulator + Android emulator —
**dropped** because Phase 0's mobile work is infrastructure only:
the `SpotifyConnectSheet` primitive + `useSpotifyConnection` hook
ship in this PR, but no mobile UX in this phase actually mounts
them. The Me-tab integrations list (Gmail / Ticketmaster /
Google Places) doesn't include Spotify, and there's no
Phase 0 mobile entry point that calls `requireConnection`. The
first mobile UX that exercises this infrastructure is the Hype
playlist button on Show detail, which lands in Phase 10. SI-08
gets validated there instead — see
[`../plan-review.md`](../plan-review.md) SI-08.)

### Audio-features probe (runbook) — **RESOLVED 2026-05-17: 403, Phase 8 deferred to v2**

The probe ran on prod on 2026-05-17 against the operator user and
returned **HTTP 403**. Spotify did not grandfather our app
registration. Per SI-16, Phase 8 (vibe radar + energy arc) is
**deferred to v2**; AcousticBrainz fallback was rejected. The
`SpotifyAudioFeaturesAvailable` feature flag stays at `'OFF'`. A
future operator can re-probe and flip the flag via PR if Spotify
changes their policy or a third-party data source emerges.

Original runbook content preserved below for v2 re-probe.

---

The setlist-intel spec includes a Phase 8 feature (vibe radar +
energy arc) that depends on Spotify's `audio-features` endpoint,
which Spotify deprecated for new applications in late 2024.
Showbook's app registration may or may not have been
grandfathered. Per SI-16, Phase 8 is **hard-gated** on the result.

The probe needs a real connected Spotify token, so it can't run
at deploy time. The operator runs it once after their own Spotify
connects:

```bash
# After connecting Spotify in Preferences for an admin account:
pnpm --filter @showbook/api probe-audio-features <userId>
```

Pass the Showbook user id (look up via
`SELECT id FROM users WHERE email = '<your email>';`). The script
hits `GET /v1/audio-features/3n3Ppam7vgaVa1iaRUc9Lp`
("Mr. Brightside" — a stable, well-known track) and reports
either:

- **200 OK** → access intact. Open a PR flipping the in-code
  flag `SpotifyAudioFeaturesAvailable` from `'OFF'` to `'ON'` in
  `packages/shared/src/feature-flags.ts`. Phase 8 will ship as
  designed once that PR merges.
- **403 Forbidden** → access denied. Leave the flag at its
  default `'OFF'`. Phase 8 will be dropped from v1; revisit in
  v2 only when a viable third-party data source is identified.
- **Other status** → transient; re-run.

The flag lives in code rather than env / config because Showbook's
convention is "feature decisions change by PR" — see the header
comment in `feature-flags.ts`.

### Disconnect cleanup registry (SI-09)

Ships in Phase 0 alongside `disconnectSpotify`:
`packages/api/src/spotify-disconnect-registry.ts` declares four
arrays (`USER_SCOPED_PURGE_COLUMNS`, `USER_SCOPED_PURGE_TABLES`,
`CATALOG_KEEP_COLUMNS`, `USER_SCOPED_AUDIT`) that future phases
populate as they add Spotify-derived columns. A build-failing
test (`spotify-disconnect-registry.test.ts`) introspects the
schema, finds anything Spotify-shaped, and asserts each appears
in exactly one of the four arrays — anything missing fails the
build in the PR that adds it, forcing an explicit "purge or
keep?" categorization decision.

Phase 0's arrays are empty except for the seed entries: the
`user_spotify_tokens` table is in `USER_SCOPED_AUDIT` (handled
directly by `disconnectSpotify` via `revoked_at`), and
`songs.spotify_track_id` is in `CATALOG_KEEP_COLUMNS` (Phase 0
shipped the column ahead of the Phase 3 resolver job). Phases 3,
7, 8, 9, 11 each add entries as their columns land.

---

## Risks specific to this phase

- **TOKEN_KEY rotation** — set up the env var per-environment.
  Document the runbook to rotate via re-encryption (a
  `scripts/rotate-token-key.ts` is a follow-up; not required to
  ship Phase 0).
- **Existing one-shot artist-import users get the connect modal
  once.** This is intended but should be communicated in release
  notes or via a banner on the Discover page.
- **The `tour_id` is synthesized from `(performerId, lower(tour.name))`.**
  Cross-year collisions for an artist who reuses a tour name —
  see [`../implementation.md`](../implementation.md) §11 Q3 for the
  salt-with-year mitigation; ship without if dev-friendly default
  works.

---

## What this phase does NOT include

- The actual prediction algorithm (Phase 1)
- The corpus-fill job (Phase 1)
- Hype playlist or post-show export (Phase 3)
- Style classifier (Phase 5)
- Anything UI beyond the connect modal

The audio-features API probe (open question Q1) lives at the **end**
of Phase 0 — one call, write the result to a config flag, gate
Phase 8 on it. **Probe ran 2026-05-17 → 403; Phase 8 deferred to
v2.** See implementation.md §11 Q1.
