# Discovery + Shows IA — Decisions Log (Pending Implementation)

This captures the product decisions made in chat on Apr 21 2026 that are **not yet reflected in the design files**. Pick this up in a new session to implement.

## Confirmed Decisions

### 1. New 6th tab: **Discover**
- Feed of announcements from **followed venues** (primary signal) + **shows near you**
- **No on-sale alerts** (out of scope for v1)
- **No dismiss action** — just a running list; age out past-date items silently
- Watchlisting an announcement moves it into the Shows list with a `WATCHING` state

### 2. Shows tab — stays **mostly as is**
- **Do not add** Past/Upcoming/Watchlist segmentation
- **Single continuous List** — one stream including future shows
- **Year rail extended** to include future years: `2027 · 2026 · 2025 · 2024 · older` (today + 1 year)
- **Row decoration per state**, three states to distinguish:
  - Past (default)
  - Upcoming with tickets — `TIX` marker
  - Upcoming on watchlist — `WATCHING` marker
- Approach: **left-edge bar + right-side chip** (combine both)
- **Kind column** gets distinctive icons (not just colored dot + word):
  - Concert → mic on stand
  - Theatre → proscenium arch with curtains
  - Comedy → mic with spotlight cone from above
  - Festival → tent with flag on top
  - Add to `hifi/sb-tokens.jsx` → `window.Icon` (24×24, 1.6px stroke, match existing icon style)

### 3. Home — **no changes**
- Stays hero: Next up + Recent 5
- **No carousel**
- No expanded upcoming list

### 4. Notifications
- **Digest** (not real-time) — daily 8am default
- Mobile: user-configurable channel — Push / Email / Both (default: Push)
- Web: Email only

### 5. Geography / markets
- Primary: **Bay Area** (SF, Oakland, Berkeley, San Jose)
- Secondary: **LA, Las Vegas**
- User toggles active markets in settings
- "Near me" radius (default 30 mi) within active markets

### 6. Data sources
- **Concerts/festivals** → Ticketmaster Discovery API
- **Theatre** → scrape broadwaysf.com, playhouse sites, Playbill
- **Comedy** → scrape venue sites (TBD specific sources)

### 7. Artist tracking
- **Implicit** at ≥ 2 attended shows → auto-added to tracked artists
- **Explicit opt-in/opt-out** toggle on artist page

## Implementation Checklist (for next session)

1. Add 4 kind icons to `hifi/sb-tokens.jsx` → `window.Icon` (Concert, Theatre, Comedy, Festival)
2. Update `hifi/shared-data.jsx`: add `state: 'past' | 'tix' | 'watching'` to sample shows; add a couple watchlist items
3. Rework Shows List row in `hifi/v2-shows.jsx`:
   - Replace dot+label with new kind icon + label
   - Left-edge bar: kind color for past, outlined for tix, dashed for watching
   - Right-side chip: `TIX` / `WATCHING` / blank
   - Year rail includes 2027 (today+1)
   - Merge upcoming strip into the unified list (remove the separate "Upcoming · 4" block — it's just rows in the stream now)
4. New file `hifi/discover.jsx` — Discover tab (mobile + web)
   - Top segmented: "Followed venues" / "Near you"
   - Announcement cards with reason chip, watchlist action
5. Update `hifi/v2-shell.jsx` sidebar to include Discover as 6th item
6. Upgrade venue inspector in `hifi/map-web.jsx` / `map-mobile.jsx` to include **Follow** button
7. Add Discover artboards to `hifi-v2.html` canvas
8. Regenerate screenshots; update `design_handoff_showbook/README.md`

## Data Model Additions (for handoff README)

```ts
type Venue = {
  // existing
  followed: boolean;
  followedAt?: string;
  market: 'bay-area' | 'la' | 'vegas' | 'other';
};

type Show = {
  // existing +
  state: 'past' | 'tix' | 'watching';  // derived from date + ticketed flag + watchlist
};

type Announcement = {
  id: string;
  venueId: string;
  kind: 'concert' | 'theatre' | 'comedy' | 'festival';
  headliner: string;
  support?: string[];
  showDate: string;
  onSaleDate?: string;
  source: 'ticketmaster' | 'broadwaysf' | 'playhouse' | 'scrape';
  sourceUrl: string;
  status: 'announced' | 'on-sale' | 'sold-out';
  watchlisted: boolean;
  discoveredAt: string;
  reason: 'followed-venue' | 'nearby' | 'tracked-artist';
};

type UserSettings = {
  activeMarkets: ('bay-area' | 'la' | 'vegas')[];
  notifyChannelMobile: 'push' | 'email' | 'both' | 'none';
  notifyChannelWeb: 'email' | 'none';
  digestTime: string;      // '08:00' default
  nearMeRadius: number;    // miles, default 30
};
```
