# Feature plan — Personal data import

**Goal:** New users land on Showbook with *years* of attended-show
history already populated, not a blank canvas they have to fill from
today forward. Existing users top up gaps from forgotten shows.

**Why this is the unlock:** The single largest activation barrier is
typing in a back-catalogue. Every source below already exists in the
user's life — we just need to *find* the show signal in it and present
a one-tap accept/reject UI. The DB cost of importing 200 historical
shows in one sitting is rounding-error; the product value is the
difference between "an app I might use" and "an app that already
knows me."

Status: not started. Builds on the existing Gmail scan
(`apps/web/app/api/gmail/scan/route.ts`,
`packages/api/src/gmail.ts`) and on `media_assets` for photo
fingerprinting.

---

## 1. The five sources, ranked

| # | Source | Reach | Effort | Confidence per hit | Notes |
|---|--------|-------|--------|--------------------|-------|
| 1 | Email — expanded vendors | 80% of users have *some* | Medium | High (95%+) | Builds on existing Gmail scan |
| 2 | Photo library — geo + EXIF | 60% of mobile users | Medium-high | Medium (60–80%, needs confirmation) | Mobile-only |
| 3 | Apple Wallet / Google Wallet passes | 40% of iOS users | Low-medium | Very high (98%+) | One-tap share-sheet on mobile |
| 4 | Maps Timeline (Google) | 30% of users (privacy-engaged) | Medium | Low-medium (40–60%, needs cross-ref) | KML/JSON import |
| 5 | Spotify listening peaks | 20% of users | Low (deps already there) | Low (signal only) | Hint, never auto-create |

Ship in this order. Each works standalone but feeds into a single
**Inbox of suggestions** UI so users see one merged pile of "did you
go to these shows?" cards.

---

## 2. Schema additions

### 2a. `import_suggestions` table

A staging table for *unconfirmed* shows discovered from any source.
The user reviews and accepts → row promoted into `shows`. Rejected
suggestions stay flagged so we don't re-suggest the same one.

```sql
CREATE TYPE "import_source" AS ENUM (
  'email_ticketmaster','email_axs','email_dice','email_eventbrite',
  'email_stubhub','email_seatgeek','email_telecharge','email_todaytix',
  'email_other',
  'photo_library','wallet_pass','maps_timeline','spotify_peak',
  'manual_paste'
);

CREATE TYPE "import_status" AS ENUM (
  'pending','accepted','dismissed','duplicate'
);

CREATE TABLE "import_suggestions" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source          import_source NOT NULL,
  status          import_status NOT NULL DEFAULT 'pending',
  -- Best-effort parsed fields (any may be null at suggestion time):
  show_date       date,
  show_kind       kind,
  venue_name_raw  text,
  venue_id        uuid REFERENCES venues(id),       -- after matching
  headliner_raw   text,
  performer_id    uuid REFERENCES performers(id),   -- after matching
  seat            text,
  price_paid      numeric(10,2),
  ticket_count    integer,
  -- Provenance for de-dup + auditing:
  external_id     text,    -- gmail message id, photo asset id, pkpass id, etc.
  raw_payload     jsonb,   -- snippet of the source for the review UI
  confidence      smallint NOT NULL DEFAULT 50,  -- 0..100
  -- If the user accepts, we record what show it became so the same
  -- raw_payload can't double-count.
  accepted_show_id uuid REFERENCES shows(id) ON DELETE SET NULL,
  created_at      timestamp NOT NULL DEFAULT now(),
  reviewed_at     timestamp
);

CREATE INDEX import_suggestions_user_status_idx
  ON import_suggestions (user_id, status, show_date DESC);
CREATE UNIQUE INDEX import_suggestions_dedupe_idx
  ON import_suggestions (user_id, source, external_id)
  WHERE external_id IS NOT NULL;
```

### 2b. `user_import_runs` table

One row per scan/import-job execution. Lets us show "last scanned 2
days ago, found 47 new suggestions, you accepted 31."

```sql
CREATE TABLE "user_import_runs" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source       import_source NOT NULL,
  started_at   timestamp NOT NULL DEFAULT now(),
  completed_at timestamp,
  scanned      integer NOT NULL DEFAULT 0,
  suggested    integer NOT NULL DEFAULT 0,
  accepted     integer NOT NULL DEFAULT 0,
  dismissed    integer NOT NULL DEFAULT 0,
  error        text
);
CREATE INDEX user_import_runs_user_started_idx
  ON user_import_runs (user_id, started_at DESC);
```

### 2c. `media_assets` extension (optional, photo source only)

Add nullable columns so a photo asset can carry the EXIF coordinates
and capture-time we used to suggest a show — useful later for "this
show, these are the photos that matched."

```sql
ALTER TABLE media_assets
  ADD COLUMN captured_at  timestamptz,
  ADD COLUMN captured_lat double precision,
  ADD COLUMN captured_lng double precision;
```

These are *only* populated when the user opts into the photo-library
scan. No effect on the existing user-uploaded path.

---

## 3. Source 1 — Expanded email scan

### 3a. What's there today
- `apps/web/app/api/gmail/scan/route.ts` — SSE endpoint, auth-gated,
  per-user 5/hour rate-limited, capped at 200 messages.
- `packages/api/src/gmail.ts` — Gmail client + `buildBulkScanQueries()`
  with allowlists for ~15 vendors, plus exclusions for shipping /
  parking / hotel / merch.
- LLM extraction via Groq (single-shot) per message body.
- Output today: directly creates a `Show` (or skips on duplicate).

### 3b. What changes

**Decouple extraction from creation.** Today the scan can write a Show
straight away. Refactor so the scan only writes `import_suggestions`
rows; the Inbox UI is the only path that promotes a suggestion to a
Show. Two reasons:

1. Lets the user review before commit. Email parsing is good but not
   perfect; auto-creating `Show` rows on a 1000-message backfill is
   how you end up with 14 phantom "Hamilton" rows.
2. Unifies all five import sources behind one review surface.

**Add per-vendor parsers.** The single-LLM-call approach is right for
weird edge cases but expensive at scale. Add deterministic parsers for
the high-volume senders (TM, AXS, Dice, Eventbrite, Telecharge,
TodayTix, StubHub, SeatGeek). Fallback to the LLM only when the
parser fails confidence checks.

```ts
// packages/api/src/email-parsers/index.ts
export interface ParsedTicketEmail {
  source: ImportSource;
  externalId: string;       // gmail message id
  showDate: Date | null;
  venueName: string | null;
  headliner: string | null;
  seat: string | null;
  pricePaid: number | null;
  ticketCount: number | null;
  confidence: number;       // 0..100
  rawSnippet: string;       // for the review UI
}

export interface VendorParser {
  source: ImportSource;
  matches(headers: { from: string; subject: string }): boolean;
  parse(detail: GmailMessageDetail): ParsedTicketEmail | null;
}

// One file per vendor:
// email-parsers/ticketmaster.ts
// email-parsers/axs.ts
// email-parsers/dice.ts
// email-parsers/eventbrite.ts
// email-parsers/stubhub.ts
// email-parsers/seatgeek.ts
// email-parsers/telecharge.ts
// email-parsers/todaytix.ts
// email-parsers/_llm-fallback.ts   <-- the existing Groq path
```

Each parser is ~80–150 lines: a few regexes + light HTML scraping for
the bits these vendors notoriously include in receipts (TM puts the
event in the subject + a structured table; Dice puts everything in
plain text; AXS uses an OG-image with the event name). No LLM call
needed for these, so 80% of the corpus comes back deterministically
within 50ms total per message.

**Extend the bulk-scan query** with the missing senders:

```diff
-'from:(ticketmaster OR axs OR eventbrite OR stubhub OR seatgeek OR ...
+'from:(ticketmaster OR axs OR eventbrite OR stubhub OR seatgeek OR ...
+  resy OR opentable OR shotgun OR ra OR residentadvisor OR
+  songkick OR oztix OR moshtix OR holdmyticket OR brownpapertickets OR
+  northcoasttickets OR mlb.com OR nba.com OR nhl.com OR ' +
```

(Sports senders go in only after Source 1 ships and Sports kind is
live — see `feature-plan-sports-kind.md`.)

**Lift the 200-message cap for backfill.** Today's cap exists because
the scan was synchronous and LLM-heavy. Once parsers are deterministic
and the result is *suggestions* (not commits), introduce a separate
"deep scan" mode that runs as a pg-boss job:

```ts
// packages/jobs/src/import-email-deep-scan.ts
registerJob('import/email-deep-scan', async ({ userId, query, sinceDate }) => {
  // Paginate through Gmail with no message cap (or, say, 5000 cap as a
  // safety net) writing import_suggestions rows. Emit progress via
  // import_runs. User sees a live "scanned 1240 / 5000, found 38" tile.
});
```

The existing live SSE scan stays for the hot-path "scan recent
purchases right now" UX.

### 3c. Matching pipeline (per parsed email)

```
ParsedTicketEmail
   │
   ├── matchVenue(venueName, city?)         → venue_id or null
   │     (existing matchOrCreateVenue, but DON'T create on low confidence)
   │
   ├── matchPerformer(headliner)            → performer_id or null
   │     (existing matchOrCreatePerformer, ditto — don't auto-create)
   │
   ├── checkDuplicate(user, date, venue, headliner)
   │     → if existing show within ±1 day at same venue, mark status='duplicate'
   │
   └── insert into import_suggestions(status='pending', confidence=...)
```

Crucially: **don't side-effect new `venues` / `performers` rows** on
the suggestion path. Wait for accept. Otherwise dismissing 1000
suggestions still leaves 1000 orphan rows behind.

### 3d. UI: the Inbox

New page: `apps/web/app/(app)/import/page.tsx`. Lives under a small
"Import" button on Home (visible only when suggestions exist) and in
the header of the Shows list (replacing/upgrading today's "Import from
Gmail" CTA).

Layout:

```
┌──────────────────────────────────────────────────────────────┐
│ Inbox · 47 suggestions  [Email] [Photos] [Wallet] [...]      │
├──────────────────────────────────────────────────────────────┤
│ ☐ NOV 12 2024 · Madison Square Garden                        │
│    The National                          [✓ accept] [✗ skip] │
│    From: Ticketmaster · $89 · ORCH L 14                      │
│    "Your tickets for The National at MSG..."                 │
├──────────────────────────────────────────────────────────────┤
│ ☐ AUG 03 2024 · Pier 17                                      │
│    Vampire Weekend                       [✓ accept] [✗ skip] │
│    From: Dice · $52 · GA                                     │
│    Confidence: medium — venue not matched, "Pier 17, NYC"    │
│    [resolve venue ▾]                                         │
└──────────────────────────────────────────────────────────────┘

Top bar: [Accept all high-confidence (32)]  [Dismiss all]
```

Bulk-accept defaults to "high-confidence" (≥85) with a confirmation
modal. Accept actually calls `shows.create` with the parsed payload,
runs the existing enrichment pipeline, and flips the suggestion's
`accepted_show_id`.

### 3e. tRPC procedures

```ts
// packages/api/src/routers/import.ts
imports.suggestions.list({ source?, status?, cursor?, limit? })
imports.suggestions.accept({ id, overrides? })
imports.suggestions.bulkAccept({ ids })
imports.suggestions.dismiss({ id })
imports.suggestions.bulkDismiss({ ids })
imports.runs.list()
imports.runs.start({ source, options? })   // queues a deep-scan job
```

`accept` reuses `shows.create`'s validation + enrichment, *not* a
parallel code path.

### 3f. Observability

Structured events (follow `<component>.<action>.<outcome>` shape from
CLAUDE.md):

- `import.email.parser.match`     — vendor parser matched
- `import.email.parser.fallback`  — fell through to LLM
- `import.email.suggestion.created`
- `import.email.suggestion.duplicate`
- `import.suggestion.accepted`
- `import.suggestion.dismissed`
- `import.run.{started,completed,failed}`

### 3g. Tests
- Unit, per parser: hand-pick 3–5 real anonymized emails per vendor in
  `packages/api/src/email-parsers/__tests__/fixtures/`. Snapshot the
  parsed output.
- Integration: full `imports.suggestions.accept` flow with a fixture
  that exercises duplicate detection.
- E2E (Playwright): the Inbox page — accept one, dismiss one, verify
  the count badge updates and the Show appears on Shows list.

---

## 4. Source 2 — Photo library scan (mobile)

The killer feature. Mobile only — desktop browsers can't read EXIF
from a photo library at scale.

### 4a. Concept

For each photo in the user's Photos library:
1. Read EXIF for `DateTimeOriginal` and GPS lat/lng.
2. If a photo's GPS lat/lng is within 100m of any followed venue
   (or any venue with a show in the user's history) and the photo's
   timestamp is between 2 hours before and 6 hours after a *plausible*
   show window for that venue:
   - If a show already exists for that user/venue/date → silently
     attach the photo to that show as a suggested upload.
   - Otherwise → create an `import_suggestions` row with
     `source = 'photo_library'`, headliner unknown.
3. Cluster nearby photos (same venue, same night, ±3h) so we propose
   *one* show per night, not one per photo.

### 4b. Why it's possible without a server-side photo upload

Run the scan **entirely on-device** using `expo-media-library` to
enumerate assets and `exifr` (or native `expo-image-manipulator` +
EXIF parsing) to read metadata. Only EXIF coordinates and timestamps
ever leave the device, and only after the user accepts the
suggestion. Photo bytes only travel to R2 if the user opts in to
attaching them to the show.

### 4c. Permissions UX

```
Showbook would like to scan your Photos library
to find shows you might have forgotten to log.

We never upload your photos. Only photos taken at one of
your saved venues, on a night where a concert was happening,
will appear as a suggestion. You decide what to keep.

[Allow]   [Not now]
```

Two-step: first iOS/Android Photos permission, then a Showbook-side
"got it" so we have a record of consent.

### 4d. Algorithm sketch

```ts
// apps/mobile/lib/photo-scan/index.ts (mobile-only)
async function scanLibrary(userId: string, since: Date): Promise<Suggestion[]> {
  const assets = await MediaLibrary.getAssetsAsync({
    mediaType: 'photo',
    after: since.getTime(),
    sortBy: ['creationTime'],
  });

  // Group by night × ~rough geocell (3 decimal places of lat/lng → ~110m).
  const nights = new Map<string, AssetCluster>();
  for (const asset of assets.assets) {
    const exif = await readExifLite(asset);   // captureTime + lat/lng only
    if (!exif?.lat || !exif?.lng || !exif?.capturedAt) continue;
    const key = nightKey(exif.capturedAt, exif.lat, exif.lng);
    nights.get(key)?.assets.push(asset) ?? nights.set(key, { exif, assets: [asset] });
  }

  // Resolve each cluster to a venue (server call).
  const clusters = [...nights.values()];
  const resolved = await trpc.imports.photoClusters.resolve.mutate({
    clusters: clusters.map(c => ({
      capturedAt: c.exif.capturedAt,
      lat: c.exif.lat,
      lng: c.exif.lng,
      assetCount: c.assets.length,
    })),
  });

  // Server returns: for each cluster, candidate venue + announcement
  // (if any) + duplicate flag. Mobile renders the suggestions UI.
  return resolved;
}
```

Server side, the `imports.photoClusters.resolve` procedure does the
hard work:

```ts
// 1. Find candidate venues within 200m radius. Prefer followed +
//    historic venues over arbitrary geocode hits.
// 2. Look up TM announcements at that venue on that date.
// 3. If announcement exists → headliner suggested with high confidence.
//    If no announcement but venue matches → suggest with low confidence.
// 4. Create import_suggestions row(s).
```

### 4e. Edge cases
- **Indoor venues with weak GPS** (basements, MSG): EXIF lat/lng can
  drift 50–500m. Reverse-geocoding fails. Mitigation: use a 200m
  radius and prefer followed venues (we trust user intent).
- **Living near a venue:** photos from your apartment 100m from
  Webster Hall will look like Webster Hall shows. Mitigation: require
  ≥2 photos in a single 3-hour window AND a TM announcement on that
  date OR explicit user-followed venue.
- **Festivals:** geocell-based grouping fails for big footprints.
  Mitigation: festival kind venues get a `geofence_radius_m` column
  override (default 200m, festival default 1500m).

### 4f. Tests
- Unit: night-key cluster algo with synthetic asset arrays.
- Unit: server-side cluster resolver with seeded venues + announcements.
- Manual on-device QA: hand-build a fixture of 20 known concert nights
  (developer's own photos) and verify recall ≥80% / precision ≥90%.

---

## 5. Source 3 — Apple Wallet / Google Wallet passes

### 5a. Concept

Mobile share-sheet target: when the user long-presses a `.pkpass` file
or a Google Wallet save, "Share to Showbook" shows up. Showbook reads
the pass JSON, extracts `relevantDate`, venue, seat, order #, and
creates a high-confidence suggestion.

### 5b. Implementation

iOS only first (Apple Wallet is dominant for tickets).

```ts
// apps/mobile/app.json — share extension intent
{
  "expo": {
    "ios": {
      "infoPlist": {
        "CFBundleDocumentTypes": [{
          "CFBundleTypeName": "Apple Wallet Pass",
          "LSItemContentTypes": ["com.apple.pkpass"],
          "CFBundleTypeRole": "Viewer"
        }]
      }
    }
  }
}
```

Pass parsing is just `unzip` + read `pass.json`:

```ts
import { unzip } from 'react-native-zip-archive';
import * as FileSystem from 'expo-file-system';

async function parsePkpass(uri: string): Promise<ParsedPass | null> {
  const dir = await unzip(uri, FileSystem.cacheDirectory + 'pkpass-tmp/');
  const json = JSON.parse(
    await FileSystem.readAsStringAsync(dir + '/pass.json'),
  );
  return {
    venueName:  json.eventTicket?.primaryFields?.find(f => f.key === 'venue')?.value,
    showDate:   json.relevantDate,
    headliner:  json.eventTicket?.primaryFields?.find(f => f.key === 'event')?.value,
    seat:       extractSeat(json),
    pricePaid:  null,   // not in pkpass
    externalId: json.serialNumber,
    rawPayload: json,
    confidence: 95,
  };
}
```

Android: Google Wallet doesn't expose pass JSON the same way. The
fallback is "Share image to Showbook" → vision LLM extraction of the
ticket QR/text. Lower priority.

### 5c. Server flow

Same as email parsers: parsed pass → `import_suggestions` row → Inbox.

### 5d. Tests
- Unit on the pass-JSON parser with 5 anonymized fixtures (TM, AXS,
  Dice, MLB, theatre).
- Manual on-device share-sheet QA.

---

## 6. Source 4 — Maps Timeline import

### 6a. Concept

Google lets you export your Maps Timeline as a JSON archive (Takeout).
For each day, it contains the places visited with timestamps. We
cross-reference with our `venues` table.

### 6b. UX

Web only (the file is huge and the UX needs a real upload). Settings
page → "Import from Google Maps Timeline" → instructions screenshot
+ file picker → upload → background job → suggestions appear in Inbox.

```
┌─────────────────────────────────────────────────┐
│ Import from Google Maps Timeline                 │
├─────────────────────────────────────────────────┤
│ 1. Visit takeout.google.com                      │
│ 2. Select only "Location History (Timeline)"     │
│ 3. Pick "JSON" format                            │
│ 4. Wait for the email; download the .zip         │
│ 5. Drop the .zip below                           │
│                                                  │
│      [ Drop file or click to choose ]            │
│                                                  │
│ Your file is parsed once and discarded.          │
│ We only store the venue + date matches.          │
└─────────────────────────────────────────────────┘
```

### 6c. Backend

Single tRPC mutation that streams the upload to a tmp file, parses
it server-side (the JSON is huge — multiple GB; use a streaming JSON
parser like `stream-json`), and queues an import job:

```ts
// packages/jobs/src/import-maps-timeline.ts
registerJob('import/maps-timeline', async ({ userId, archivePath }) => {
  for await (const visit of streamTimelineVisits(archivePath)) {
    if (visit.durationMin < 30) continue;             // not a show
    if (visit.timeOfDay < 18 && visit.endHour < 22) continue;  // daytime
    const venue = await matchVenueByLatLng(visit.lat, visit.lng, 200);
    if (!venue) continue;
    const announcement = await findAnnouncement(venue.id, visit.date);
    await db.insert(importSuggestions).values({
      userId,
      source: 'maps_timeline',
      showDate: visit.date,
      venueId: venue.id,
      headlinerRaw: announcement?.headliner ?? null,
      performerId: announcement?.performerId ?? null,
      confidence: announcement ? 75 : 35,
      externalId: visit.placeId,
      rawPayload: { visit, announcement },
    }).onConflictDoNothing();
  }
  await fs.unlink(archivePath);   // discard the upload
});
```

### 6d. Tests
- Unit: the streaming visit filter (hours, durations).
- Integration: end-to-end with a synthetic 100-visit Timeline
  archive + a seeded venue.

---

## 7. Source 5 — Spotify listening peaks

### 7a. Concept

Lowest-confidence source. **Never auto-creates a suggestion;** instead
surfaces a hint inside the Inbox when other sources are noisy.

If a user listened to an artist X heavily for 2 weeks centered on a
date D, *and* that artist toured a venue near the user's region on
date D, that's a strong signal they went. We can't prove it, but we
can suggest it with confidence ~40 and let the user accept.

### 7b. Implementation

Reuse the existing Spotify OAuth + token storage (`packages/api/src/spotify.ts`).
Add scope `user-read-recently-played` for the rolling 50 tracks and
`user-top-read` for the longer-term top artists. (Spotify does not
expose lifetime listening history; this only captures the last few
weeks of active use.)

Better: ask the user to upload their **Spotify "Extended streaming
history" Takeout** zip — it contains every play timestamp going back
years. Same UX as Maps Timeline: link to the request page, file
picker, background job.

### 7c. Algorithm

```ts
for each artist a in streaming history:
  compute weekly-play-counts[a]
  for each peak (z-score > 2.0, count > 20):
    let date = peak.center
    let candidates = await tm.findEvents({
      attractionName: a.name,
      lat: user.region.lat, lng: user.region.lng,
      radiusMi: 100,
      startDate: date - 14d, endDate: date + 14d,
    })
    for c in candidates:
      if not duplicateOfExistingShow(user, c):
        insert import_suggestion(source='spotify_peak', confidence=40, ...)
```

Tune the z-score / count thresholds against the developer's own data.

### 7d. Tests
- Unit: peak detection with synthetic streaming history.

---

## 8. The unified Inbox: data flow

```
┌────────────────────────────────────────────────────────────────┐
│                     Sources                                     │
│  Gmail scan ─┐                                                 │
│  Wallet pass ┤                                                 │
│  Photo scan  ├──► import_suggestions (status=pending) ─┐      │
│  Maps TL     ┤                                          │      │
│  Spotify     ┘                                          │      │
└─────────────────────────────────────────────────────────┼──────┘
                                                          │
                                   ┌──────────────────────┴──────────┐
                                   │ Inbox UI (web + mobile)         │
                                   │  - bulk accept high-confidence  │
                                   │  - per-row resolve venue/artist │
                                   │  - dismiss / restore            │
                                   └──────────────────────┬──────────┘
                                                          │ accept
                                                          ▼
                                           shows.create + enrichment
                                                          │
                                                          ▼
                                                   import_suggestions.status = 'accepted'
                                                   import_suggestions.accepted_show_id = ...
```

---

## 9. Phased rollout

| Phase | Scope | Why |
|-------|-------|-----|
| **P0 — Foundation** | `import_suggestions` + `user_import_runs` schema; refactor existing Gmail scan to write suggestions instead of shows; minimal Inbox UI on web. | Ships the rails everything else hangs on. |
| **P1 — Email parsers** | Per-vendor parsers for TM/AXS/Dice/Eventbrite/Telecharge/TodayTix/StubHub/SeatGeek; deep-scan job; extended sender allowlist. | Highest-reach source; deterministic; cheap. |
| **P2 — Wallet pass (iOS)** | Share-extension target; pkpass parser; mobile suggestion review screen. | Smallest mobile effort with the highest per-hit confidence. |
| **P3 — Photo library scan (iOS+Android)** | On-device EXIF scan; `photoClusters.resolve` server proc; venue match + announcement cross-ref. | The "wow" feature. Big lift. |
| **P4 — Maps Timeline import** | Web upload UI; streaming parser; background job. | Niche but loved by power users. |
| **P5 — Spotify peaks (Takeout)** | Listening-history upload; peak detection; low-confidence suggestions. | Bonus signal. |

Each phase ships to its own branch and gets its own E2E test before
moving on.

---

## 10. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| LLM hallucinations on email parsing create phantom shows | Suggestions go through user review; LLM only as fallback when deterministic parsers fail; confidence < 50 is opt-in to surface. |
| Photo scan privacy concerns | All EXIF reading on-device; only matched lat/lng + capture-time leave the device; explicit consent screen with plain-language copy. |
| Maps Timeline archive too large to upload | Stream-parse server-side; cap upload at 2 GB; suggest the user filter their export. |
| Email backfill tries to re-create existing shows | `(user_id, date, venue_id, headliner_id)` near-match check before inserting suggestion; existing shows get `status='duplicate'` not `'pending'`. |
| Massive suggestion lists are paralysis-inducing | Default Inbox view shows top 20 by confidence; bulk-accept high-confidence; weekly digest summarizes "12 new suggestions" rather than spamming. |
| Vendors change email formats | Per-vendor parser tests catch regressions in CI; fall through to LLM on failure (degraded but functional). |

---

## 11. Open questions

1. **Should we OCR ticket-image attachments too?** Many indie venues
   send a JPEG ticket. Vision LLM (Groq Llama-Vision) is already in
   the stack from the playbill flow; reusing it costs nothing. Probably
   yes, P1 add-on.
2. **Do we keep the 5-suggestions-per-night cap?** Festival weekends
   produce 8-stage clusters. Lean toward "cluster by night, but allow
   per-stage breakdown after accept" via a follow-up suggestion.
3. **Should accepted suggestions stay queryable?** Yes — keeps the
   provenance for debugging "why did this Show show up." Don't hard-
   delete, just flip status. Lifecycle: 12 months of retention then
   prune by job (alongside `prune-orphan-catalog`).
4. **Can the Brain trigger a scan?** "Did I go to a Phoebe Bridgers
   show in 2023?" → trigger a targeted Gmail subject search →
   suggestions appear in Inbox. Cross-feature unlock; defer until
   Brain ships.

---

## 12. Mobile, tablet, and visuals

The mobile app is feature-complete (M1–M6 shipped). The phone shell
is the 5-tab nav (Home / Shows / Add / Map / Me); the iPad shell is
`ThreePaneLayout` (`apps/mobile/components/ThreePaneLayout.tsx`)
keyed off `useBreakpoint() === 'tablet'` (≥900pt window width). All
import-side surfaces below land into that existing structure — we
are *not* adding a new tab.

### 12a. Where the Inbox lives on mobile

A new stack route `apps/mobile/app/import/` mirroring the existing
`app/discover/` and `app/integrations/[id]/` routes. Three sub-routes:

| Route | Purpose |
|-------|---------|
| `import/index.tsx` | Inbox list — paginated suggestions, filterable by source. |
| `import/[id].tsx` | Suggestion detail / resolve sheet (venue or artist disambiguation). |
| `import/runs.tsx` | History of past scans — accessed from Me → Imports. |

Two **entry points** without a new tab:

1. **Me tab** — a new "Imports" row sits between "Integrations" and
   "Region" with a count badge: `Imports · 47 pending`. Reuses the
   existing Me-tab row component pattern.
2. **Home banner** — when `pendingCount >= 5`, the Home screen shows
   a non-dismissible Banner above the Now-Playing card:
   `47 shows we found in your email — review`. Single tap →
   `/import`. The Banner component already exists
   (`apps/mobile/components/Banner.tsx`); reuse with
   `kind='accent'`.

### 12b. Inbox list — phone layout

Reuses the existing `ShowCard` shape modified into a new
`SuggestionCard` (in `apps/mobile/components/SuggestionCard.tsx`).
The card is taller than ShowCard because it carries a confidence
chip + source badge + raw snippet. Same 3px left edge bar as
ShowCard, but tinted by *confidence*:

```
┌──────────────────────────────────────────────────┐
│▌ NOV 12 · MSG                                    │
│  The National                                    │
│  ──────────────                                  │
│  📧 Ticketmaster · $89 · ORCH L 14               │
│  ✓ 96% match                                     │
│                                  [Skip] [Accept] │
└──────────────────────────────────────────────────┘
```

- Edge bar: `accent` for ≥85, `kindColor` for 50–84, `rule` for <50.
- Source badge: an existing icon-pill pattern (lucide icons —
  `Mail`, `Image`, `Wallet`, `Map`, `Music2` for the 5 sources).
- Per-row swipe gestures (using `react-native-gesture-handler`,
  already in the bundle for the Sheet component): swipe-right =
  Accept, swipe-left = Dismiss. Long-press → `ShowActionSheet`-style
  sheet with `Resolve venue / Resolve artist / Open original / Mark
  duplicate` options.
- Sticky header with **segmented control** (`SegmentedControl`
  already shipped in the kit) for `Pending / Accepted / Dismissed`,
  plus a horizontal scrollable **chip rail** for source filters
  (matches the existing Discover kind-chip pattern).
- Top-of-list "Accept all high-confidence (32)" pill button only
  appears when ≥10 high-confidence suggestions exist.

### 12c. Resolve sheet (when match is ambiguous)

When a suggestion has `confidence < 70` or unmatched venue/artist,
tapping it opens a Sheet (`apps/mobile/components/Sheet.tsx`) — not
a stack push. Inline disambiguation:

```
┌─ resolve venue ────────────────────────────────┐
│ "Pier 17"                                       │
│ ┌─────────────────────────────────────────────┐ │
│ │ 🔍 Pier 17 ...                              │ │
│ └─────────────────────────────────────────────┘ │
│  ▸ Pier 17 · New York, NY                       │
│  ▸ Pier 17 Concerts · Brooklyn, NY              │
│  ▸ Add new venue manually                       │
│                                                  │
│                          [Skip]   [Accept ✓]    │
└──────────────────────────────────────────────────┘
```

Reuses `VenueTypeahead` directly (already used by the Add form).
Same pattern for artist disambiguation.

### 12d. iPad three-pane treatment

When `useBreakpoint() === 'tablet'`, the import surface gets a
**dedicated three-pane layout** by routing `app/import/_layout.tsx`
to render `ThreePaneLayout` instead of a stack:

```
┌──── iPad: Imports ─────────────────────────────────────────────┐
│ [Filters/Sources]   │  Inbox list      │  Selected suggestion  │
│  ◉ Pending  47      │  ▌ NOV 12 MSG    │  ┌─ The National ──┐  │
│  ○ Accepted 312     │  ▌ AUG 03 Pier17 │  │ MSG · NOV 12    │  │
│  ○ Dismissed 18     │  ▌ JUL 28 BAM    │  │ $89 · ORCH L 14 │  │
│                     │  ▌ MAY 04 Forum  │  │                 │  │
│  Sources            │  …               │  Original email    │  │
│  ☑ Email   42       │                  │  ┌──────────────┐  │  │
│  ☑ Photos   3       │                  │  │ "Your tix..." │  │  │
│  ☑ Wallet   2       │                  │  └──────────────┘  │  │
│  ☐ Maps     0       │                  │                     │  │
│                     │                  │  [Skip] [Accept ✓]  │  │
└─────────────────────┴──────────────────┴─────────────────────────┘
   320pt left           flexible middle    360pt right
```

- Reuses the existing `ThreePaneLayout` composition. We don't add a
  second three-pane component — we *parameterize* the existing one
  via a route-scoped variant. Plumbing identical: a small
  `useSelectedSuggestion()` context mirrors `useSelectedShow()`.
- The right pane shows the **raw email body** or **photo cluster
  preview** rendered in a webview-or-image container — this is the
  killer iPad use case. On phone the raw payload is collapsed
  behind a "View original" disclosure; on iPad it's always there at
  full reading width.
- Bulk-select with shift-click range select on iPad (the only place
  multi-select earns its complexity).

### 12e. Photo library scan — mobile-specific UX

The on-device photo scan (Source 2) lives inside the mobile app
*only*. Re-use what's already there:

- **Permission flow already exists** —
  `apps/mobile/app/(auth)/first-run/photos.tsx` requests
  `MediaLibrary` permission at first run for media-upload purposes.
  Extend that screen's copy to mention the import use case so
  consent covers both. Also add a re-grant CTA on the Me tab when
  the permission is denied.
- **Background scan job** — `apps/mobile/lib/photo-scan/index.ts`
  runs as a Foreground task (iOS background tasks have time limits
  that would truncate a 30k-photo scan). When the user taps "Scan
  my photos" on the Imports screen, render a non-dismissible
  progress sheet:

  ```
  ┌─ Scanning your photo library ────────────┐
  │                                           │
  │       ████████░░░░░░░░░░░░░░░             │
  │       4,820 / 12,400 photos              │
  │                                           │
  │       Found 12 possible shows so far.    │
  │                                           │
  │             [Continue in background]      │
  └───────────────────────────────────────────┘
  ```

- **Cache layer** — partial scan progress persists in
  `apps/mobile/lib/cache/` so a kill / cold-start doesn't restart
  from zero. Add a `photo_scan_state` table to `cache/schema.ts`
  with `(last_asset_id, last_capture_time, version)`.
- **Outbox-aware** — the `imports.photoClusters.resolve` mutation
  goes through the existing outbox so a flaky network during a
  long scan doesn't lose suggestions. Pattern matches the M6.A
  pending-writes work in `apps/mobile/lib/mutations/`.

### 12f. Wallet pass intake — iOS share extension

Per §5: a `.pkpass` share-sheet target. Implementation lands in
the existing mobile app config:

- Add `expo-document-picker` (already installed) handler in
  `apps/mobile/app/_layout.tsx`'s URL/intent listener — when an
  intent of type `com.apple.pkpass` arrives, route to
  `app/import/wallet-intake.tsx`. That screen runs the parser
  inline, writes the suggestion via tRPC, then navigates to
  `import/[id]` for review.
- iOS-only initially. The Android wallet-image fallback path
  (vision-LLM extraction) ships as a P3-stretch, behind the
  existing `Uploader` flow → "Use as ticket" affordance.

### 12g. Visual / design updates

The import surface introduces three new persistent UI elements;
each gets a design pass before code:

1. **`SuggestionCard` component** — designed in lockstep with
   `ShowCard` so the two read as siblings. Confidence chip uses
   the existing accent palette (gold / kindColor / muted) at
   reduced contrast. Source pill borrows from `KindBadge` shape.
2. **Source-icon set** — `Mail` / `Image` / `Wallet` / `Map` /
   `Music2` from `lucide-react-native` (already a dependency); a
   secondary "📨 New since last scan" dot styled like the
   `PulseLabel` primitive on web (`apps/web/components/design-system/`).
3. **Banner variant** — a new `kind='import'` variant on the
   existing `Banner` component. Background uses a soft-accent fill
   distinct from `kind='accent'` (used elsewhere for state changes)
   so the user reads it as informational, not an alert.

Web visual updates: a new top-strip notification chip on the
authed shell (matches the existing sidebar count-badges) when
`pendingCount > 0`. The Inbox page is the only fully-new page;
copy the editorial rhythm of `/(app)/discover/` (TopBar + chip rail
+ stacked rows) to keep the app cohesive. Suggestion cards reuse
the existing `HeroCard` chrome for the bulk-accept hero on first
load, then collapse to a tighter row layout.

Color tokens: no new ones. Confidence chip uses
`accent` / `kindColor` / `mutedFg` from `theme-utils.ts`. This is
deliberate — every new feature in the brainstorm should reach for
existing tokens before extending the palette.

### 12h. Mobile-specific tests

- `lib/photo-scan/__tests__/cluster.test.ts` — night-key clustering
  logic (pure, fast).
- `lib/__tests__/wallet-pass.test.ts` — pkpass JSON parser fixtures.
- Maestro flow: `e2e/flows/import-accept.yaml` — bulk-accept of a
  seeded suggestion list, asserting the resulting Show appears on
  the Shows tab.
