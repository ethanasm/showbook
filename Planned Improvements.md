## Remaining (not yet addressed)

### General
- **Security audit.**
- **Critical code smells.** (Run `/ultrareview` to surface specifics.)
- **Discover - Near You** - Right click on regions on the side bar to unfollow, same as artists and venues on Discover. Add a Add a Region button on the top of the side bar in the same format as venues tab (same google places UX as preferences - same limit on number of regions). On artists tab, move the add artist to follow button to the top of the sidebar like it will be on the other two tabs. 

### Mobile App
- We have some hifi designs of mobile app through claude design, but we need to do a deep dive on a design for the mobile app now that we've added more features.
- Hook up push notifications in preferences page to mobile app once done.

---

## Completed (kept for reference)

### Observability
1. ~~**Langfuse integration for observability.**~~ *(Done — every Groq call is wrapped via `traceLLM` in `@showbook/observability`; LLM-invoking tRPC procedures and pg-boss handlers wrap their entry points with `withTrace` so generations nest under user/job traces. No-op when `LANGFUSE_*` env unset.)*
2. ~~**Better structured logging (project-wide).**~~ *(Done — pino logger in `@showbook/observability` with optional `@axiomhq/pino` transport when `AXIOM_TOKEN` set. ~60 ad-hoc `console.*` calls across api/jobs/scrapers and Next.js handlers replaced with structured logs (component bindings, dotted `event` field, `err` serializer). New logs added at previously silent boundaries: TM/setlist.fm/Gmail requests with status + duration, venue/performer follow + unfollow, auth signin/signout, scraper per-venue, digest per-user.)*

### General Improvements
1. ~~**Friendlier UX with better imagery and layouts.**~~ *(Done — editorial UX pass across home, shows, venues, artists, discover, map, add, signin and venue/artist detail pages. New shared `design-system` primitives: `HeroCard` (with top-biased headliner crop), `EmptyState`, `PulseLabel`, `StackedCards`, `RemoteImage`. Venue photos: `venues.photo_url` column (`0015_venue_photos.sql`), Google Places-backed `/api/venue-photo/[venueId]` proxy, and `backfill-venue-photos` job. Subsequent fixes in `Fix four UX-pass bugs` and `Venue detail: compress middle third, prioritise user's own history`.)*
2. ~~**Photo and video support.**~~ *(Done — app-managed Cloudflare R2 media storage with hard app-level quotas below the free tier; `media_assets` + `media_asset_performers` schema (`0016_media_assets.sql`), R2 presigned upload/read helpers, local dev upload mode, and `media` tRPC procedures for quota, upload intent, completion, listing, and delete. Show detail now has polished photo/video upload, quota, gallery, error, and playback states; venue and artist detail pages aggregate media from shows. `.env.example` documents required R2 and media quota variables. Verified by API typecheck/tests, web build, migration, and Playwright screenshot/upload check.)*
3. ~~Views need to look ok when the screen size is half of full width. Rows should have certain columns omitted at this width to fit properly, stuff should still look clean. Some pages are better than otthers. All should be reviewed but pages that don't look good:~~
	- ~~Shows list~~
	- ~~Add a show~~
	- ~~Discover~~
	- ~~Map (header)~~
4. ~~MusicBrainz (high priority) - what are we using these ids for? Where are they stored?~~ *(Cached MusicBrainz IDs on `performers`; populated by TM `externalLinks.musicbrainz` and setlist.fm artist search; used to skip the artist lookup step when fetching setlists. Column renamed `setlistfm_mbid` → `musicbrainz_id` since both sources populate it.)*
5. ~~Ingestion for regions - limit should be increased from 100 to 1000. Verify that we are properly deduping ticketmaster venue ids and/or google place ids.~~
6. ~~In compact view, There is a button that directs to /me but that gives 404. It should go to preferences instead. Alos instead of add button in the middle that should open a dropdown to get to the other pages (discvoer, vneues, artists, etc. )~~
7. ~~A few of these pages take a long time to load. When I click on different pages, it takes a while for anything to respond and it feels like a sluggish UX. Can we go to the page quicker and have a frame that shows while APIs are loading?~~ *(Done — Shows/Venues/Artists/Discover/Preferences now render layout-shaped skeletons and use `staleTime: 60_000` on their primary queries, matching Home + sidebar.)*
8. ~~Notes support for shows.~~ *(Done — `shows.notes text` column in 0012, accepted by create/update, textarea on Add/Edit, rendered on show detail.)*
9. ~~Email notifications. What's needed to enable for free, and what should the email content look like (functional + sleek + modern).~~ *(Done — Resend-backed daily digest job (`packages/jobs/src/notifications.ts`) renders a sleek dark editorial email matching the Showbook UI (cream ink on near-black, gold accent, tracked uppercase labels, contextual hero, on-sale chip, CTA). Sender is env-driven via `EMAIL_FROM`; `apps/web/.env.example` documents `RESEND_API_KEY`, `EMAIL_FROM`, `NEXT_PUBLIC_APP_URL`. Free tier of Resend covers typical personal usage. Toggle lives in Preferences.)*

### Home Page
1. ~~Remove Godo evening and date from header. Replace with some image or icon that would be appropriate there.~~
2. ~~For stats on other side, remove spent. Alos venues should not have NYC. Make sure the other stats are wired up properly.~~
3. ~~Venue details should be hyperlinked to venues for sub-hero cards~~
4. ~~Artist detil page should be linked from recent rows.~~
5. ~~Clicking on recent rows anywhere else should go to show detail page.~~
6. ~~If home is in empty state, there should be a friendly message and a button to improt from gmail that is already in the header of the shows list page.~~

### Add a Show Page
1. ~~We need to redesign this. Use UI/UX best practices. Import from seems logical to be at the top. The date should be near timeframe - the timeframe slector should update automatically between past and watching depending if the date is in the past or future.~~
2. ~~Playbill photos - what is this for?~~ *(Answered: theatre-only OCR cast extraction. Image goes to Groq's `meta-llama/llama-4-scout-17b-16e-instruct` vision model, comes back as `{actor, role}` pairs, and auto-populates `show_performers` rows with `role: 'cast'` + `characterName`. Image itself is not stored. Verified by `apps/web/tests/playbill-cast-extract.spec.ts`. The schema's existing unused `shows.photos text[]` column is ready for general photos when that lands.)*
3. ~~Remove other headliners field - lineup will handle all performers.~~

### Discover Page
1. ~~On the lists on the leftside, I should be able to right click on the followed venue or followed artist and see an option to unfollow. Unfollowing should remove it server-side and update the current display.~~
2. ~~On the followed artists page, check if there is a ticketmaster API to search for artists. See if we can follow an artist this way and have a FOllow another artist button on the left list of this page.~~
3. ~~Near You tab should have the venues grouped by region. The region header should be able to be rlght clicked to see an option to unfollow. Unfollowing should remove it server-side and update the current display. The announcements should only be removed if they arent for existing followed venues or artists.~~
4. ~~Remove the hyperlink to nothing on the rows.~~

### Venue Details Page
1. ~~TM linked venues do not need scrape config section on this page.~~
2. ~~If we follow a venue and the venue does not have a google place id yet, we should attempt to search and set one. If this came from ticketmaster ingestion via discover page, we don't have a google place id yet.~~
3. ~~Unfollowing a venue that doesn't have any attended shows where the venue is deleted gives no visual indication. When refreshed, the page shows venue no longer exists error. In this case, we should redirect to venues list page.~~
4. ~~View on map should take to the map view (it does) WITH the side panel for this venue opened and zoomed in to the lcoation on the map (it does not do this yet)~~

### Venues List Page
1. ~~I should be able to right click on a row and see the following options:~~
	1. ~~Rename (which should be an inline action)~~
	2. ~~Follow (which should live update the icon on the row)~~
2. ~~Paginate the table. Lets start with 15 in compact mode and 12 if not.~~
3. ~~State and City column should be swapped~~

### Shows List Page
1. ~~I should be able to right click on a row and see the following options:~~
	1. ~~Edit~~
	2. ~~Delete~~
	3. ~~Mark as attended (if state is TIX)~~
	4. ~~Got tickets (if state is WATCHING)~~
	5. ~~Ticketmaster (if ticketmasterUrl is populated)~~
2. ~~Remove expanded view for a row sicne we're replacing with a context menu. Remove the arrow on the row.~~
3. ~~Paginate the table. Lets start with 12 in compact mode and 10 if not.~~
4. ~~Calendar~~
	1. ~~Can we have a year view in additon to monthly view?~~
	2. ~~The month switcher always says Today~~
	3. ~~The bounds of the month switcher should be from the available show data~~
5. ~~Stats~~
	1. ~~The stats should update based on the time filter selection. They are currently stuck on all time regardless.~~

### Artist List Page
1. ~~I should be able to right click on a row and see the following options:~~
	1. ~~Rename~~
	2. ~~Delete~~
	3. ~~Mark as attended (if state is TIX)~~
	4. ~~Got tickets (if state is WATCHING)~~
2. ~~The three rightside columns need to be shifted left and spaced out more evently.~~
3. ~~Add a visual indicator to the end of the column for whether the artist is followed or not. Use the venue list page as an example. Also respace the columns after this addition.~~
4. ~~Paginate the table. Lets start with 15 in compact mode and 12 if not.~~

### Map Page
1. ~~Shortcuts in bottom right of map should be: Bay Area, LA, Oregon, NYC, and World~~
2. ~~Remove watch upcoming from venue side panel - log a visit does the same thing.~~
3. ~~Follow is not working properly from the venue side panel. I follow a venue, click discover and dont see it in followed venues.~~

### Show Detail Page
1. ~~Setlists should be stored in the DB as a dictionary of perform to setlist object. The add a show page should stay as it is, but the show detail page should show all of the setlists for the different artists. This should be displayed in an easy to consume way. Only one setlist at a time - switch between by artist picker.~~ *(Schema: `shows.setlists jsonb` keyed by performerId, backfilled from legacy `shows.setlist text[]`. Add page now also writes per-performer setlists with a "Search setlist.fm" button per performer.)*

### Preferences
1. ~~I should be able to set the digest time and discover digest through the UI (time is just a static string right now). This needs to be verified to be hooked up to a scheduled job.~~ *(Was already wired — `preferences/page.tsx` has a real `<input type="time">` writing `digestTime`, and `notifications.ts` filters users by `extract(hour from digestTime)`. Verified end-to-end.)*
2. ~~Remove the show-day remidner setting.~~
3. ~~Set a limit of five regions to track and have that be clear in the UI.~~
4. ~~Paginate the followed venues so it doesnt take up the whole page. 10 at a time.~~
5. ~~Remove wikipedia from data sources at bottom.~~

### Data Model Questions
1. ~~Do we allow venues to be deleted?~~ *(Answered: no, not directly. There is no `venues.delete` mutation. Venues are auto-cleaned by the Postgres trigger `cleanup_orphaned_venue` (`packages/db/drizzle/0002_venue_cleanup.sql`, updated in `0008_venue_cleanup_announcements.sql`) which fires after DELETE/UPDATE on `shows` and `announcements` and removes the venue row only if no rows remain in either table referencing it. Adding an explicit delete would orphan shows (FK is RESTRICT). The trigger model is correct.)*
2. ~~Tables affected by delete/unfollow/follow.~~ *(Answered:)*
   | Action | Tables modified |
   |---|---|
   | **Show delete** (`shows.delete`) | `show_performers` (manual), `shows`, `show_announcement_links` (cascade), `venues` (trigger if orphaned). `enrichment_queue` rows persist — no cascade. |
   | **Show update of `venueId`** | `shows`, then trigger may delete the **old** `venues` row if now orphaned. |
   | **Venue follow** (`venues.follow`) | `user_venue_follows`; optional `venues` update if Google Place ID is backfilled; queues ingestion. |
   | **Venue unfollow** (`venues.unfollow`) | `user_venue_follows`, `announcements` (if no other followers), `show_announcement_links` (cascade), `venues` (trigger). |
   | **Artist follow** (`performers.follow`) | `user_performer_follows`; queues ingestion. |
   | **Artist unfollow** (`performers.unfollow`) | `user_performer_follows`, `announcements` (smart-delete via `computePerformerAnnouncementsToDelete`, respecting other follows/regions), `show_announcement_links` (cascade), `venues` (trigger). |
   | **Artist "delete"** (`performers.delete`) | Only removes `show_performers` rows for **the user's own** shows. Never deletes the global `performers` row. (Misnamed — really "remove from my shows".) |
   | **Region remove** (`preferences.removeRegion`) | `user_regions`, `announcements` (smart-delete), `show_announcement_links` (cascade), `venues` (trigger). |
   | **Region toggle/add** | `user_regions`; queues ingestion. No deletion. |

   No triggers exist that auto-delete performers, follow rows, or shows. The only auto-cleanup trigger is on `venues`.
