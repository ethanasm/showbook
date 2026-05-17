# Feature plan — Playbill images

**Goal:** Theatre, comedy, and festival rows in the logbook should ship
with a recognizable image — a marketing poster, a Playbill program
cover, or a production still — instead of the 2-letter initials
avatar. **Accuracy first:** leave a row blank rather than show a
wrong image, and surface every uncertain candidate to the user for
confirmation.

**Status:** Not started. There is a prior partial attempt at
`packages/jobs/src/backfill-show-cover-images.ts` that uses
Ticketmaster only. That job is the foundation; this plan extends it
to multi-source cascade + vision-verifier + manual override.

**Why this is the right time:** Theatre rows are the only show kind
in the logbook with consistently empty covers (the screenshot at
issue time shows "PA" and "CA" initial chips for *Paranormal
Activity* and *Cabaret at the Kit Kat Club*). Concert rows lean on
performer images sourced via Ticketmaster + MusicBrainz; theatre
has no equivalent fallback chain.

---

## 1. What's in place today

| File | What it does | Limitation |
|---|---|---|
| `packages/jobs/src/backfill-show-cover-images.ts` | Daily cron, runs TM event search by venue+date, then TM attraction search by productionName, writes to `shows.cover_image_url`. Caches by productionName so reruns are cheap. | Single source. Misses everything not in TM. No verifier. Filters on `kind in ('theatre','festival')` — comedy is excluded. |
| `packages/api/src/routers/shows.ts:736-738` | On `shows.create`, opportunistically pulls `coverImageUrl` from TM event response. | Same TM limitation; only runs at create, never re-tries. |
| `packages/api/src/routers/enrichment.ts:224` (`extractCast`) | Groq vision pulls cast/role pairs from a playbill the user uploaded. **Image is discarded.** | Solves a different problem (cast extraction). Documents that we already have a Groq vision integration path. |
| `shows.cover_image_url` column | Single nullable text. | No provenance, no image-type, no verifier verdict, no retry watermark. |
| `shows.photos text[]` column | Declared, currently unused. | Reserved for future user uploads. We will lean on it for manual override. |

The prior attempt is fine as a Tier-A step; it just stops there.

---

## 2. The three image types

The user asked to handle all three. They are visually and editorially
distinct, and they're sourced from different places. We'll store all
three on the same row but rank them so a single primary surfaces in
the logbook avatar.

### A. Marketing poster / key art (primary)

The recognizable artwork — the Wicked emerald star, the Hamilton
silhouette, the Eddie Redmayne *Cabaret* photograph from the 2024
revival. This is what should appear in the 40×40 logbook avatar by
default.

### B. Playbill program cover

The yellow-banded program magazine cover. Photographically
beautiful in detail view but visually monotone (every cover is yellow
with black text) as a row avatar. Best surfaced on the show detail
page, not in the list.

### C. Production stills / press photos

Cast on stage, costume + set. Best when the marketing poster is too
generic (a typography-only billboard). Often available from venue
press kits and BroadwayWorld galleries. Lowest-priority because
matching the right production is hardest.

---

## 3. Sources, by tier and image type

Tier A = high precision, structured response, low legal risk.
Tier B = open web search, needs a verifier.
Tier C = vertical scrapes (only if A/B leave too many blanks).
Tier D = manual / user-in-the-loop, always available as an escape.

### Tier A — structured sources

| Source | Marketing | Playbill cover | Production stills | Cost | Already wired? |
|---|---|---|---|---|---|
| **Ticketmaster** — event + attraction images | ✓ (cropped, low-res) | – | – | Free, in repo | Yes (`packages/api/src/ticketmaster.ts`) |
| **Spotify** — cast album artwork | ✓ (musicals only) | – | – | Free, OAuth in place | Partial (track search only) — need album search |
| **Wikipedia/Wikidata** — infobox image (P18 claim) | ✓ | – | ✓ (rare) | Free | No |
| **MusicBrainz** — release-group cover art | ✓ (musicals via Original Cast Recording release-group) | – | – | Free | Partial (perf/setlist matcher uses MBIDs) |
| **iTunes Search API** — cast album cover | ✓ (musicals only) | – | – | Free, no auth | Partial (`packages/api/src/preview-itunes.ts` for previews) |

#### Query patterns

**Spotify cast album search.** The existing client (`packages/api/src/spotify-playlist.ts:268`) does track search. We need a parallel `searchAlbums` call:

```http
GET https://api.spotify.com/v1/search
  ?q=album:%22{productionName}%20cast%20recording%22
  &type=album
  &limit=10
```

Disambiguate by `release_date` proximity to `show.date`:

- 2024 Cabaret revival recording (released 2024) → prefer for a 2024 show
- 1998 Studio Cast / 1972 Film Soundtrack → suppress when show.date is post-2020

Picks `album.images[0]` (Spotify returns 640/300/64 — take 640).
Cache to R2 and write its R2 URL to `coverImageUrl` (see §6 storage).

**Wikipedia/Wikidata.**

```http
# 1. Find a Q-item
GET https://en.wikipedia.org/w/api.php
  ?action=opensearch
  &search={productionName}+musical
  &format=json

# 2. Resolve to wikidata
GET https://en.wikipedia.org/w/api.php
  ?action=query&prop=pageprops&titles={page}&format=json
  → pageprops.wikibase_item = Q...

# 3. Fetch P18 (image) claim
GET https://www.wikidata.org/wiki/Special:EntityData/{Q}.json
  → claims.P18[0].mainsnak.datavalue.value = "Cabaret-poster.jpg"

# 4. Resolve to a CDN URL via the Wikimedia Commons API
GET https://commons.wikimedia.org/w/api.php
  ?action=query&titles=File:Cabaret-poster.jpg&prop=imageinfo&iiprop=url
```

**Disambiguation** is critical here: "Cabaret" alone matches the
1966 musical, the 1972 film, the 1987 revival, the 1998 revival,
the 2014 revival, the 2024 Kit Kat Club revival, and a Spanish
TV show. The disambiguator should narrow with:

- Show year (`show.date` ±2 years for revivals)
- Venue (Wikidata stores `P115` venue claims for some productions)
- The literal `productionName` we have — *"Cabaret at the Kit Kat Club"* is far more selective than *"Cabaret"*

When the disambiguator can't pick a single candidate, **leave it blank** — don't guess. Surface the top-3 to the user in the show edit page.

**MusicBrainz.** Use the same MBID matcher we already run for performers. Search release-groups with type "Original Cast Recording" + artist alias = productionName. The cover-art is served by `coverartarchive.org/release-group/{mbid}/front`.

### Tier B — open web search (verifier required)

| Source | Cost | Coverage | Risk |
|---|---|---|---|
| **Brave Search API (image)** | Free 2k/mo, $3/1k after | Web-wide | Low — image URLs are direct |
| **Google Programmable Search (image)** | $5/1k, 100/day free | Web-wide, best quality | Medium — many URLs are CDN-cached short-lived |

Both return a list of image URLs with thumbnail, source page, and dimensions. We take the top-N (3-5), pass each through the **verifier** (§4), and keep the highest-confidence pass.

Query template:

```
"{productionName}" {venue.city} {show.year} poster
"{productionName}" original Broadway poster        # for Broadway revivals
"{productionName}" playbill cover                  # for image type B
"{productionName}" production photo {show.year}    # for image type C
```

Tier B should never run without a Tier A miss first — it's strictly the fallback.

### Tier C — vertical scrapes (avoid unless needed)

| Source | Coverage | Why we'd skip |
|---|---|---|
| **Playbill.com** `/production/{slug}` pages | Best for Broadway + good off-Broadway | ToS restricts automated access; HTML fragile; SSRF surface; legal review needed before any prod-facing use |
| **IBDB** (Internet Broadway Database) | Broadway only | Doesn't help regional / SF / touring rows |
| **BroadwayWorld** photo galleries | Best regional theatre coverage | Most fragile; mixed-quality images |

Decision: **don't ship Tier C in v1.** Measure coverage from A + B + D first. If we still have >30% blanks, revisit — and at that point a Playbill.com scrape becomes the obvious next addition. Out-of-tree scrape definitions can live in `packages/scrapers/` alongside the existing Playwright-bound runners.

### Tier D — user-in-the-loop (ships in v1)

| Mechanism | Effort | Value |
|---|---|---|
| **Manual upload** on show edit page | Low (existing `photos[]` plumbing + a new upload widget) | Always works. Floor for accuracy. |
| **"Find an image"** button (admin/edit) | Low | On-demand Tier A→B cascade; user picks from the verified top-3 |
| **Reject / replace** affordance on the show detail page | Low | When the automated cascade lands a poor pick, the user can flip it manually |

---

## 4. The verifier (most important section)

The user's stated priority is **accuracy first**. Every candidate
from Tier A or Tier B must pass a vision-verifier before it lands in
`shows.cover_image_url`. Tier D (manual upload) bypasses the
verifier — the user is the verifier.

### Why a verifier

Without one, the cascade will write:

- The 1972 *Cabaret* movie poster onto the 2024 Kit Kat Club revival row.
- An iTunes cast album of "Paranormal Activity" (the 2007 film soundtrack) onto the 2026 musical.
- A press still of *Hadestown* onto a *Hadestown* tribute concert row by mistake (cross-kind bleed).

The verifier closes those leaks.

### How

Single Groq vision call per candidate, model
`meta-llama/llama-4-scout-17b-16e-instruct` (same model already used
by `extractCast` — see `packages/api/src/groq.ts:397-462`). Prompt:

```
You are validating whether an image is the official marketing artwork
for a specific live theatre/comedy/festival production.

Production: "{productionName}"
Venue: {venueName} ({venueCity})
Show date: {showDate}
Kind: {kind}                          # theatre | comedy | festival
Desired image type: {imageType}       # marketing | playbill | production_still

Answer this JSON only:
{
  "matches": <"yes" | "likely" | "no">,
  "image_type_actual": <"marketing" | "playbill" | "production_still"
                       | "movie_poster" | "album_cover" | "logo"
                       | "unrelated" | "unknown">,
  "production_year_visible": <integer | null>,
  "production_year_matches": <true | false | "unknown">,
  "reason": <one short sentence>
}
```

### Confidence threshold

- `matches: "yes"` AND `production_year_matches in (true, "unknown")` → persist
- `matches: "likely"` → persist **only** if no `matches: "yes"` was found in any tier; mark `requires_review: true`
- `matches: "no"` OR year mismatch → drop, log `verifier.rejected`

### Caching

Cache verifier verdicts by `(image_url_hash, productionName, year)` so a re-run doesn't pay the LLM cost twice. Verdicts older than 90 days are evicted (productions evolve, marketing changes).

### LLM budget

The existing `enforceLLMQuota` helper covers per-user costs. The
backfill cron runs server-side, so it pays from a system quota —
we'll add a separate budget knob `BACKFILL_VERIFIER_DAILY_CAP`
(default 200 verifications/day) so a misconfigured cascade can't
burn through Groq credits.

---

## 5. Schema

The current `shows.cover_image_url text` is too thin to record
provenance, image-type, or verifier output. We need either columns
on `shows` or a separate `show_images` table. The latter is the
right shape because we want to keep all three image types (one
primary + the rest as alternates).

### Migration

```sql
-- 0042_show_images.sql

CREATE TYPE show_image_type AS ENUM (
  'marketing',
  'playbill',
  'production_still'
);

CREATE TYPE show_image_source AS ENUM (
  'ticketmaster',
  'spotify_album',
  'wikipedia',
  'musicbrainz',
  'itunes',
  'brave_search',
  'google_search',
  'user_upload'
);

CREATE TABLE show_images (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id           uuid NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  image_type        show_image_type NOT NULL,
  source            show_image_source NOT NULL,
  -- The URL we serve. For Tier A this is the source CDN URL; for
  -- Tier B and uploads we proxy through R2 so we never hot-link.
  url               text NOT NULL,
  -- The raw source URL (kept for audit + retry).
  source_url        text,
  width             integer,
  height            integer,
  -- Verifier output. NULL for user_upload (the user is the verifier).
  verifier_verdict  text,  -- 'yes' | 'likely' | 'no' | NULL
  verifier_reason   text,
  -- Whether this row is currently the primary surface in the UI.
  is_primary        boolean NOT NULL DEFAULT false,
  -- For user moderation flow.
  requires_review   boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX show_images_show_idx ON show_images(show_id);
CREATE UNIQUE INDEX show_images_primary_idx
  ON show_images(show_id, image_type) WHERE is_primary;

-- Backwards-compat view: keep `shows.cover_image_url` as a denormalized
-- shortcut populated by trigger when a row's primary marketing image
-- changes. Existing reads keep working unchanged.
```

The `shows.cover_image_url` column stays, populated by a trigger when a `show_images` row with `image_type = 'marketing' AND is_primary = true` is inserted or updated. This lets the existing UI keep working with zero changes while the richer model rolls in behind it.

### Backfill of existing rows

Existing `shows.cover_image_url` values get migrated into `show_images` as `(image_type: marketing, source: ticketmaster, verifier_verdict: 'yes')` — we trust the TM-sourced data we already shipped.

---

## 6. Storage

### Hot-link vs rehost decision tree

| Source | Hot-link? | Why |
|---|---|---|
| Ticketmaster CDN | Yes | URLs are stable for years; TM is a paying partner |
| Spotify CDN (`i.scdn.co`) | Yes | Stable, terms allow display of cover art |
| Wikimedia Commons | Yes | Stable, CC-licensed |
| MusicBrainz Cover Art Archive | Yes | Stable, archive-quality |
| Brave / Google image-search results | **Rehost** | Source URLs rot fast; many are short-lived CDN paths |
| User upload | Rehost | Always |

For rehost targets we use R2 (we already use it for venue photos via Google Places — `packages/api/src/google-places.ts`). Cache key: `show-images/{showId}/{sha256(source_url)}.{ext}`.

### Hot-linking risks

- Provider rotates URL → image breaks. Mitigate by storing both `url` (canonical) and `source_url` (raw) and by a daily "broken-image" check on a sample of rows.
- Provider blocks hot-linking (referrer check). Mitigate by rehosting on first 4xx response.

### Image size

We surface a 40×40 avatar in the logbook and a larger version (up to 800×) on the show detail page. We'll keep one image per row at 640px max-side and let `next/image` resize down; we don't need a thumb pipeline.

---

## 7. Pipeline

### 7a. On `shows.create`

Tier A only — no Tier B at create time (latency + LLM cost).

1. If TM event/attraction has an image → write `show_images(source: ticketmaster, verifier_verdict: 'yes', is_primary: true)`. (This is what we do today; persists to the richer schema.)
2. If kind=theatre AND no TM hit AND productionName looks musical-ish → kick a pg-boss `shows.cover-fetch` job (cheap, async).

Latency budget: create flow stays <500ms; everything beyond TM is async.

### 7b. Daily backfill cron `backfill-show-cover-images`

Replaces the existing job. New flow per row (filter: `kind in ('theatre','comedy','festival') AND no primary marketing image`):

```
candidate_pool = []
candidate_pool ++= ticketmasterCandidates(...)   # tier A
candidate_pool ++= spotifyAlbumCandidates(...)   # tier A
candidate_pool ++= wikipediaCandidates(...)      # tier A
candidate_pool ++= musicbrainzCandidates(...)    # tier A

if candidate_pool empty AND row age > 7d:
  candidate_pool ++= braveSearchCandidates(...)  # tier B
  # cap at 3 candidates from tier B

for each candidate (cap total at 6):
  verdict = verifier(candidate, row)
  if verdict.matches == "yes":
    persist; break
  if verdict.matches == "likely":
    persist with requires_review=true; continue
  drop
```

Schedule: 05:15 ET daily (mirrors `backfill-performer-images` cadence).

### 7c. Admin "find images now" button

`apps/web/components/admin/AdminBackfillsCard.tsx` already has manual-trigger buttons (e.g. for setlist corpus-fill — see PR #197). Add one for `BACKFILL_SHOW_COVER_IMAGES` that enqueues the job immediately.

### 7d. Per-show manual override

On `apps/web/components/EditShowPanel.tsx`:

- **Upload** affordance writes to `show_images(source: user_upload, image_type: <user-selected>, is_primary: true)` and (for that image_type) demotes any existing primary to `is_primary: false`.
- **Suggest** button runs Tier A→B on demand, shows the user the top-3 verified candidates, user picks one.
- **Hide / replace** affordance flips `is_primary: false` and reveals the next-best (or unsets to a blank avatar).

### 7e. The show detail page

The detail page surfaces all three image types when present:

- Hero: primary marketing
- Gallery rail: production stills (if any)
- Footer thumbnail: playbill cover (if any) → clicking opens the cast extractor that already exists

If no marketing exists but a playbill does, the playbill becomes the
hero — better than the initials chip.

---

## 8. Observability

New structured events to add (follow the `<component>.<action>.<outcome>` shape):

- `show_image.candidate.found` — one per candidate, with `{source, imageType, showId}`
- `show_image.candidate.verified` — `{verdict, reason, showId, source}`
- `show_image.candidate.rejected` — `{reason, showId, source}`
- `show_image.persisted` — `{showId, source, imageType, isPrimary}`
- `show_image.upload.received` — manual upload
- `show_image.broken_link_detected` — daily integrity check
- `backfill.show_cover_images.summary` — supersedes today's `show.cover.done`

Add these to the curated list in the root `CLAUDE.md`.

LLM traces wrap the verifier in `traceLLM({ name: 'verify-show-image', model, input, run })` so Langfuse shows per-call latency and decision.

---

## 9. Rollout

Ship in **four phases**, each independently mergeable and verifiable:

### Phase 1 — Schema + foundations

- Drizzle migration adding `show_images` table, enums, trigger.
- Backfill existing `shows.cover_image_url` rows into `show_images`.
- Read path swap (`apps/web/components/shows-list/ShowsListView.tsx`, `apps/web/components/show-tabs/ShowDetailTabsView.tsx`) to source from `show_images.is_primary=true` with fallback to `shows.cover_image_url`.
- No behaviour change for the user; coverage stays at ~Ticketmaster level.

### Phase 2 — Manual upload + override

- Show edit page upload widget (R2-backed).
- Detail page replace/hide affordance.
- This alone closes the "blank theatre row" issue for power users.

### Phase 3 — Tier A cascade + verifier

- `searchAlbums` Spotify client.
- Wikipedia / MusicBrainz clients (new files in `packages/api/src/`).
- Vision verifier (`packages/api/src/groq.ts` extension).
- New backfill job logic (replaces the body of `backfill-show-cover-images.ts`).
- Per-source unit tests with mocked HTTP; integration test verifying the cascade picks the right *Cabaret* variant for a 2024 row.

### Phase 4 — Tier B fallback + admin button

- Brave Search client + image-resolver step.
- Admin "find images now" button.
- "Suggest an image" button on show edit page that does an on-demand cascade and shows the verified top-3.
- Measure coverage and decide whether Tier C is needed.

---

## 10. Tests

- **Unit:** Disambiguator picks the right Wikidata Q-item for "Cabaret" given show year + venue. Verifier prompt-builder produces stable JSON-only output for the model. Spotify album-search result picker uses release-date proximity correctly.
- **Integration:** Backfill cron — given a fixture row with productionName "Hadestown" and date 2024-05-01, the cascade lands the OBCR cover. Given productionName "Cabaret at the Kit Kat Club" date 2024-04-21, it lands the 2024 revival image and rejects the 1972 movie poster.
- **E2E:** Manual upload on the show edit page writes to `show_images` and the logbook avatar updates. Replace affordance flips primary. (Covered by Playwright.)
- Mock all external HTTP in unit + integration. E2E uses a fixture image, no real upload to R2 (use the dev MinIO equivalent already in use for venue photos).

---

## 11. Open questions

1. **Comedy productions** — should "Trevor Noah at the Beacon" get the comedian's headshot or a tour-poster? Comedy specials usually have a tour poster (Netflix-style key art); the headshot is the fallback. Recommendation: same cascade as theatre, weighted toward tour-poster when `tourName` is set.
2. **Festivals** — festivals have a single iconic lineup poster per year (Coachella, Outside Lands). Wikipedia/Wikidata covers most. Same cascade should work; Spotify won't (festivals don't have cast recordings).
3. **Movie posters bleeding in** — the verifier explicitly returns `image_type_actual = "movie_poster"` and we reject those. But for shows like *Mean Girls — The Musical* or *Paranormal Activity — The Musical*, the original film poster is what Wikipedia and Google return for the unqualified title. The fix is to always include the literal `productionName` (which contains "the musical" or similar) in queries — never the bare title.
4. **iTunes vs Spotify for cast albums** — both work. Spotify has the OAuth path already; iTunes Search needs no auth but rate-limits at 20/min/IP. Recommendation: Spotify primary, iTunes as a no-auth secondary so dev/test runs without Spotify creds still get hits.
5. **Personal data privacy** — manual uploads go to R2. Do we need a delete-on-show-deletion hook? Yes — add a `show_images ON DELETE CASCADE` from `shows` (already in the migration above) and a side-effect handler that removes the R2 object. Same pattern as the existing media-asset cleanup.
6. **Per-user vs shared images** — productions are global; the same *Hadestown* poster should serve every user who has a *Hadestown* row. The current `shows.cover_image_url` is per-show (and shows are per-user), so we'd re-fetch for each user. Acceptable for v1 because R2 storage is cheap and the verifier cache dedups the LLM cost. Revisit if we hit cost issues.

---

## 12. Risks / what could still go wrong

- **Verifier hallucinates "yes" on a confidently-wrong image.** Mitigate by always asking for `production_year_visible` and rejecting on year mismatch. Spot-check with a weekly admin review queue of `requires_review: true` rows.
- **Cost runs away on a first backfill.** A new install with 1000 unmatched theatre rows × ~4 candidates × Groq tokens could spike costs. Mitigate with the `BACKFILL_VERIFIER_DAILY_CAP` knob and a one-time admin "drain queue" trigger so the operator can run it in chunks.
- **Brave/Google return hot CDN URLs that 404 next week.** Mitigate by always rehosting Tier B results, never hot-linking them.
- **Trademark concerns on rehosting promotional artwork.** Showbook is a personal logger — a user's private logbook displaying official artwork is well inside fair-use precedent (think Letterboxd, Trakt, Discogs). Decision is the same as how we handle Ticketmaster's event imagery today. Revisit if/when Showbook becomes public-share-by-default.
- **The "Paranormal Activity" musical case.** This is the canonical hard case: a brand-new 2026 SF regional premiere with no Spotify recording, no Wikipedia page, no IBDB entry, and possibly no TM image. The Brave fallback may help; manual upload definitely will. The honest answer is that some rows will stay blank — and that's acceptable under the accuracy-first priority.
