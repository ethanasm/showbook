# Phase 2 — Songs page + per-song detail

> **Goal.** Surface the song-level data accumulated by Phase 1's
> indexer. New `/songs` page (table view), per-song detail page,
> "songs you've heard live" + tour-debut sections on artist pages.
> Web only this phase; mobile lands in Phase 10.

| Estimated effort | ~1 week |
| Critical path? | No (parallel to Phase 3, 4) |
| Prerequisites | Phase 1 |
| Ships | Web `/(app)/songs/`, `/(app)/songs/[id]/`, artist-page extensions |

References:
- [`../feature-plan.md`](../feature-plan.md) §4a, §4b, §4e, §7b
- [`../ui-spec.md`](../ui-spec.md) §6 (web responsive)

---

## Code

### `packages/api/src/routers/setlist-intel.ts` (extend)

```ts
setlistIntel.songStats({ songId })             // history of a single song for the user
setlistIntel.rareCatches({ scope, limit })     // already in P1; expand here for the page UI
```

### Web routes

#### `apps/web/app/(app)/songs/page.tsx` (new)

Table view of every song the user has heard live. Reuses the
existing `/(app)/venues/` and `/(app)/artists/` table chrome —
sticky filter sidebar + sortable columns + 12-row pagination.

Columns: title · artist · times heard · last heard · rarity %.
Filters: artist, year, rarity threshold.

#### `apps/web/app/(app)/songs/[id]/page.tsx` (new)

Per-song detail page. Layout:

```
┌─ song detail ─────────────────────────────────┐
│ ← The National                                 │
│   "Light Years"                                │
├────────────────────────────────────────────────┤
│  Heard live · 3 times                          │
│                                                 │
│  First            Sep 12, 2019 · MHoW          │
│  Most recent      Mar 22, 2025 · MSG           │
│  In recent setlists · 78%                      │
│                                                 │
│  [▶ Spotify]                                   │
│                                                 │
│  Your shows where it played:                   │
│    • Sep 12, 2019 — Music Hall of Williamsburg │
│    • Aug 14, 2023 — Forest Hills Stadium       │
│    • Mar 22, 2025 — Madison Square Garden      │
└────────────────────────────────────────────────┘
```

The Spotify button uses the existing `Linking.openURL` pattern from
the artist-import flow. For now, link to the canonical Spotify URL
for `songs.spotify_track_id` if populated (resolved by P3's
`spotify-track-resolve` job; nullable until then).

### `apps/web/app/(app)/artists/[id]/page.tsx` (edit)

New sections below the existing tagged-photos grid:

1. **Songs you've heard live** — list of `(song, count)` rows
   ordered by frequency (cap at 25; reuse the `/songs` table
   chrome).
2. **Tour debuts you caught** — only when the user has any. Single
   line per row: `"Light Years" · Sep 12, 2019` with a tap to
   per-song detail.

Empty states for both sections — when the user has zero songs from
this artist indexed, the section collapses entirely.

### `apps/web/app/(app)/shows/[id]/page.tsx` (edit)

The third segment in the `SegmentedControl` (`Setlist · Predicted ·
Songs`) gets its content. Renders a list of the songs played at
this show with badges:

- 🆕 **First time** — pulled from `tourDebutsCaught`
- 🎯 **Rare** — pulled from `rareCatches` with frequency tooltip

Each row taps through to the song detail page.

---

## Tests

### Unit

- `setlistIntel.songStats` — synthetic appearances over multiple
  shows; assert ordered timeline
- `setlistIntel.rareCatches` SQL — covered indirectly by integration
  tests; verify the boundary rate (5%) is honored

### Integration

- Seed a corpus where one song appeared in 3% of recent setlists;
  assert it surfaces as a rare catch on a user's show that included
  it
- Seed a song that's a tour debut; assert it appears in
  `tourDebutsCaught`

### E2E (Playwright)

- `apps/web/tests/songs-page.spec.ts` — open `/songs`, sort by
  frequency, navigate to per-song detail, assert show list

---

## Observability events

No new events — the procedures emit the existing `trpc.error` /
list-invalidation events. The page is read-only.

---

## Exit criteria

1. `/songs` page renders for a test user with ≥10 indexed songs;
   sorting + filters work; pagination works.
2. `/songs/[id]` opens to <300ms paint.
3. Artist detail page shows the new sections for any artist with ≥1
   indexed song; both sections collapse cleanly when empty.
4. Show detail Songs segment shows badges correctly for rare
   catches and tour debuts.

---

## What this phase does NOT include

- Spotify previews on song rows (Phase 9)
- Vibe / energy data on songs (Phase 8)
- Personal-weight chip data (Phase 7)
- Mobile equivalents (Phase 10)
- The Spotify hype-playlist button on the predicted view (Phase 3)
