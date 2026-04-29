# Data model: deletion & follow/unfollow cascades

Investigation of the two open data-model questions in `Planned Improvements.md`.
Snapshot date: 2026-04-29. Schema source of truth: `packages/db/schema/*` and
`packages/db/drizzle/*.sql`.

---

## Current ground truth

### FK `ON DELETE` actions

| FK | Action | Source |
|----|--------|--------|
| `show_announcement_links.show_id` → `shows.id` | CASCADE | `0000` |
| `show_announcement_links.announcement_id` → `announcements.id` | CASCADE | `0006` (added) |
| `venue_scrape_runs.venue_id` → `venues.id` | CASCADE | `0004` |
| `enrichment_queue.show_id` → `shows.id` | **no action** | `0000` |
| `show_performers.show_id` → `shows.id` | no action | `0000` |
| `show_performers.performer_id` → `performers.id` | no action | `0000` |
| `shows.venue_id` → `venues.id` | no action | `0000` |
| `announcements.venue_id` → `venues.id` | no action | `0000` |
| `announcements.headliner_performer_id` → `performers.id` | no action | `0000` |
| `user_*_follows.*_id` → respective | no action | `0000` |
| `shows.user_id`, `user_regions.user_id`, `user_preferences.user_id` → `users.id` | no action | `0000` / `0003` |

### Database trigger: `cleanup_orphaned_venue` (`0002`, extended in `0008`)

Fires AFTER DELETE/UPDATE of `venue_id` on **`shows`** *and* **`announcements`**.
Deletes the venue row iff:

```
NOT EXISTS (shows WHERE venue_id = candidate)
AND NOT EXISTS (announcements WHERE venue_id = candidate)
```

There is **no analogous trigger for performers**. Performer rows are never
auto-cleaned.

### Application-level mutations that perform deletes

| tRPC procedure | What it does (ordered) |
|---|---|
| `shows.delete` | `delete show_performers WHERE show_id=…` → `delete shows WHERE id=…` (which cascades `show_announcement_links`, fires venue trigger). |
| `shows.deleteAll` | Bulk equivalent for the user; also wipes `user_venue_follows` and `user_performer_follows` for the user. |
| `venues.unfollow` | `delete user_venue_follows`; if no other user follows it → delete its `announcements` (cascades `show_announcement_links`); venue trigger may then drop the venue. |
| `performers.unfollow` | `delete user_performer_follows`; if no other user follows it → for each `announcement` with that headliner, delete iff venue not followed by anyone and not in any active region. |
| `performers.delete` | Removes `show_performers` rows linking the performer to **only the calling user's** shows; removes that user's follow row. Performer row itself is **never deleted**. |
| `preferences.removeRegion` | Deletes `user_regions` row; deletes `announcements` whose venue is in the removed bbox AND not preserved by another active region / followed venue / followed performer. Venue trigger may then drop those venues. |

---

## Question 1 — Should venues be manually deletable?

**Recommendation: no — keep deletion implicit via the existing trigger.**

Reasons:

1. **Venues are global, not per-user.** Manually deleting a venue would
   silently affect every user that has shows there. There is no per-user
   "soft delete" of a venue, and adding one would require duplicating the
   venue row per user — a much larger redesign.
2. **The trigger already does the right thing.** A venue auto-deletes the
   moment it has no shows and no announcements. That covers all real
   reasons a venue would need to disappear (the user removed their last
   show there, unfollowed the venue and announcements were pruned, a
   region was removed, etc.).
3. **Renames are already a manual-action escape hatch.** `venues.rename`
   exists for the "wrong venue, fix it" case — no deletion needed.
4. **A user-facing "delete venue" button is dangerous.** It would either
   cascade-orphan the user's shows (data loss) or be blocked whenever
   any show references it (confusing — feels broken). Neither is a good UX.

**One caveat to act on:** `venues.rename` has no auth check (line ~102 of
`venues.ts`) — any signed-in user can rename any venue. Since venues are
global, this is fine for a single-user product but should be tightened
before multi-user. Track separately.

---

## Question 2 — Per-operation impact map

Tables touched on each user-visible action. "trigger" = automatic cleanup;
"may" = conditional on no other references.

### Show deletion (`shows.delete`)
- **shows** — row removed.
- **show_performers** — rows removed (manual; no FK cascade).
- **show_announcement_links** — rows removed (FK cascade from shows).
- **venues** — row may be removed (trigger, if venue now has no shows + no announcements).
- **enrichment_queue** — ⚠️ **NOT cleaned up.** FK is `no action`. If a `ticketed`
  concert with a queued setlist retry is deleted, the delete will fail with
  a FK violation. **Bug.** Either change FK to `ON DELETE CASCADE` or have
  `shows.delete` delete enrichment_queue rows first.
- **performers** — left in place (no orphan cleanup exists).
- **announcements** — untouched.
- **shows.setlists JSONB** — n/a (the row is gone).

### Show update changing venue (`shows.update` with new venue)
- **venues (old venue)** — row may be removed (trigger fires on UPDATE if old
  venue is now orphaned).
- Everything else same as the row staying put.

### Show edit removing a performer (`shows.update`)
- **show_performers** — replaced wholesale.
- **performers** — orphaned rows linger (no cleanup).
- **shows.setlists** — keys for removed performers linger (jsonb is rewritten
  by the update; new map only includes performers passed in input — so
  this is actually fine if the form re-sends setlists for retained
  performers; but if the form *only* sends new ones, prior setlists for
  retained performers would be lost. Worth a quick audit of `add` page.)

### Watching show auto-expiry (nightly job)
- **shows** — row removed.
- **show_announcement_links** — cascaded.
- **show_performers** — needs explicit delete in the job (same FK situation
  as `shows.delete`). Worth verifying `packages/jobs/src/shows-nightly.ts`
  handles this.
- Same enrichment_queue caveat.

### Venue follow (`venues.follow`)
- **user_venue_follows** — insert.
- Side effects: enqueue ingest job (creates announcements); attempt to fill
  `venues.google_place_id` if missing.

### Venue unfollow (`venues.unfollow`)
- **user_venue_follows** — row removed.
- **announcements** — if no other user follows the venue, all its announcements
  are deleted.
  - **show_announcement_links** — cascaded from the announcement deletes.
  - **shows (state=watching)** with only those announcement links: not
    auto-deleted, just disconnected. The watching show stays until its
    date passes (then nightly job removes it).
- **venues** — may be removed by trigger (after announcements delete).

### Performer follow (`performers.follow` / `followAttraction`)
- **performers** — `matchOrCreatePerformer` may insert.
- **user_performer_follows** — insert.
- Side effect: enqueue ingest job.

### Performer unfollow (`performers.unfollow`)
- **user_performer_follows** — row removed.
- **announcements** — if no other user follows the performer, announcements
  where this performer is the headliner are deleted *only if* the venue
  is not followed and not in any active region. Selectively pruned, not
  bulk.
  - **show_announcement_links** — cascaded.
- **performers** — row left in place even if no shows / follows / announcements
  reference it.
- **venues** — may be removed by trigger if announcement deletion orphans them.

### Performer "delete" from artist list (`performers.delete`)
This is the most semantically off action. Today it:
- **show_performers** — removes only rows linking this performer to the
  calling user's shows.
- **user_performer_follows** — removes the calling user's follow row.
- **performers** — row left in place.
- **shows** — left in place. **A show whose only headliner is this performer
  is now headliner-less.** UI shows it as "(no headliner)" — silent data
  loss from the user's perspective.

**Recommendation:** rename the UI action to "Remove from my list" (matching
what it actually does) *or* change semantics to "delete the show too" if
the user really means to forget the show. Don't leave the current ambiguous
behavior. Either way, also clean up:
- `shows.setlists` keys for that performer on the affected shows
- `enrichment_queue` rows for setlists tied to that performer

### Region removal (`preferences.removeRegion`)
- **user_regions** — row removed.
- **announcements** — selectively deleted: only those whose venue's bbox
  was inside the removed region AND not covered by another active region
  AND venue not followed AND headliner not followed.
  - **show_announcement_links** — cascaded.
- **venues** — may be removed by trigger.

### User deletion (theoretical)
Today there's no "delete account" path. If we add one, every FK from a
user-scoped table is `no action`, so the operation needs to manually
delete in this order:
`enrichment_queue` (via shows) → `show_performers` → `show_announcement_links`
(cascaded) → `shows` → `user_venue_follows` → `user_performer_follows` →
`user_regions` → `user_preferences` → `users`. The venue trigger handles
the rest.

---

## Issues surfaced by this investigation (to-do list)

1. **`enrichment_queue` FK is `ON DELETE no action`** — `shows.delete` and the
   nightly auto-delete will fail with a FK violation if a queue row exists.
   Fix: change to `ON DELETE CASCADE` (or delete queue rows in the procedure).
2. **No orphan cleanup for `performers`** — symmetric to the venue trigger.
   Either add a trigger that fires after delete/update on `show_performers`
   + `user_performer_follows` + `announcements.headliner_performer_id`, or
   accept that performer rows accumulate (low cost — they're tiny).
3. **`performers.delete` has misleading semantics** — see above. Rename or
   redefine.
4. **`shows.update` performer replacement may drop setlists** for retained
   performers depending on what the form sends. Audit add/edit page.
5. **`venues.rename` has no auth check** — fine for single-user, problematic
   for multi-user.
6. **`shows.deleteAll` wipes ALL of the user's follows**, not just orphans
   from the deleted shows. Surprising default — confirm in UI or scope to
   "follows that no longer correspond to any show".

None of these are blockers; (1) is the only correctness bug, the rest are
clarity/UX issues.
