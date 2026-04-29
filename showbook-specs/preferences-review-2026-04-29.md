# Preferences page review

**Date:** 2026-04-29
**Branch:** `claude/review-preferences-page-KuLUU`
**Scope:** `apps/web/app/(app)/preferences/page.tsx` and everything wired to it
**Method:** Logged in via `/api/test/login` (test auth) and exercised every control with Playwright.

## What works

- Page renders all six sections (Account, Appearance, Notifications, Regions, Followed venues, Data sources).
- `Email` displays the session user's email.
- `Theme` SegmentedControl flips System/Light/Dark; the `--active` class is correct on reload.
- `Compact mode`, `Discover digest`, all three notification toggles, and the `Digest time` input all round-trip through `prefs.update` and survive reload.
- `Follow a venue` modal opens, focuses the input, and closes correctly.
- `Region toggle / remove` mutations are wired up.

## Bugs found

### #1 Theme is server-saved but never server-read (multi-device drift)
`ThemeProvider` (`apps/web/components/design-system/ThemeProvider.tsx:45-52`) only reads `localStorage`. The preferences page also writes `prefs.theme`, but nothing reads it back, so a fresh browser/device always falls back to the local default. The DB column is decorative.
**Fix:** hydrate `ThemeProvider` from server prefs on mount, or drop the column.

### #2 Digest cron will never fire (string format mismatch) — *high impact*
- `packages/db/schema/preferences.ts:19`: `digestTime: time('digest_time')` returns `HH:MM:SS`.
- `packages/jobs/src/notifications.ts:181`: `currentHour = "${HH}:00"` (no seconds).
- The cron uses `eq(userPreferences.digestTime, currentHour)`; `"08:00:00" !== "08:00"`.

No user will ever match. Every digest / show-day reminder is dead.

The UI also lets the user pick `HH:MM` (half-hours), which the cron can never honor since it only ticks at the top of the hour.

### #3 `compactMode` is a no-op
Schema, router, type, UI present. Zero consumers across `apps/web` and `packages/`. Toggling does nothing visible.

### #4 `pushNotifications` is a no-op
Same shape as #3 — schema/router/UI exist, no consumer, no push system.

### #5 Add-Region is unreachable when Places API isn't 200-OK
`AddRegionForm` only enables submit once `latitude`/`longitude` are set, and they are *only* set by the Places `placeDetails` callback. There's no manual lat/lng input, no error message, no fallback. Sandbox repro: `enrichment.searchPlaces` 500s (`self-signed certificate in certificate chain`) and the dropdown shows a permanent **"Searching…"** state with the **Add Region** button stuck disabled.

### #6 Add-Region dropdown overlaps the action buttons
Absolute-positioned dropdown sits on top of the **Add Region / Cancel** buttons (visible in `prefs-add-region.png`).

### #7 Follow-a-venue: silent failure when search fails
`VenueFollowModal` shows `"No venues found"` whenever `venues.search` is empty AND `enrichment.searchPlaces` returns nothing usable. In the sandbox the Places call 500s — there's no error feedback; the user assumes the venue doesn't exist.

### #8 Account section is read-only and incomplete
- No sign-out button on the page (it's hidden in the sidebar's `…` menu).
- User `name` from session is not displayed.
- No account deletion / data export.
- The `<Sidebar>` user widget in `AppShell.tsx:42` doesn't pass `userName`/`userInitials`, so it always shows the hardcoded **"Ethan Smith / synced 2m ago / ES"** placeholder regardless of session.

### #9 Data Sources section is fake
`DATA_SOURCES` (`page.tsx:470-475`) is a hardcoded array. No health check, no OAuth connect, no per-user state.

### #10 Digest-time UI is inconsistent with its semantics
- Minute picker suggests sub-hour granularity that the cron doesn't support.
- `Digest time` stays editable when **Discover digest = Off**, implying it does something.

### #11 Console noise on every navigation
Every page transition logs ~3-5 next-auth `ClientFetchError: Failed to fetch` errors against `/api/auth/session` (`ERR_ABORTED` from cancelled in-flight session fetches). Harmless but pollutes logs.

## Recommended order to land fixes

1. **#2** – one-line normalization (most user-visible: re-enables every notification feature).
2. **#1** – hydrate `ThemeProvider` from `prefs.theme` on first authenticated load, or delete the column.
3. **#5 / #7** – surface errors and add manual lat/lng fallback for region creation.
4. **#3 / #4** – consume the columns or delete them.
5. **#8** – pass `userName`/`userInitials` from `useSession()` into `<Sidebar>`; add Sign Out + name to the Account card.

## Status of fixes

- [x] **#1** Theme hydration — `PrefsServerSync` reads `prefs.theme` on first arrival and pushes it through `setTheme`. Verified: a fresh browser context picks up `data-theme="light"` after another context set Light.
- [x] **#2** Digest cron time format — `notifications.ts` now compares `extract(hour from digest_time) = $hour`, and the picker quantizes to whole hours via `step={3600}` + `slice(0,2)+":00"` on save.
- [x] **#3** Consume `compactMode` — `PrefsServerSync` mirrors it to `<html data-compact="true">`; `[data-compact="true"] .show-row { padding: 4px 16px; min-height: 36px }` and the equivalent for `.discover-row`; `useCompactMode()` hook drops row padding on `home`, `venues`, `artists`. Verified: shows-row goes 53px → 39px when toggled.
- [ ] **#4** `pushNotifications` — deferred (per direction).
- [x] **#5** Add-region error handling + manual coordinates fallback — error rows in the autocomplete dropdown, an "Enter coordinates manually" toggle that exposes lat/lng inputs, and a top-level error surface for both `placeDetails` and `addRegion` failures.
- [ ] **#6** Dropdown overlap — deferred.
- [x] **#7** Follow-venue search error surface — Places errors render an explicit "Google Places search is unavailable" notice and the misleading "No venues found" is suppressed when the call errored.
- [x] **#8** Sign-out + name in Account card; sidebar shows real user — Account section now has Name, Email, and a Sign Out row. `AppShell` passes `userName`/`userInitials` from `useSession()` into `<Sidebar>`; the dummy "Ethan Smith / synced 2m ago" defaults are gone.
- [ ] **#9** Data sources real status — deferred.
- [ ] **#10** Hide digest time when Off — deferred.
- [ ] **#11** next-auth console noise — deferred.

## Verification

- `apps/web/tests/preferences-fixes.spec.ts` — 8 assertions covering all fixes; passes (51.9s).
- `apps/web/tests/compact-visual.spec.ts` — captures loose vs compact screenshots for `/home`, `/shows`, `/venues`, `/artists`, `/discover`, `/preferences`. Visually inspected — no breakage.
- Existing suite: 61/70 pass. The 9 remaining failures are pre-existing (hardcoded `http://localhost:3010` in `venue-follow-modal.spec.ts`, plus flaky `global-search` timeouts under suite-wide load — both pass when run alone).

## Screenshots from the review

- `apps/web/test-results/screenshots/prefs-overview.png`
- `apps/web/test-results/screenshots/prefs-add-region.png`
- `apps/web/test-results/screenshots/prefs-follow-modal.png`
