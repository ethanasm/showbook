# Data model: deletion & follow/unfollow cascades

Investigation of the two open data-model questions in `Planned Improvements.md`.
Snapshot date: 2026-04-29. Schema source of truth: `packages/db/schema/*` and
`packages/db/drizzle/*.sql`.

> **Status (2026-04-29):** The recommendations in the analysis section
> were implemented in migration `0012_cascade_show_relations.sql` and
> the accompanying router/job edits. The "current" tables below describe
> the pre-`0012` state; see the `Status` block at the bottom of this doc
> for what shipped.

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

---

## Code-side vs DB-side cleanup: full compilation & analysis

The codebase mixes three cleanup mechanisms:
- **FK `ON DELETE CASCADE`** — automatic, structural
- **DB trigger** — automatic, can encode lightweight conditions
- **Application code** — explicit, can encode business logic

This section enumerates every cleanup site and recommends where it
belongs.

### Compilation

| # | Trigger event | Cleanup performed | Where today | Notes |
|---|---|---|---|---|
| C1 | `shows` row deleted (any path) | delete dependent `show_performers` | code (`shows.delete`, `shows.deleteAll`, `shows.update`, `runShowsNightly`, `discover.unwatch`) | FK is `no action`; every call site repeats the same boilerplate. **Buggy at `discover.unwatch`** — comment claims it cascades, but it doesn't. |
| C2 | `shows` row deleted | delete dependent `show_announcement_links` | DB cascade (`0000`) ✓ | `runShowsNightly:55` and `discover.unwatch:506` redundantly delete first. `runShowsNightly` even has a "be explicit" comment. |
| C3 | `shows` row deleted | delete dependent `enrichment_queue` rows | **nowhere** | FK is `no action`. **Latent bug** — any concert with a queued retry will throw on delete. |
| C4 | `announcements` row deleted | delete dependent `show_announcement_links` | DB cascade (`0006`) ✓ | `venues.unfollow:143` redundantly deletes first. |
| C5 | `venues` row deleted | delete dependent `venue_scrape_runs` | DB cascade (`0004`) ✓ | Right place. |
| C6 | last `show` and last `announcement` reference a venue gone | delete `venues` row | DB trigger `cleanup_orphaned_venue` (`0002`/`0008`) ✓ | Right place. |
| C7 | venue unfollowed by last user | delete that venue's `announcements` | code (`venues.unfollow`) | Multi-tenant business decision — needs cross-user visibility. Stays code. **But the rule is incomplete**: doesn't preserve announcements whose venue is in someone's active region (asymmetric with C8). |
| C8 | performer unfollowed by last user | selectively delete `announcements` where this performer headlines AND venue not followed AND venue not in any region | code (`performers.unfollow` → `computePerformerAnnouncementsToDelete`) | Rich, cross-user logic. Stays code. |
| C9 | region removed | selectively delete `announcements` in the bbox not preserved by other regions/follows | code (`preferences.removeRegion` → `computeAnnouncementsToDelete`) | Rich logic. Stays code. |
| C10 | watching show date passed | delete the show + dependent rows | code (`runShowsNightly`) | Business policy ("auto-expire watching"); stays code. |
| C11 | announcement older than 7 days past | delete | code (`discover-ingest` Phase 4) | Business policy; stays code. |
| C12 | setlist enrichment succeeds / gives up | delete `enrichment_queue` row | code (`runSetlistRetry`) | Self-managed queue; stays code. |
| C13 | `shows.deleteAll` | wipe `user_venue_follows` + `user_performer_follows` for the user | code (`shows.deleteAll`) | Policy decision — see issue (6) above; questionable default. |
| C14 | performer "delete" from a user's artist list | unlink only that user's `show_performers` rows; remove their follow | code (`performers.delete`) | Per-user scope; stays code, but the **semantics are misleading** (see issue 3). |
| C15 | orphaned `performer` row (no `show_performers`, no follows, no announcements reference it) | delete | **nowhere** | Symmetric to C6 but missing. Optional — performer rows are tiny. |
| C16 | show photos field changed / show deleted | delete corresponding R2 objects | **nowhere** | Spec calls for it (`schema.md:85`); photos aren't implemented yet. Track when photos land. |
| C17 | `users` row deleted | delete every user-scoped row | **nowhere** (no delete-account flow) | Will need an explicit ordered teardown when added. |

### Heuristic for placement

DB-side (cascade or trigger) wins when **all** of:
- The cleanup is unconditional given the parent delete
- It's pure referential / structural housekeeping
- No external systems (R2, pg-boss, webhooks, email) need to be notified
- Multiple call sites would otherwise duplicate the same code

Code-side wins when **any** of:
- The decision depends on data the trigger can't see efficiently (cross-user follow/region state, current user identity, request inputs)
- The cleanup has external side effects (R2 deletes, queued jobs, emails)
- The rule is a business policy, not referential integrity (auto-expire, prune-after-7-days)
- The caller needs structured feedback about what happened

### Recommendations

**Move to DB-side (concrete fixes):**

1. **C1: change `show_performers.show_id` FK to `ON DELETE CASCADE`.**
   Currently five call sites repeat `delete(show_performers).where(show_id IN …)` before deleting shows. One of them (`discover.unwatch`) is buggy — the comment claims a cascade exists, but it doesn't, so unwatching a watched announcement throws if the show has a `show_performers` row (which it always does for non-theatre via `shows.create`). After the cascade, all five sites can drop the explicit pre-delete.

2. **C3: change `enrichment_queue.show_id` FK to `ON DELETE CASCADE`.**
   Same pattern — pure referential, nothing else needs to know. Fixes the latent bug where deleting a freshly-past concert with a queued retry fails.

**Stays in DB-side, no change:**

3. **C2, C4** — cascades correct. *Remove redundant code-side deletes* in `runShowsNightly:55`, `discover.unwatch:506`, and `venues.unfollow:143`. They were defensive but are now dead weight.

4. **C5, C6** — cascades/trigger correct.

**Stays in code-side, no change:**

5. **C8, C9, C10, C11, C12, C14** — all need cross-user, cross-region, or business-policy logic that doesn't translate to triggers.

**Stays in code-side, but fix the rule:**

6. **C7 (venue unfollow)**: extend the deletion criterion to mirror C8 — also preserve announcements whose venue lat/lng falls inside any user's active region. Today it deletes too aggressively when no one follows the venue but someone has it in a region.

7. **C13 (deleteAll wiping follows)**: scope to "follows that have no shows after the deletion" rather than wiping all of them.

**Optional additions:**

8. **C15 (orphan performer trigger)**: add `cleanup_orphaned_performer` trigger symmetric to `cleanup_orphaned_venue`, firing on `show_performers` / `user_performer_follows` / `announcements.headliner_performer_id` mutations. Nice for symmetry; cost of skipping is low because performer rows are small.

9. **C16, C17**: track in their own follow-ups when those features land.

### Why not just CASCADE everything?

Tempting — would simplify a lot of code. Resist for these specifically:

- **`shows.user_id` → `users.id`**: leave as `no action`. Account deletion is a sensitive operation that should go through an explicit, auditable flow with R2 cleanup, pg-boss job cancellation, and a confirmation step. A surprise cascade could wipe years of show history if someone's auth row gets corrupted or deleted in a backfill.
- **`announcements.venue_id` → `venues.id`**: leave as `no action`. The trigger inverts the dependency (venue goes when announcements + shows are gone). If we cascaded the other way, deleting a venue would silently nuke other users' watchlists.
- **`user_*_follows.venue_id` / `.performer_id`**: leave as `no action`. Currently the orphan-cleanup paths delete follows before letting the parent go (or never delete the parent at all). Cascading would hide bugs where we accidentally delete a venue/performer that still has followers.

A CASCADE makes the schema enforce a directionality. Use it where the directionality is obvious (a `show_performers` row is meaningless without its show); avoid it where the parent's "deletion" is itself a derived state (venues, performers, users).

---

## Status — what shipped (2026-04-29)

Migration: `packages/db/drizzle/0012_cascade_show_relations.sql`.

**FK changes:**
- `show_performers.show_id` → `ON DELETE CASCADE` (was `no action`).
- `enrichment_queue.show_id` → `ON DELETE CASCADE` (was `no action`).

**New trigger: `cleanup_orphaned_performer`** — symmetric to
`cleanup_orphaned_venue`. Fires on:
- `AFTER DELETE` / `AFTER UPDATE` on `show_performers` (when `performer_id` changes)
- `AFTER DELETE` on `user_performer_follows`
- `AFTER DELETE` on `announcements`

A performer row is removed once nothing references it across
`show_performers`, `user_performer_follows`, or
`announcements.headliner_performer_id`.

**Code changes:**
- `shows.delete` — drops manual `show_performers` pre-delete (now cascades).
- `shows.deleteAll` — drops manual `show_performers` pre-delete; **no longer wipes follows** (follows are independent of show history).
- `shows.update` — unchanged (still replaces performers explicitly; orphan trigger handles abandoned performers).
- `runShowsNightly` — drops manual `show_performers` and `show_announcement_links` pre-deletes.
- `discover.unwatchlist` — drops manual `show_announcement_links` pre-delete; this also fixes the latent FK bug where the comment claimed `show_performers` cascaded but it didn't.
- `venues.unfollow` — drops manual `show_announcement_links` pre-delete; **announcement deletion now respects active regions and followed performers** (mirrors `performers.unfollow`). New helper: `computeVenueUnfollowAnnouncementsToDelete` in `preferences.ts`.

**Tests:**
- `packages/api/src/__tests__/venue-unfollow-cleanup.test.ts` — 7 unit tests for the new helper.

**Not implemented:**
- C16 (R2 photo cleanup on show delete) — photos feature isn't built yet; track with the photos work.
- C17 (account deletion) — no account-deletion flow exists yet; track when it's added.
- The `performers.delete` UI semantics question — pure UX, not a placement issue. Track separately.
- The latent `cleanup_orphaned_venue` ↔ `user_venue_follows` race (the trigger doesn't check follows; if a user deletes their last show at a followed venue with no announcements, the trigger's `DELETE FROM venues` would hit an FK from `user_venue_follows`). Rare in practice but worth a follow-up.
