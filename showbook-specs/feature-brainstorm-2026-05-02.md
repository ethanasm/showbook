# Feature brainstorm — 2026-05-02

A creative, "no bad ideas" sweep of where Showbook could go beyond the
current roadmap. Organized by axis. Items already shipped or already in
`Planned Improvements.md` / `mobile-roadmap.md` are intentionally
excluded; this is the *next* horizon.

Legend:
- ⭐ = high-leverage / fits naturally with existing primitives
- 🎯 = differentiated / hard for a competitor to copy quickly
- 🧪 = experimental, would inform whether a bigger investment is worth it

---

## 1. New event kinds

The `kind` enum today is `concert | theatre | comedy | festival`. Each
new kind is a schema extension + a new normalizer + new card/detail
treatment.

### 1a. Sports ⭐🎯
The biggest gap. Live sports are the same shape as a show (date, venue,
ticket, attendance, photos) but with rich post-event data the current
model can't express.

- New `kind = 'sports'` plus a new entity `Team` (parallel to
  `Performer`, but with `league`, `homeVenueId`, `colors`, `logoUrl`).
- `show_teams` join (home/away role) — leave `show_performers` alone.
- `shows.score` jsonb (`{ home, away, periods: [...] }`), `mvpPlayerId`,
  `attendanceOfficial`, `weatherSnapshot` for outdoor games.
- New ingestion: **ESPN public feed** (free, undocumented but stable)
  for NBA/NFL/MLB/NHL schedules + box scores; **TheSportsDB** as a
  fallback; **football-data.org** for soccer.
- Detail page: scoreboard hero, top performers, your "fan record" (W-L
  when you attended), section/seat heatmap.
- Stats: home-vs-away record when you're in the building, lifetime
  attendance at each franchise's home park, "curse index" (teams that
  lose more when you show up).
- Bonus kinds that piggyback on the same shape: **wrestling**
  (WWE/AEW — performers + result), **MMA/UFC** (fight card), **F1/Indy**
  (race + finishing order), **esports** (teams + bracket position).

### 1b. Film events ⭐
Not "movies you watched" — *live* film events: festival premieres,
revival screenings, 70mm runs, Q&A nights, drive-ins.

- `kind = 'film'`, link to **TMDB** for poster/cast/crew/synopsis.
- "Format" facet (35mm / 70mm / IMAX / Dolby / drive-in) — film nerds
  care a lot about this.
- Festival sub-kind: Sundance, TIFF, NYFF — multi-day, multi-screening.

### 1c. Talks, readings, lectures 🎯
Author tours, TED, 92nd St Y, Long Now, Aspen Ideas, conference
keynotes. Today these get crammed into "comedy" or skipped.

- `kind = 'talk'`. Speaker as `Performer` (already polymorphic).
- Ingestion: venue iCal feeds + a small Playwright fleet for
  notoriously list-shaped sites (TED, 92Y).

### 1d. Dance, opera, classical ⭐
Theatre kind covers "stage with named cast" but classical/opera/dance
have *very* different metadata (composer, conductor, choreographer,
program order, soloist roles).

- `kind = 'classical' | 'dance' | 'opera'`.
- New role types in `show_performers`: conductor, composer, soloist,
  choreographer, principal dancer.
- `program` jsonb — ordered list of pieces; for opera, libretto link.
- Ingestion: **Bachtrack** (best classical listings on the web),
  **Operabase**, plus venue iCal.

### 1e. DJ sets / club nights / underground electronic 🎯
TM is blind to most of this scene. The data lives in
**Resident Advisor** (RA) listings and **Bandsintown** for medium-tier
DJs.

- `kind = 'electronic'` (or treat as concert with sub-genre tag).
- Per-DJ "set time" within an event — multiple performers across the
  same night.
- Ingestion: RA event API (legacy GraphQL, scrapeable), Bandsintown
  (free API), Dice.fm (no public API but JSON-shaped responses on
  event pages).

### 1f. Other lightweight kinds 🧪
Magic, circus (Cirque du Soleil), burlesque, drag shows, immersive
experiences (Sleep No More–style), trivia nights, podcast live tapings.
Probably better as **tags** under `concert`/`comedy`/`theatre` than
new top-level kinds — start with a `subkind` text column and graduate
tags that earn their own treatment.

---

## 2. New ingestion sources

Today: Ticketmaster, setlist.fm, Google Places, Gmail scan, manual
LLM-assisted entry. Each new source either fills a coverage gap or
unlocks a richer display.

### 2a. Ticketing alternatives (coverage)
- **Bandsintown** ⭐ — free API, deep on small/mid clubs, artist-first
  (mirrors how users follow artists).
- **Dice.fm** — modern direct-to-fan ticketing. No public API but event
  pages return clean JSON; a respectful scraper can fill an obvious
  TM gap (Brooklyn, London, Berlin indie shows).
- **AXS** — covers MSG, Crypto.com Arena, O2 — TM's biggest competitor.
- **Eventbrite** — comedy clubs + indie events (free API).
- **Songkick** — still has some unique coverage; deprecated public API
  but RSS feeds exist.
- **TodayTix / Telecharge / IBDB** ⭐ — Broadway/off-Broadway better
  than TM. IBDB has cast lists structured (kills the playbill OCR
  flow for Broadway-proper, but keeps it as a fallback for off-off).
- **Goldstar / TodayTix Rush** — discount last-minute listings (could
  power a "tonight near you under $30" rail).

### 2b. Music-graph enrichment
- **MusicBrainz expanded** — already cache the MBID; it's a graph.
  Pull *artist relationships* (member-of, collaborated-with) and
  *area* (origin city). Unlocks "artists from your home town,"
  "side projects of bands you follow," "how 6 of your followed
  artists are connected via 2 hops."
- **Spotify** ⭐ — genre tags, popularity, related artists,
  user listening history (your top tracks → predicted-setlist). Even
  without auth, the public catalog API is enough for genre/related.
- **Apple Music / Tidal** — equivalent; nice-to-have.
- **Last.fm scrobbles** 🎯 — connect a user's account; we know you
  played 47 tracks by the headliner before the show; we know you
  played the *opening track* of the set first thing the next morning.
  Surface that as a "memory artifact."
- **Discogs** — vinyl/release graph; powers "band's deep cuts" rail.

### 2c. Sports data (paired with §1a)
- **ESPN scoreboard + boxscore feeds** (undocumented but stable).
- **TheSportsDB** — free, decent international coverage.
- **MLB Stats API** (genuinely public, JSON), **NHL stats API**, NBA
  stats endpoints.

### 2d. Film/TV
- **TMDB** ⭐ — free, generous, complete film metadata.
- **Letterboxd CSV import** — for users who already track screenings
  there: "import your 2024 Letterboxd diary, we'll detect the
  in-cinema entries by venue match."

### 2e. Personal data import (the big one) ⭐🎯
Most users have *years* of attended shows scattered across email and
photo libraries. Ingestion that meets them where their history already
lives is the highest-leverage feature on this list.

- **Apple Wallet / Google Wallet pass parsing** — share-sheet target
  on mobile; parse `.pkpass` for venue/date/seat/order #.
- **Email parser expansion** — Gmail scan exists; add patterns for
  AXS, Dice, Eventbrite, StubHub, SeatGeek, Vivid, TodayTix,
  Telecharge, MLB.com, Ticketweb, See Tickets, Resident Advisor
  receipts. Each is ~50 LOC of regex + sender allow-list.
- **iCloud / Outlook mail** — same parsers, different OAuth.
- **Google Photos / Apple Photos library** 🎯 — "scan my library for
  photos taken at venues I follow on dates I don't have shows logged."
  Geo + EXIF date is enough to suggest a show; user one-taps to
  confirm. This is the killer onboarding flow.
- **Google Maps Timeline export** — KML/JSON; cross-reference with
  followed venue lat/lng to suggest shows you forgot to log.
- **Spotify "Year in review" raw history JSON** — your listening peak
  for an artist often correlates with an attended show you forgot.
- **Venmo / Splitwise** — "Concert tix split with Sam" entries are
  surprisingly structured; LLM extraction would catch many shows.

### 2f. Wikidata / OSM / Wikipedia ⭐
- Venue capacity, year built, architect, history blurb (powers a
  "venue card" on detail page).
- Renovations / closures / name changes (a venue you've followed
  closing should be a *moment* in the app, not silence).
- Fetched once per venue, cached forever, refreshed yearly.

### 2g. Browser extension 🎯
Capture-from-anywhere: when you're on any ticket page (TM, AXS, Dice,
Resy waitlist, an indie venue's site), one click to push the event into
Showbook with all the OG metadata + page text. The LLM normalizes it.
Effectively turns *the whole web* into an ingestion source.

### 2h. Live mode capture 🧪
At a show: a one-tap "I'm here, build a setlist" mode that:
- Uses **mic + Shazam-style fingerprinting** (ACRCloud / AudD APIs) to
  detect songs as they play.
- Feeds detections into a draft setlist that the user confirms post-show.
- Optionally submits to setlist.fm on the user's behalf (gives back to
  the data source we depend on).

---

## 3. New & updated displays

### 3a. Year in Review / Showbook Wrapped ⭐🎯
Spotify-Wrapped style end-of-year reel; also accessible any time as a
shareable page.

- Headline stats: shows attended, miles travelled, hours of live music,
  unique venues, unique artists, longest gap, busiest week.
- "Genre evolution" sparklines.
- "Smallest room you saw [headliner] in" callouts.
- "First time" callouts (first jazz show, first opera, first show in
  Tokyo).
- Auto-generated 1080×1920 share card per stat (already have R2).
- LLM-written narrator paragraph stitches it together.

### 3b. Concert streak heatmap ⭐
GitHub-contribution-style cell grid, one cell per day, color by show
count. Hover for tooltip. Click for that show. Lives on Home and on
the public profile.

### 3c. Travel map / Tour-of-me 🎯
Globe (deck.gl or mapbox-gl globe) with arc lines from your home city
to each show. Aggregate stats: countries, continents, longest hop,
"most-travelled-for artist." Doubles as a beautiful share image.

### 3d. Setlist intelligence ⭐
Once setlists are stored as structured arrays, the analysis tier opens
up:
- **Songs heard most** across all shows (and per artist).
- **Rare tracks** caught — if a song appears <5% of an artist's
  setlist.fm tour, flag it as a "rare catch."
- **Tour debuts** — "you saw the live debut of X."
- **Setlist diff** between two of your shows on the same tour.
- **Predicted setlist** for a watching show (pull last N nights from
  setlist.fm, weight by recency, present a predicted ordered list with
  confidence bars).
- **Pre-show Spotify playlist** — exports the predicted setlist as a
  ready-to-listen playlist.
- **Post-show Spotify playlist** — exports the actual setlist.

### 3e. Artist evolution timeline 🎯
For a followed artist, a single horizontal timeline of *your* shows
with venue capacity on the y-axis. Visually narrates their rise (or
your loyalty: "you saw them at 200-cap, 1.2k-cap, then 18k-arena").
Capacity comes from Wikidata.

### 3f. Companion mode ⭐
Optional `companions text[]` on shows (free-text initially; later, link
to other Showbook users). Stats per companion ("Sam: 12 shows
together, mostly indie rock"). Group photo gallery.

### 3g. Concert collectibles 🧪
A simple sub-collection per show: posters, tour shirts, ticket stubs,
vinyl bought at the merch table. Photo + condition + (optional) value.
This isn't ticketing; it's *memory*. Differentiator vs every other
tracker.

### 3h. Show recap card (auto-generated) ⭐
24h after a show transitions to `past`:
- LLM-written one-paragraph recap from setlist + venue + photos.
- Auto-laid-out 9:16 photo collage.
- Email + push: "Your night at [venue]." Tap to edit/refine.
- Doubles as the share card.

### 3i. Live tonight rail
On Home: shows happening *tonight* at any followed venue or artist,
even if you don't have tickets. Sometimes the best discovery is "wait,
they're playing tonight, can I still get in?" Pair with a cheap-tickets
proxy (Goldstar/TodayTix Rush).

### 3j. On this day in your Showbook
Anniversary view. "5 years ago today: [artist] at [venue]. Here are
the photos and setlist." Lives in the digest *and* as a passive Home
card. Strong nostalgic hook.

### 3k. Map-as-time-machine
Existing map page is spatial. Add a **time slider** at the bottom:
drag through years, watch your dot pattern fill in. Festival summers
become obvious clusters; pandemic years become voids.

### 3l. Setlist player
Show-detail setlist becomes an embedded player: tap a song, hear the
studio version (Spotify/Apple Music embed). For users with Premium
auth, autoplay through the whole set in order.

### 3m. iOS/Android widgets + Apple Watch face complication ⭐
- Lock-screen widget: next show countdown, venue, weather.
- Home-screen widget: today's nearby shows.
- Watch complication: "tonight at 8: [show]" + walking directions.
- **Live Activity** during the show window: setlist tracker the
  user can update from the lock screen.

### 3n. Pre-show prep page
Auto-rendered when a watching show enters its 24h window:
- Predicted setlist (§3d).
- Doors / start / curfew (from venue or TM).
- Public-transit + parking notes (cached community wiki §4d).
- Weather.
- Bag policy + line tips (community wiki).
- A "hype" Spotify playlist link.
- Setlist length last night (from setlist.fm) so you know if you'll be
  out by midnight.

### 3o. Public profile / Showbook passport 🎯
Opt-in `showbook.com/u/<slug>` page. Their own editorial-style
showbook: hero stats, recent shows, top venues, share card. Print
button generates a PDF "concert passport." Strong retention loop and
cheap viral surface.

### 3p. Friend graph (lightweight) 🧪
Phase 1: import phone contacts → see which contacts are also Showbook
users → opt-in to follow each other → see "Sam went to [show] last
night." No DMs, no comments, no algo — just attendance feed. Phase 2
(later): RSVPs, group plans.

### 3q. Concert costs dashboard
Already capturing `pricePaid`. Surface it: spend by year, by venue, by
artist, $/hour, $/song-heard. The "$/hour of live music" stat is funny
and shareable.

### 3r. Carbon footprint tracker 🧪
Miles travelled × mode of transport (asked once per show, defaults
inferred from distance) → kg CO2. Annual offset suggestions. Niche
but loved by the climate-conscious slice of the music audience.

### 3s. Festival lineup optimizer 🎯
For festival-kind shows with multi-stage schedules:
- Ingest the full schedule.
- User picks "must-see" / "interested" per artist.
- Solver produces a personalized walking schedule with conflict-resolved
  trade-offs and walking-time estimates between stages (need stage
  coordinates).
- Live-mode reroute: "you're running late, [B] starts in 5min on the
  next stage over."

### 3t. Tour tracker
Currently we treat tours as a free-text `tour` field. Promote it:
- A `tour` entity (artist + name + dates).
- "Follow tour" → all dates land in your watching feed.
- Tour page shows: dates, which you've seen, % of tour caught, songs
  played most often this tour, on-sale dates for remaining stops.

### 3u. Show-not-show heuristics
On `Add a show`, when user types a venue + date, run a quick
TM/Bandsintown lookup and show "did you mean: [X] at [Y]?" — kills
typos and pre-fills lineup.

---

## 4. Outside-the-box / longer-tail

### 4a. The "Brain" — chat with your showbook 🎯
A conversational tRPC procedure that takes natural-language questions
and answers from your data:
- "What's the smallest venue I've ever seen Phoebe Bridgers at?"
- "How many shows did I go to in the year I moved to NY?"
- "Who's the artist I saw the most in 2024 but haven't seen yet in
  2025?"
- "Build me a playlist of every song I heard live last summer."

Implementation: structured LLM tool-calling against a small set of
typed query helpers (no SQL-from-LLM). Already have Groq + Langfuse
plumbing.

### 4b. Setlist-from-vision 🧪
Setlist taped to the stage monitor at the start of the show? Snap a
photo, vision LLM extracts the song order, drops it into the show
draft. (We already do this for playbills.) Same flow works for tour
posters, ticket stubs, festival schedules.

### 4c. Voice memo per show ⭐
One-tap voice recording on show detail; Whisper transcribes; LLM
summarises into a "feel" paragraph. Audio stored in R2 alongside
photos. Cheap, intimate, *very* sticky for the post-show 30 minutes.

### 4d. Community venue/show wiki 🧪
Per venue: bag policy, line patterns, best beer, parking, transit
tips, sound notes ("balcony bass-light"), sightline diagrams. Per show:
support-act start time, encore probability, photo policy. Tiny crowd
of contributors per venue, but invaluable signal. Light moderation
(report → review).

### 4e. Tour announcement watcher 🎯
For followed artists *without* an upcoming announcement: monitor
Bandsintown/setlist.fm "added shows" feed and Twitter/Bluesky for the
artist's announcement cadence. Push notification the minute a tour
drops, before TM lists it. This is the single feature that justifies
its own app for the most engaged users.

### 4f. Ticket-drop watcher 🧪
Once a show is on watching: poll for resale price changes (StubHub/
SeatGeek public listing data is scrape-able). Notify on big drops.
Edge: secondary market is ethically grey; would gate behind a setting.

### 4g. "Phantom shows" — the unfollowed 🧪
Run a weekly job: for each user, find shows in their saved regions
that match >70% of their followed artists' genre signature (Spotify
genre tags), even if they don't follow the artist. Surface as a
"You'd probably like…" rail. Risk: noise. Mitigation: opt-in,
explainable ("because you've seen 5 acts tagged shoegaze").

### 4h. Lineup affinity score
On any announced show, render a single 0–100 "affinity" number based
on whether you follow the headliner, support acts, or have seen
related artists. Sort the discover feed by it.

### 4i. Concert stats leaderboard (private) 🧪
Per-friend-group leaderboard: most shows, most venues, most miles.
Phrased as a private game, not a social network. Opt-in only.

### 4j. Memory mode ⭐
Once a year for each show's anniversary, surface it gently — email,
push, Home card. The 5-year-anniversary gets a richer treatment
(animated recap card, "see what's changed at the venue since," etc.).
Memory is the *real* product here.

### 4k. Print product 🎯
Once a year: an auto-laid-out hardcover photo book of your shows,
one spread per show. Setlist + photos + recap + venue card. Use
Lulu/Blurb API. Recurring revenue, high emotional value.

### 4l. ICS feed export 🧪
Already accept ICS for some flows; offer the inverse — every user has
a private webcal feed of their attended/watching shows usable from
Apple/Google Calendar. Strong "becomes part of my life" feel.

### 4m. Apple Wallet pass for upcoming shows 🧪
For each watching show with a confirmed date, generate a `.pkpass`
that lives in the user's wallet alongside the actual ticket. Shows the
predicted setlist, doors time, support, and a tap-to-open into the
Showbook show detail. Auto-updates day-of with weather and transit.

### 4n. NFC / QR at-venue check-in 🧪
Add a Showbook NFC tag at the merch table or print-your-own QR: tap
to confirm attendance + auto-prompt for a photo + start a draft
voice memo. Effectively a "attended" button that's two-tap fast in
a venue with no signal.

### 4o. The "long memory" feature: Decade view 🎯
A scrollable infinite vertical canvas of your concertgoing life,
one row per month, decorative density (busy summers vs. quiet
winters), photo thumbnails. Becomes the screensaver of Showbook —
the thing you show people when they ask "what's this app?"

### 4p. Multi-user / household mode
Shared library between partners or roommates. "We saw [show]" with
per-member attendance flags. Photo galleries merged. Costs split.
Companions become first-class.

### 4q. Privacy/escape pod
Full data export (already common practice) + a "delete and forget"
option that purges all R2 media + DB rows + any cached external IDs.
Lean into it as a feature, not a compliance line.

---

## 5. Cross-cutting infrastructure these unlock

A handful of platform additions that several of the above share:

- **`Team` entity** (sports kind) — parallel to `Performer`, sharing
  `show_*` join shape.
- **`Tour` entity** — promote the `tour` text field to its own row.
- **`Subkind` tag** — graduates lightweight kinds (drag, magic,
  burlesque) without enum churn.
- **External-ID coverage table** — extend the existing pattern to
  TMDB, MBID-extended, ESPN, Bandsintown.
- **Shareable share-card service** — one OG-image-style endpoint that
  renders a 1080×1920 PNG given a stat payload; reused by Wrapped,
  recap, public profile, decade view, tour-of-me.
- **Per-user agent / "Brain"** — one tRPC entry point + tool registry
  + Langfuse-traced runs. Powers chat, predicted setlists, recap
  generation, affinity scoring, tour-announce watcher.
- **Live Activity / Watch complication module** — once one widget
  exists, others come cheap.
- **`Setlist.song` first-class type** — currently a JSON string array;
  graduating to `{ title, mbid?, durationMs?, isCover?, debutOnTour? }`
  unlocks all the setlist intelligence work.

---

## 6. Top-of-funnel ranked recommendations

If forced to pick 5 to ship next, in order:

1. **Personal data import**: Photos library scan (§2e) + expanded
   email parser. Onboards users with their *real* history, not from
   today forward. This is the unlock.
2. **Sports kind** (§1a) with ESPN ingestion. Doubles the addressable
   user. Schema-clean if `Team` is its own entity.
3. **Setlist intelligence + predicted setlist + Spotify playlists**
   (§3d). Pure leverage on data we already have.
4. **Year-in-Review / Wrapped + share cards** (§3a). Onboarding *and*
   virality in one feature.
5. **The Brain** (§4a). The one feature that turns Showbook from a
   tracker into a memory companion.

After those: tour watcher (§4e), photos library scan deep cut (§2e),
companion mode + lightweight friend graph (§3f, §3p), public profile
(§3o), festival optimizer (§3s).

