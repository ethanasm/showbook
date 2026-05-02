# Feature plan — Sports as a first-class kind

**Goal:** Make sports a real, fully-supported `kind` everywhere in the
app — Add flow, Shows list, Show detail, Discover follow flow, Map,
Artists/Venues, ingestion, digests — with sports-specific metadata
(teams, scores, MVP, attendance) that earns its own display.

**The actual state today (the user is right):** `sports` is in the
`kind` pgEnum (`packages/db/schema/shows.ts:24`), the TM normalizer
returns `'sports'` when the segment matches
(`packages/api/src/ticketmaster.ts:316`), the icon lookup includes a
trophy (`apps/web/lib/kind-icons.ts:21`), and the Discover page
filters with a `'sports'` chip
(`apps/web/app/(app)/discover/View.client.tsx:31`). That's it. **You
cannot create a sports `Show`.** The Add flow type-narrows kind to
`concert | theatre | comedy | festival` and the Shows list filters
the same way. Following a sports announcement promotes it to a
`watching` show with `kind='sports'`, which then cannot be edited
without throwing in the form. Past attendance is impossible.

This plan closes those gaps and adds the data model that makes sports
worth tracking — teams, scores, attendance — without bolting them
onto `Performer` (which is wrong: the Yankees are not a "performer"
in the same shape as Phoebe Bridgers).

Status: not started. Pre-existing partial work listed above.

---

## 1. Audit of every place the `kind` enum is read

Concrete list of "the codepaths that pretend sports doesn't exist."
This is the work surface.

| Area | File(s) | Today | After |
|------|---------|-------|-------|
| Add flow — kind picker | `apps/web/app/(app)/add/page.tsx` | Hard-coded 4 kinds | 5 kinds with sports-specific subform |
| Add flow — performer/team UI | same | "Headliner / Support / Cast" | Adds "Home / Away" team selector |
| Shows list — kind filter chips | `apps/web/app/(app)/shows/page.tsx` | 4 chips | 5 chips |
| Shows list — row card | `apps/web/components/show-row.tsx` (or similar) | 4-icon switch | 5-icon + score chip |
| Show detail — hero & sections | `apps/web/app/(app)/shows/[id]/page.tsx` | Branches by kind, no sports branch | Scoreboard hero, "your fan record" stat, attendance card |
| Show detail — performer rendering | same | Renders `show_performers` | Falls back to `show_teams` rendering for sports |
| Show detail — setlist tab | same | Concert/comedy only | Hide entirely for sports; replace with box-score tab |
| Discover — follow team | `apps/web/app/(app)/discover/View.client.tsx` | "Follow venue / artist" | Adds "Follow team" |
| Artists page | `apps/web/app/(app)/artists/...` | Performers only | Either keep separate or merge with new Teams page |
| Venues page | `apps/web/app/(app)/venues/...` | Hides nothing | Adds league badge for sports-primary venues |
| Map page | `apps/web/app/(app)/map/...` | All venues | Optional sports-only filter |
| Stats / Home | `apps/web/app/(app)/home/...` | Concert-centric | Adds "fan W-L record" tile when user has sports shows |
| Daily digest | `packages/jobs/src/notifications.ts` + `packages/emails/src/DailyDigest.tsx` | Concert-centric | Sports treatment for upcoming games |
| TM ingestion → announcements | `packages/jobs/src/discover-ingest.ts` | Already returns `'sports'` | Now also extracts team metadata into `announcement.teams` |
| Show creation — `shows.create` | `packages/api/src/routers/shows.ts` | Builds `show_performers` | Branch on kind: sports → `show_teams` |
| `KIND_ICONS`/`KIND_LABELS` consolidation | `apps/web/lib/kind-icons.ts` | DiscoverKindKey workaround | Single shared kind type that always includes sports |
| Mobile: kind chips, Show detail | `apps/mobile/...` | M2 in flight | Same five-kind treatment; M2.B/C should be sports-aware from the start |

The `KIND_ICONS` consolidation already on the `Planned Improvements`
list resolves the type-fork between web's `ShowKind` and Discover's
`DiscoverKind` — do that *first* so we're not patching the same enum
in 9 places.

---

## 2. New schema

### 2a. `Team` entity

Parallel to `Performer`. Not merged into it: a team has a roster, a
home venue, league/division — all of which would dilute the
performer concept. Sharing is fine when shapes match; this one
doesn't.

```sql
CREATE TYPE "league" AS ENUM (
  'nba','wnba','nfl','mlb','nhl','mls','epl','laliga','bundesliga',
  'seriea','ligue1','ucl','f1','indycar','nascar','ufc','wwe','aew',
  'pga','atp','wta','ncaaf','ncaab','other'
);

CREATE TABLE "teams" (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league                   league NOT NULL,
  name                     text NOT NULL,        -- "New York Knicks"
  short_name               text,                 -- "Knicks"
  city                     text,                 -- "New York"
  country_code             text NOT NULL DEFAULT 'US',
  abbreviation             text,                 -- "NYK"
  primary_color            text,                 -- "#006BB6"
  secondary_color          text,                 -- "#F58426"
  logo_url                 text,
  home_venue_id            uuid REFERENCES venues(id),
  ticketmaster_attraction_id text,
  espn_team_id             text,
  thesportsdb_team_id      text,
  wikidata_id              text,
  created_at               timestamp NOT NULL DEFAULT now(),
  updated_at               timestamp NOT NULL DEFAULT now()
);

CREATE INDEX teams_league_idx ON teams (league);
CREATE INDEX teams_lower_name_idx ON teams (LOWER(name));
CREATE UNIQUE INDEX teams_tm_attraction_unique_idx
  ON teams (ticketmaster_attraction_id) WHERE ticketmaster_attraction_id IS NOT NULL;
CREATE UNIQUE INDEX teams_espn_team_unique_idx
  ON teams (espn_team_id) WHERE espn_team_id IS NOT NULL;
```

### 2b. `show_teams` join

Mirrors `show_performers` shape — keep a parallel join rather than
overloading `show_performers`. The role is `home | away | neutral`
and the `score` lives here, not on `shows`, so a future neutral-site
playoff renders cleanly without a "home" bias.

```sql
CREATE TYPE "team_role" AS ENUM ('home','away','neutral');

CREATE TABLE "show_teams" (
  show_id    uuid NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  team_id    uuid NOT NULL REFERENCES teams(id),
  role       team_role NOT NULL,
  score      integer,            -- final; null pre-game
  PRIMARY KEY (show_id, team_id, role)
);

CREATE INDEX show_teams_team_idx ON show_teams (team_id);
```

### 2c. Sports-specific fields on `shows`

```sql
ALTER TABLE shows
  ADD COLUMN sports_status      text,        -- 'final','postponed','cancelled','live'
  ADD COLUMN sports_summary     jsonb,       -- ordered period scores: { periods: [...], overtime: bool }
  ADD COLUMN sports_attendance  integer,     -- official; nullable
  ADD COLUMN sports_mvp         text,        -- free-form for now; later FK to a `players` table if it earns one
  ADD COLUMN weather_snapshot   jsonb;       -- only for outdoor games / festivals
```

`sports_summary` shape:

```jsonc
{
  "periods": [
    { "label": "Q1", "home": 28, "away": 24 },
    { "label": "Q2", "home": 26, "away": 30 },
    { "label": "Q3", "home": 22, "away": 25 },
    { "label": "Q4", "home": 31, "away": 27 }
  ],
  "overtime": false,
  "scorers": [                    // optional
    { "team": "home", "player": "Brunson", "value": 38, "label": "PTS" }
  ]
}
```

Period labels vary by league (Q1–Q4 for NBA/NFL, P1–P3 for NHL,
"1st"–"9th" for MLB innings, "1st half / 2nd half" for soccer). The
shape is generic enough to cover all of them.

### 2d. `user_team_follows` join

Mirrors `user_venue_follows` and `user_performer_follows` — sports
follows are first-class, separate from artists. Discover queues a
team-ingest job on follow.

```sql
CREATE TABLE "user_team_follows" (
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id    uuid NOT NULL REFERENCES teams(id),
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, team_id)
);
```

### 2e. `announcements` extension

Today `announcements.headlinerString` + `headlinerPerformerId` carry
the marquee artist. For sports, the marquee is the *matchup*. Add:

```sql
ALTER TABLE announcements
  ADD COLUMN home_team_id uuid REFERENCES teams(id),
  ADD COLUMN away_team_id uuid REFERENCES teams(id);
```

The existing `kind` column already accepts `'sports'`. Discover-page
queries that filter by venue/region don't change shape; we just join
to `teams` when `kind='sports'`.

---

## 3. The "fix the wiring" pass

Concrete edits, in order. Each one is small; there are just a lot of
them.

### 3a. Kind type consolidation
- Move `ShowKind` and `DiscoverKindKey` out of `apps/web/lib/kind-icons.ts`
  into `packages/shared/src/types/kind.ts` as a single
  `Kind = 'concert' | 'theatre' | 'comedy' | 'festival' | 'sports'`.
- Re-export from `@showbook/shared`.
- Ban the local fork in Discover (`DiscoverKind = ShowKind | 'sports'`)
  — it only existed because Show wasn't sports-aware.
- Update the 9 redefinitions called out in `Planned Improvements.md`.

### 3b. Add flow — sports subform
- `apps/web/app/(app)/add/page.tsx` kind picker grows a 5th tile.
- When sports is selected:
  - Lineup section is replaced with a **two-team picker**:
    - Home team typeahead (team table search by lower-name).
    - Away team typeahead (same).
    - Optional "neutral site" toggle when neither is the venue's
      home team — both become `role='neutral'`.
  - "Setlist" / "Cast" sections are hidden.
  - "Score" subsection appears only when `state='past'`:
    - Home score (number input).
    - Away score (number input).
    - "Add period breakdown" disclosure → repeating Q1/Q2/... rows.
    - MVP (free-text).
    - Attendance (optional integer).
  - The "Playbill OCR" affordance is replaced with a "Score from
    photo" affordance: snap a scoreboard photo, vision LLM extracts
    final + period scores → fills the form. (Reuses the Groq vision
    pipeline.)

### 3c. `shows.create` / `shows.update`
- Add `teams` and `sportsResult` to the input zod schema; mutually
  exclusive with `performers` (server enforces: sports → no
  `show_performers`, others → no `show_teams`).
- Inside the existing transaction:
  - Insert `show_teams` rows (matched via `matchOrCreateTeam`).
  - Set `sports_status`, `sports_summary`, `sports_attendance`, `sports_mvp`.
- TM enrichment branches: if `kind='sports'`, instead of querying
  `attractions`, hydrate from ESPN scoreboard for that date+team.
  Fail gracefully (same as the existing TM enrichment failure path).

### 3d. Show detail page
- New top section above the photo gallery:

  ```
  ┌─────────────────────────────────────────────┐
  │   NYK   119  ─  112   BOS                   │
  │   28-26-22-31    Final / OT       Mar 23    │
  │   MVP: J. Brunson · 38 PTS                  │
  │   Attendance: 19,812 · Madison Sq Garden    │
  │   [your record at this matchup: 4–2]        │
  └─────────────────────────────────────────────┘
  ```

- "Your fan record" computed from `shows`+`show_teams` joined to the
  current user's history, scoped to the matchup teams.
- Setlist tab is hidden for sports; "Box score" tab takes its place
  if `sports_summary.scorers` is populated, otherwise the section
  collapses.
- Edit flow uses the sports subform from §3b.

### 3e. Shows list
- Add the 5th kind chip.
- Row renderer's "headliner" slot becomes "matchup" for sports
  rows: `NYK @ BOS` formatted from `show_teams`.
- Score badge on the right of the row: `W 119–112` (colored by
  whether the user's followed team won, if any).

### 3f. Discover — follow teams
- Today the Discover sidebar has Followed venues / Followed artists.
  Add **Followed teams** as a third rail, behind a kind-aware filter.
- "Follow team" affordance:
  - Search modal that hits a new tRPC procedure `teams.search` →
    matches `teams.name` and falls back to TM `searchAttractions`
    filtered by sports segment (already differentiated in
    `ticketmaster.ts:325`).
  - On follow: writes `user_team_follows` row + queues
    `discover/ingest-team` (new job, see §3h).
- Right-click unfollow on the team rail (matches existing pattern
  for venues/artists).

### 3g. Discover feed treatment
- A sports announcement row renders as `NYK vs BOS · Mar 23 · MSG`
  rather than `Tour Name · Headliner`.
- Watch / Got tickets / Ticketmaster context menu is unchanged
  (sports announcements already flow through the `announcements`
  table via TM ingest).

### 3h. Ingestion: new job `discover/ingest-team`
- Mirror of `discover/ingest-performer`. Inputs: `teamId` + recent
  date range.
- Source order:
  1. **TM** `events?attractionId=<team.ticketmaster_attraction_id>`.
     Fast path; works for any team that sells through TM.
  2. **ESPN scoreboard JSON** for the league + date range. Fills
     gaps (most NCAA, international leagues, secondary leagues).
     One canonical pattern:
     `https://site.api.espn.com/apis/site/v2/sports/<sport>/<league>/scoreboard?dates=YYYYMMDD`.
- Normalizer creates `announcements` rows with `home_team_id` /
  `away_team_id` populated, `headlinerString` set to "NYK vs BOS"
  for fallback display.

### 3i. Past-game enrichment
- New job `enrichment/sports-score-fill` (cron 04:30 ET, mirrors
  `enrichment/setlist-retry`):
  - Find `kind='sports'` shows where `state='past'`,
    `sports_status IS NULL OR sports_status='live'`, and `date >
    now() - 14 days`.
  - For each: ESPN box-score lookup by date + team; fill
    `sports_summary`, `sports_attendance`, `sports_status='final'`,
    optionally `sports_mvp` from "leaders" payload.
  - Same retry semantics as setlist-retry.

### 3j. Daily digest
- `packages/emails/src/DailyDigest.tsx` already has tour/headliner
  components. Add a "Tonight's game" block that renders matchup +
  venue + start time when the user has a watching/ticketed sports
  show with `date = today`.
- "Yesterday's result" block: if the user attended a game yesterday,
  render the score and a "tap for box score" CTA.

### 3k. Stats / Home
- New tile: **Fan record** — for each followed team, W/L when
  `state='past'` AND `show_teams.team_id = followedTeam`. Hidden
  when the user has no sports shows.
- Existing genre/artist stats tiles get a `WHERE kind != 'sports'`
  guard so they don't blend an apples-to-oranges count.

### 3l. Mobile (high-level — see §11 for full detail)
- The kind-icon consolidation (§3a) lives in `@showbook/shared`, so
  mobile picks it up automatically. `apps/mobile/lib/theme.ts`
  already imports `Kind` from `@showbook/shared` and the existing
  `KindBadge` / `ShowCard` already accept `'sports'`.
- The Add screen, Show detail, Discover, Map, and ThreePaneLayout
  all need sports-aware branches — see §11 for the per-screen plan.

---

## 4. Team matching

`matchOrCreateTeam` mirrors `matchOrCreateVenue` /
`matchOrCreatePerformer`:

```ts
// packages/api/src/team-matcher.ts
export async function matchOrCreateTeam(input: {
  name: string;
  league?: League;
  city?: string;
  ticketmasterAttractionId?: string;
  espnTeamId?: string;
}): Promise<{ id: string; created: boolean }> {
  return db.transaction(async (tx) => {
    // 1. By external IDs (unique partial indexes guarantee no race).
    if (input.ticketmasterAttractionId) {
      const hit = await tx.query.teams.findFirst({
        where: eq(teams.ticketmasterAttractionId, input.ticketmasterAttractionId),
      });
      if (hit) return { id: hit.id, created: false };
    }
    if (input.espnTeamId) { /* same */ }

    // 2. By lower(name) + league within an advisory lock.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'team:' + input.name.toLowerCase() + ':' + (input.league ?? '')}))`);
    const byName = await tx.query.teams.findFirst({
      where: and(
        sql`LOWER(${teams.name}) = LOWER(${input.name})`,
        input.league ? eq(teams.league, input.league) : undefined,
      ),
    });
    if (byName) {
      // Backfill external IDs if newly known.
      // ...
      return { id: byName.id, created: false };
    }

    // 3. Insert; catch 23505 to handle a concurrent winner.
    try {
      const [row] = await tx.insert(teams).values({ ... }).returning({ id: teams.id });
      return { id: row.id, created: true };
    } catch (e) {
      if (e.code === '23505') {
        const winner = await tx.query.teams.findFirst({ /* by external id or lower(name)+league */ });
        if (winner) return { id: winner.id, created: false };
      }
      throw e;
    }
  });
}
```

Identical pattern to `matchOrCreatePerformer` (see migration 0019 +
the matcher transaction comment in `Planned Improvements.md`).

---

## 5. ESPN client

```ts
// packages/api/src/espn.ts — undocumented but stable public API
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';

const SPORT_PATH: Record<League, string> = {
  nba: 'basketball/nba',
  wnba: 'basketball/wnba',
  nfl: 'football/nfl',
  mlb: 'baseball/mlb',
  nhl: 'hockey/nhl',
  mls: 'soccer/usa.1',
  epl: 'soccer/eng.1',
  // ...
};

export async function fetchScoreboard(league: League, date: Date) {
  const yyyymmdd = formatDate(date, 'yyyyMMdd');
  return retryFetch(`${ESPN_BASE}/${SPORT_PATH[league]}/scoreboard?dates=${yyyymmdd}`, {
    timeoutMs: 10_000, retries: 2,
  });
}

export async function fetchBoxScore(league: League, espnEventId: string) {
  return retryFetch(`${ESPN_BASE}/${SPORT_PATH[league]}/summary?event=${espnEventId}`, {
    timeoutMs: 10_000, retries: 2,
  });
}
```

- No auth required. Apply the same `AbortSignal.timeout` + retry
  pattern as TM/setlist.fm (round-1 audit fix list).
- Log via `child({ component: 'api.espn' })` with structured events
  `espn.request.ok` / `espn.request.error` / `espn.normalize.failed`.
- Cache scoreboard responses by `(league, date)` for 5 minutes —
  during ingestion bursts we'll hit the same dates repeatedly.

Fallback: TheSportsDB for international/lower-tier leagues that ESPN
doesn't index. Same wrapper shape.

---

## 6. Test plan

- Unit:
  - `team-matcher` — happy path, race recovery, external-id backfill.
  - `ticketmaster.normalizeKind` already tested
    (`apps/api/src/__tests__/ticketmaster-kind.test.ts`); add cases
    for sports segments returning team metadata.
  - `espn.normalizeBoxScore` — fixture per league (NBA, NFL, MLB,
    NHL, MLS).
- Integration:
  - `shows.create` with a sports payload writes to `show_teams` (not
    `show_performers`) and rejects mixed inputs.
  - `discover/ingest-team` populates `announcements` with
    `home_team_id` / `away_team_id`.
  - `enrichment/sports-score-fill` updates `sports_summary` from
    ESPN.
- E2E:
  - Add a past sports show end-to-end (kind picker → team typeahead →
    score entry → save → show detail renders scoreboard).
  - Follow a team from Discover → see watching shows appear.
  - Sports-typed daily digest renders in the email smoke test.

---

## 7. Phased rollout

| Phase | Scope |
|-------|-------|
| **S0** | Kind type consolidation (§3a). Lands as a tiny, mechanical PR — unblocks everything else and pays down the consolidation debt already on the planned-improvements list. |
| **S1** | Schema: `teams`, `show_teams`, `user_team_follows`, `shows.sports_*` columns, `announcements.{home,away}_team_id`. Drizzle migration + types. |
| **S2** | Add flow + Show detail + `shows.create` wiring. End-to-end "manually log a past game" works. |
| **S3** | Discover follow-team + `discover/ingest-team` job + ESPN client. End-to-end "follow Knicks → watching shows appear → attend → fan record updates" works. |
| **S4** | Past-game enrichment (`sports-score-fill`), digest treatment, Home tile. |
| **S5** | Mobile (see §11). Sports branches across Add / Show detail / Shows / Discover / Map; iPad three-pane variant. |

---

## 8. Risks

| Risk | Mitigation |
|------|-----------|
| ESPN endpoint changes / rate-limits | Fallback to TheSportsDB; AbortSignal.timeout; daily cap (1 req/team/day for enrichment). |
| Team merge-conflicts (Knicks vs New York Knicks vs NYK) | Same lower-name + advisory-lock + 23505 recovery pattern as performers/venues. Aliases column if needed later. |
| Wrestling / UFC / F1 fit awkwardly into "team" model | Phase 1 ships team-sports only (NBA/NFL/MLB/NHL/MLS/EPL+top European). Combat sports + motorsports are a later expansion that may want a different shape (`event_competitors` with type='fighter' / 'driver'). Don't try to cover everything in v1. |
| Users want to track "the away team came to MSG" without following either team | Already covered: announcements get team IDs whether the user follows the teams or not; venue ingest pulls them via TM `attractionId` filter. |
| Sports double-headers / multi-game days | `show_teams` PK includes `role` so a doubleheader is two distinct shows; ingestion dedup by `(date, venue, home, away)` not just `(date, venue)`. |

---

## 9. Audit of sports gaps in the *current* mobile build

Mobile is feature-complete (M1–M6 shipped). It already includes
`'sports'` in the `Kind` type via `@showbook/shared`, and the
existing `KindBadge` renders a trophy icon. But every place that
*does* something with kind today narrows to the four other values.

| Surface | File | Today | Gap |
|---------|------|-------|-----|
| Show detail kind branching | `apps/mobile/app/show/[id].tsx` and `[id]/` subroutes | Renders setlist composer for concert/comedy, cast for theatre, performers for festival | No sports branch — falls through to performer rendering, which produces a blank card because sports shows have no `show_performers` rows |
| Add chat (LLM intent) | `apps/mobile/app/add/index.tsx` (`add` route) | Prompt enumerates the 4 kinds for the LLM | Sports queries fall back to "concert" — visible as users typing "Knicks vs Celtics last night" being parsed as a concert at MSG |
| Add form fallback | `apps/mobile/app/add/form.tsx` | Kind picker shows 4 tiles | No sports tile, no team picker, no score subform |
| Setlist composer | `apps/mobile/app/show/[id]/setlist.tsx` | Always available on the Show action sheet | Should hide for `kind='sports'` |
| Shows tab kind chip filter | `apps/mobile/app/(tabs)/shows.tsx` | 4 chips | 5th chip + matchup-formatted row |
| ShowCard | `apps/mobile/components/ShowCard.tsx` | `headliner: string` | Needs an "either headliner or matchup" rendering — see §11 |
| Discover follow rails | `apps/mobile/app/discover.tsx` | Followed venues + Followed artists | Add Followed teams rail |
| Search | `apps/mobile/app/search.tsx` | Searches venues + performers | Add team search results section |
| iPad three-pane | `apps/mobile/components/ThreePaneLayout.tsx` | Map (right) / Shows (left) / Show detail (middle) | Right pane should switch to a scoreboard mini-card when the selected show is sports |

§11 below is the concrete fill-in plan.

---

## 10. The sports-mobile UI itself

(Renumbered from prior §9. Risks now §8 above; §10/§11/§12 are
mobile/tablet/visuals.)

---

## 11. Mobile, tablet, and visuals

### 11a. Add flow — sports kind picker

`apps/mobile/app/add/form.tsx` kind picker grows a 5th tile. The
existing tile component already accepts any `Kind`; the only work
is adding the tile + branching the form below.

When sports is picked:

- The "Lineup" Sheet (currently used for performers) is replaced
  with a **TeamPicker** Sheet:

  ```
  ┌─ Pick teams ──────────────────────────┐
  │ Home                                   │
  │  ┌────────────────────────────────┐    │
  │  │  🏠  New York Knicks       ✓   │    │
  │  └────────────────────────────────┘    │
  │                                        │
  │ Away                                   │
  │  ┌────────────────────────────────┐    │
  │  │  🛫  Boston Celtics        ✓   │    │
  │  └────────────────────────────────┘    │
  │                                        │
  │  ⓘ Neutral site (playoffs, etc.)       │
  │                                        │
  │              [Save lineup]             │
  └────────────────────────────────────────┘
  ```

  Reuses the existing `Sheet` component pattern and the
  `VenueTypeahead`-style search affordance, just typed against
  `teams.search`.

- A new `ScoreEntry` block appears below Notes when
  `state='past'`:

  ```
  ┌─ Final score ──────────────────────────┐
  │  NYK   [ 119 ]    BOS   [ 112 ]        │
  │  ──────────────────────────────────── │
  │  ▸ Add period scores                   │
  │  ▸ MVP                                 │
  │  ▸ Attendance                          │
  └────────────────────────────────────────┘
  ```

  The disclosure rows use the existing accordion pattern from
  the setlist composer.

- The Add chat path (`apps/mobile/app/add/index.tsx`) prompt is
  extended with a sports example so the Groq parser correctly
  identifies a query like "Knicks vs Celtics last night at MSG"
  as `kind: 'sports'` with home/away inferred from the venue.

### 11b. Show detail — phone scoreboard hero

`apps/mobile/app/show/[id].tsx` gets a new top-of-screen
**Scoreboard** component for `kind='sports'` that replaces the
performer hero:

```
┌─────────────────────────────────────────┐
│  MAR · 23                   ▌ STATE     │
│                                          │
│       ┌─────┐    ╳    ┌─────┐           │
│       │ NYK │  119 ─  │ BOS │           │
│       └─────┘    112  └─────┘           │
│                                          │
│       Final · OT                         │
│                                          │
│       MVP   Jalen Brunson · 38 PTS       │
│       4–2   your record at this matchup  │
│                                          │
│       19,812   official attendance       │
└─────────────────────────────────────────┘
```

- New component `apps/mobile/components/Scoreboard.tsx`. Pulls
  team logos via the new `team.logoUrl` field; falls back to a
  monogrammed avatar (reuses the `RemoteImage` fallback pattern
  already used by `ArtistCard`).
- "Your record" pill is computed by a single tRPC procedure
  `sports.fanRecord({ teamIds })` so the UI doesn't fan out N
  queries.
- Sections below the scoreboard:
  - **Photos** — unchanged (uses `MediaGrid`).
  - **Box score** — only when `sports_summary.scorers` populated;
    a new `BoxScoreTable` component (rows of `player · stat ·
    value`).
  - **Notes** — unchanged.
  - **Setlist** section is *suppressed* (the action-sheet entry
    `Edit setlist` is also hidden when `kind='sports'`).

### 11c. ShowCard — matchup format

`ShowCard` headliner slot becomes "either headliner or matchup":

```ts
// apps/mobile/components/ShowCard.tsx
export interface ShowCardShow {
  ...
  headliner: string | null;       // existing — null for sports
  matchup?: { home: string; away: string; result?: 'W'|'L'|'T'; score?: [number, number] };
}
```

Render:
```
┌──────────────────────────────────────────┐
│▌ MAR  ·  TUE                            ▶│
│  23     NYK · BOS                  W 119 │
│         Madison Square Garden       –112 │
└──────────────────────────────────────────┘
```

- "Result" pill (W/L/T) is colored from the user's followed-team
  perspective: `success` for win, `error` for loss, `muted` for
  ties or no-followed-team.
- Edge bar tints (the existing 3px state indicator) unchanged —
  still `accent` for ticketed, `kindColor` for watching, `rule`
  for past.

### 11d. Shows tab — sports filter chip + sports stats card

`apps/mobile/app/(tabs)/shows.tsx`:

- 5th chip in the kind filter: `🏆 Sports`. Existing
  SegmentedControl + chip rail accommodates without layout work.
- The stats sub-tab (currently `Total / By kind / By month`) gets
  a new "By team" sub-mode for users with ≥3 sports shows. Bar
  chart of show count per team (reuses the existing chart helper
  pattern from the M2 stats view).

### 11e. Discover tab — Followed teams rail

`apps/mobile/app/discover.tsx`:

- Add a horizontal `Followed teams` rail above the existing
  `Followed venues` and `Followed artists` rails. Shows
  team-logo-pill cards, identical chrome to the existing artist
  rail.
- "Follow team" CTA at the head of the rail opens a Sheet with
  team search (typeahead). Search is league-aware (chip filter
  for NBA / NFL / MLB / NHL / MLS / Other).
- Long-press a team pill → ActionSheet `Open team page · Unfollow`.

A new optional stack route `apps/mobile/app/team/[id].tsx`
mirrors the existing artist/venue detail screens — upcoming games
+ attended games + your record. Phase S5 stretch; not blocking.

### 11f. Search tab

`apps/mobile/app/search.tsx` already has segmented sections for
`shows / venues / artists`. Add a `teams` section. Hits
`teams.search` (existing pattern, just a new procedure).

### 11g. iPad three-pane — sports treatment

`ThreePaneLayout` keeps its current structure (left=Shows,
middle=ShowDetail, right=Map). The branching happens *inside* the
middle and right panes:

- **Middle pane (ShowDetail)** renders the Scoreboard hero from
  §11b at the top, then either the Map (current behavior, suited
  to concerts where you orient by venue) or — for sports shows —
  a **box score** card if `sports_summary.scorers` is populated.
- **Right pane** — when the selected show is sports, the right
  pane swaps from Map to a **TeamHeadToHead** card: head-to-head
  history with the user's record vs each opponent, plus the next
  upcoming game between the two teams (if any). The Map remains
  the default for non-sports.

  ```
  ┌─ TeamHeadToHead ──────────────────────────┐
  │  NYK    vs    BOS                          │
  │  ───────────────                            │
  │  Your record at this matchup                │
  │       4 – 2                                 │
  │                                              │
  │  Last 5 you attended                        │
  │   W 119–112  · Mar 23, 2025  · MSG          │
  │   L 102–110  · Jan 11, 2025  · TD Garden    │
  │   W 124–119  · Apr 02, 2024  · MSG          │
  │   L  98–106  · Feb 17, 2024  · MSG          │
  │   W 112–104  · Nov 30, 2023  · TD Garden    │
  │                                              │
  │  Upcoming                                   │
  │   Apr 14, 2026  · MSG  · 7:30pm             │
  │   [+ Watch]                                 │
  └──────────────────────────────────────────────┘
  ```

  This is the iPad-only display the prompt asked about — it earns
  its width because head-to-head data wants room to breathe and
  doesn't compete for vertical space the way it does on phone.

- **Left pane (Shows list)** filters with the same kind chips as
  phone, but the iPad shell can show a permanent kind selector at
  the top of the pane (no need to hide chips behind a scroll on a
  1180pt-wide screen).

### 11h. Add screen on iPad

The existing M3 Add screen is phone-shaped. On iPad, opening
`/add` (regardless of route) presents a centered modal at 720pt
width rather than full-screen, with the chat history on the left
half and the form preview on the right half. Sports kind on iPad
gets the team picker as a side-panel, not a Sheet.

### 11i. Visual / design updates

New components:
1. **`Scoreboard`** (mobile + web) — central layout primitive for
   sports show detail. Designed once, used in show detail (full),
   show row (compact W/L), digest email block (compact), and the
   Brain `cards` channel (`type: 'sports_scoreboard'`).
2. **`TeamLogo`** — `RemoteImage`-backed with a monogrammed
   fallback. Reuses the same lazy-load + tinted-placeholder pattern
   as `ArtistCard`. New tokens: none — uses existing `surface` /
   `rule` / kind palette.
3. **`TeamPicker` Sheet** — composes `Sheet` + `VenueTypeahead`
   (parameterized for teams). No new chrome.

Color tokens — extend `KIND_COLORS` for sports. Today the existing
sports color is `#E29A44` (gold-ish, from
`packages/shared/src/constants/palette.ts` if present, else
`apps/mobile/lib/theme-utils.ts` — needs verification). If the
current value is also "trophy gold" close to `accent`, introduce a
distinct sports tint (suggested: a deep team-jersey blue
`#2F5BB7` for dark mode, `#1F4FA8` for light) so the kind chip
reads at a glance against the gold accent in the rest of the
theme. This is the only palette change in this plan.

Iconography — `lucide-react-native` already provides `Trophy`
(used today). Add `Volleyball` or `Goal` only if the user
distinguishes leagues at a glance later. v1 keeps `Trophy` for
all sports.

Web visual updates: scoreboard hero on `/(app)/shows/[id]/`
matches the mobile rhythm (tall hero card, then sections stack
underneath). The existing `HeroCard` design-system primitive gets
a `variant='scoreboard'` mode rather than a brand-new component.
Shows list row gets the matchup format and the W/L score badge
inline.

Tablet web: the `/(app)/shows/[id]/` page already uses a 2-column
layout when the viewport is wide. The right column on a sports
show renders the same `TeamHeadToHead` card from §11g — single
component shared between mobile-iPad and web-tablet via a thin
RN→DOM compat shim or a parallel implementation. Recommendation:
parallel implementations; the component is small and the cost of
the shim isn't worth it.

### 11j. Mobile-specific tests

- `apps/mobile/lib/__tests__/sports-format.test.ts` — matchup
  string formatting + W/L computation.
- `apps/mobile/components/__tests__/Scoreboard.test.tsx` —
  snapshot + period-breakdown rendering.
- Maestro flow: `e2e/flows/sports-add-show.yaml` — pick sports
  kind → enter teams → enter score → save → see scoreboard on
  show detail. Runs alongside the existing add-show flow.
