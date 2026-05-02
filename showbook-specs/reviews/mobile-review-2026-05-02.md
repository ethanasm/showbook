# Mobile review — post-M5 audit (2026-05-02)

Read-only review of the merged Showbook mobile build (M1 Foundation, Wave A
shared kit, M2 Read flows, M3 Add+Edit, M4 Media, M5 Discovery + Search,
plus M6.C iPad three-pane). The not-yet-merged offline / coverage / Maestro
tracks (E-1, F-1, F-2) are explicitly out of scope.

Sanity checks run during the review:

- `pnpm install` — clean (10 workspace projects, lockfile up to date).
- `pnpm -F mobile typecheck` — passes with zero diagnostics.
- `pnpm -F mobile test` — all `node:test` suites pass (auth helpers,
  cache, outbox, mutations, search, theme, debounce, feedback, upload,
  responsive, MediaTile, SetlistRow).

Severity bar: `Critical` = data loss / auth bypass / PII leak / broken
sign-in or sync; `Important` = visible bug, race that produces wrong UI,
missing required behavior per the spec, untyped/uncovered critical surface;
`Minor` = cosmetic or low-impact edge cases.

---

## 1. Behavior gaps

### 1.1 Sign-out leaves the previous user's data accessible to the next user — Critical
- `apps/mobile/lib/auth.ts:259-270` clears only the SecureStore token + user
  keys. Nowhere in the app does sign-out (a) clear the in-memory React
  Query cache, (b) drop the `showbook-cache.db` SQLite file that hydrates
  every screen on cold start, or (c) drain the `pending_writes` outbox.
  The M2.A spec explicitly required `db.close(); FileSystem.deleteAsync`
  on sign-out (`mobile-cloud-claude-prompts.md` Prompt B-1, lines
  102–104), and `apps/mobile/lib/cache/CacheBridge.tsx:25-44` opens that
  same SQLite file on the next mount with no per-user scoping. After a
  sign-out → sign-in as a different user, the second user sees the first
  user's shows / venues / media / pending-writes until each query refetches.
  Direction: in `signOut()`, also call `queryClient.clear()` and drop the
  cache DB (FileSystem.deleteAsync of the resolved SQLite path), then
  re-create it on next sign-in. Consider scoping the DB filename by user
  id so cross-account leakage is impossible by construction.

### 1.2 Setlist + Edit mutations write to an in-memory fake outbox, not SQLite — Critical
- `apps/mobile/app/show/[id]/setlist.tsx:105-144` and
  `apps/mobile/app/show/[id]/edit.tsx:114-160` both define a
  `getOutbox()` singleton that wraps a `Map`-backed pseudo-`SQLiteLike`
  shim and pass it to `runOptimisticMutation`. The comment in `edit.tsx`
  even acknowledges this (“Production code at the app root will swap this
  out for a SQLite-backed instance via the cache module”) but no such
  swap exists. The whole point of the outbox is to survive crash / kill /
  cold-start — pending rows are written to a `Map` that is GC'd on every
  app close, so any failed save is silently lost. This makes the
  `pending_writes` table effectively unused on the mutation path even
  though the table is migrated and exercised by tests. M3's "Optimistic
  UI: write to sqlite cache first… use a small outbox table … so failures
  are retryable" requirement is not actually met. Direction: add a
  shared `getCacheDatabase()` that returns the real `expo-sqlite` handle
  (created once next to the cache persister) and use `createOutbox(db,
  { ensureMigrations: true })` so the outbox writes to the real
  `pending_writes` table. Delete both per-screen fake-DB blocks.

### 1.3 Add show has no optimistic / outbox path at all — Important
- `apps/mobile/app/add/form.tsx:131-195` calls `trpc.shows.create.useMutation`
  directly. If the request fails (offline, transient 5xx, server crash),
  the form data lives only in component state — it's not enqueued to the
  outbox, not written to the cache, and the user has no retry path
  beyond pressing Save again. Same shape for the action-sheet's
  `shows.updateState` and `shows.delete` mutations
  (`apps/mobile/app/show/[id].tsx:234-244`). Direction: route every
  write through `runOptimisticMutation` with the shared SQLite outbox
  (see 1.2) so the pending row survives.

### 1.4 First-run flag persists across sign-out — Important
- `apps/mobile/lib/auth.ts:259-270` sets `setIsFirstRun(true)` in memory
  but does not delete `showbook.auth.firstRunComplete` from SecureStore.
  On the next sign-in `exchangeAndPersist` re-reads the flag
  (`auth.ts:185-188`) and immediately flips `isFirstRun` back to
  `false`, so the welcome / permissions sequence does not re-run for a
  different account on the same device — contradicting the comment at
  line 267-269 ("by definition the next sign-in … needs to redo
  first-run"). Direction: also `await
  SecureStore.deleteItemAsync(FIRST_RUN_KEY)` in `signOut()`.

### 1.5 Bearer-allowlist failure is logged without context — Important
- `apps/web/app/api/trpc/[trpc]/resolve-session.ts:86-92` — when a mobile
  bearer token decodes successfully but the email is no longer on the
  allowlist, the helper returns `null` (correct) and emits
  `auth.mobile_session_denied` with no `userId` or hashed email. Operators
  cannot tell which removed-from-allowlist user is still trying to use
  Showbook. Direction: include `userId` (which is on the decoded token)
  on the log line; do NOT log the raw email.

### 1.6 Shows tab bypasses the persistent cache — Important
- `apps/mobile/app/(tabs)/shows.tsx:127-130` uses
  `trpc.shows.list.useQuery` directly, not `useCachedQuery`. The Home
  screen consistently uses `useCachedQuery` (`(tabs)/index.tsx:112-116`)
  and the persister hydrates that key on cold start; Shows opens with a
  spinner instead. The C-2/D/E spec ("All three pull from
  `useCachedQuery` (M2.A)" — `mobile-cloud-claude-prompts.md` Prompt C-2
  line 272) was not honored. Same for Map (`(tabs)/map.tsx:262-264`).
  Direction: switch to `useCachedQuery` with a stable mobile-scoped key
  (`['mobile', 'shows.list']` etc.) so the persister covers cold-start
  hydration on every list screen.

### 1.7 Show action sheet never reaches a ShowCard — Important
- M3's spec (`mobile-cloud-claude-prompts.md` Prompt D-1, "Show action
  sheet — long-press on a ShowCard → Sheet …. Wire into ShowCard's
  onLongPress") expected the sheet to open from any list. `ShowCard`
  exposes the `onLongPress` prop (`components/ShowCard.tsx:40,64`) but
  no caller passes it: Home (`(tabs)/index.tsx:259-266`), Shows tab
  (`(tabs)/shows.tsx:261, 385`), Artist detail
  (`artists/[id].tsx:251-254`) all wrap the card in a `<Link>` with no
  long-press. The sheet is only reachable through the `MoreHorizontal`
  button on ShowDetail. Direction: pipe an `onLongPress` from each list
  to the existing `ShowActionSheet` (or extract that sheet into its own
  module).

### 1.8 ShowDetail never displays the saved setlist — Important
- The setlist composer writes via `setSetlist` and the show detail's
  cached payload includes `setlists: Record<string, PerformerSetlist>`
  (used by `setlist.tsx:182`). But ShowDetail still renders only a
  static "Coming in M3" stub (`apps/mobile/app/show/[id].tsx:589-603`).
  After M3 shipped, this is dead copy that hides real data. Direction:
  swap `SetlistStub` for a renderer over `show.setlists` (per-performer,
  main + encore sections), or at minimum link the stub to the composer
  when a setlist exists.

### 1.9 Artist + Venue detail still stub the photo grid — Important
- `apps/mobile/app/artists/[id].tsx:261-276` and
  `apps/mobile/app/venues/[id].tsx:363-378` both render `PhotosStub`
  with copy "Photos arrive in M4" — but M4 has shipped (`MediaGrid` and
  `media.listForShow` exist). The TODO comments at both files
  acknowledge this. Direction: replace the stubs with `MediaGrid` bound
  to a per-performer or per-venue media query (M4 only added per-show
  listing, so this likely needs a small backend addition or a
  client-side filter over the user's full media list).

### 1.10 Lightbox active index lags initial scroll + single-finger pan blocked — Important
- `apps/mobile/app/media/[id].tsx:91` initializes `activeIndex` to the
  result of a `useMemo(initialIndex)` that resolves to `0` while the
  list is still loading, so the bottom-bar counter and `active` lookup
  show "1 / N" + the wrong caption until the user manually scrolls.
  Separately, `pan` uses `Gesture.Pan().minPointers(2)` (line 205) so
  once the user pinches in, single-finger panning to inspect a cropped
  area does nothing — only two-finger pan works. Standard lightbox UX
  expects single-finger pan when zoomed. Also,
  `Dimensions.get('window')` is read once at module load (line 52), so
  rotation on iPad does not reflow the pager. Direction: keep
  `activeIndex` in a `useEffect` that snaps to the located row once
  `items` is non-empty, drop `minPointers(2)` once `scale > 1`, and
  read width/height inside the component via `useWindowDimensions()`.

---

## 2. Security concerns

### 2.1 `mobile-token` route logs email + name on every successful sign-in — Critical
- `apps/web/app/api/auth/mobile-token/route.ts:132-135` logs
  `{ event: 'auth.mobile_signin', userId, email: user.email }`. CLAUDE.md
  is explicit: "Never log secrets, raw user PII, raw email bodies, or
  image bytes." pino's redaction list covers `apiKey`/`token`/`password`
  but not `email`, so this lands verbatim in stdout (Docker logs) and
  Axiom. The same goes for any `name` written to user records since the
  upsert reuses Google's name claim. Direction: log only `userId`; if a
  human-readable identifier is needed for debugging, hash the email or
  include only the email domain.

### 2.2 No rate limiting on `/api/auth/mobile-token` — Important
- The endpoint accepts arbitrary `idToken` strings, performs Google JWKS
  + signature verification (relatively expensive), and only then
  consults the allowlist. The repo already ships
  `enforceRateLimit` / `isRateLimited` (`packages/api/src/rate-limit.ts`,
  used at `apps/web/app/api/gmail/scan/route.ts:107`) but
  `mobile-token/route.ts` does not call either. An attacker who can hit
  the public web origin can replay or fuzz tokens to cost CPU and emit
  spam log lines (see 2.1). Direction: enforce a per-IP rate limit
  before token verification — e.g. 30 requests / minute / IP — with a
  small backoff on consecutive failures.

### 2.3 Edit / Add / Mutation paths log nothing about ownership checks — Minor (hardening note)
- The mobile-side mutations (`shows.update`, `shows.delete`,
  `media.setPerformers`, `setlists.upsert`) trust the server to scope
  changes to the caller. I did not audit the server router code as part
  of this review, but the mobile call sites
  (`apps/mobile/app/show/[id]/edit.tsx:283`,
  `apps/mobile/app/show/[id].tsx:240-244`,
  `apps/mobile/app/show/[id]/tag/[mediaId].tsx:121-124`) supply only
  `showId` / `assetId` and rely on the server to verify the bearer's
  user owns the row. This is the correct shape — flagging only as a
  pointer for a follow-up server-side review pass that confirms each
  procedure does an explicit `userId` check before mutating.

### 2.4 Discover + Artists + Venues screens cast tRPC outputs through `as unknown as` — Important
- 12 occurrences across `app/discover.tsx:90,99,108,200`,
  `app/artists/{[id],index}.tsx`, and `app/venues/{[id],index}.tsx`.
  The pattern is
  `utils.client.discover.followedFeed.query(…) as unknown as Promise<X>`
  — losing all of tRPC's inferred end-to-end typing. If the server
  later changes a field (e.g. renames `showCount`, adds nullability),
  the mobile screens compile cleanly and crash at runtime. Direction:
  derive the row shape via `inferRouterOutputs<AppRouter>` (the same
  trick `(tabs)/index.tsx:39-42` already uses for `shows.list`) and
  drop the `as unknown as` casts. Same applies to the
  `as unknown as { hasRegions?: boolean }` cast in
  `discover.tsx:200`.

### 2.5 `apiUrl` defaults to a literal `https://showbook.example.com` — Minor
- `apps/mobile/lib/env.ts:21`. Per CLAUDE.md / `mobile-roadmap.md` this
  is intentional (defaults to the prod tunnel hostname). The
  `example.com` fallback string is harmless when EAS bakes the real
  value, and dev / debug builds get a friendly OAuth misconfig error
  instead of a surprise. Flagging only because the next reader may
  assume this is meant to be the real prod hostname — the literal
  hostname in code is `showbook.example.com`, not the actual prod
  tunnel. Direction: either replace the default with the real prod
  tunnel hostname (matches CLAUDE.md) or fail loudly when
  `EXPO_PUBLIC_API_URL` is unset in production. Either is fine; the
  current state works in practice but the comment lies.

### 2.6 SQLite cache on disk is unencrypted — Minor (document the threat model)
- `apps/mobile/lib/cache/sqlite-storage.ts` opens
  `showbook-cache.db` via `SQLite.openDatabaseAsync` with no SQLCipher
  / encryption flags. Anyone with file-system access on a jailbroken /
  rooted device, or a backup that includes the app's documents
  directory, can read every cached query (titles of shows attended,
  venue / city info, performer names, etc.). The auth token stays in
  Keychain via `expo-secure-store` so credentials are safe; the leak is
  the user's log. Direction: document the threat model — for a personal
  log this is probably acceptable — and consider scoping the DB by user
  (see 1.1) plus an `app.config.ts` flag to opt the database out of
  iCloud / device backups.

### 2.7 Tap-jacking on the destructive Delete action — Minor
- `apps/mobile/app/show/[id].tsx:304-315` uses a "Tap again to confirm"
  pattern for delete inside the action sheet. Two consecutive taps on
  the same row delete the show — there is no `Alert.alert` like the
  sign-out path uses (`(tabs)/me.tsx:89-103`). A button that overlays
  the row briefly (toast, banner) could in principle be timed to absorb
  the second tap. Direction: use the same `Alert.alert` confirm
  affordance the sign-out flow uses for any destructive irreversible
  action.

---

## 3. Display / visual issues

### 3.1 iPad three-pane layout shows an empty middle pane — Important
- `apps/mobile/app/(tabs)/_layout.tsx:62-69` mounts
  `<ShowDetailScreen />` directly inside `ThreePaneLayout`'s middle
  slot, but `ShowDetailScreen` reads its id from
  `useLocalSearchParams<{ id: string }>()`
  (`app/show/[id].tsx:124-125`) and gates the query on
  `enabled: showId.length > 0`. Mounted as a sibling component (not as a
  Stack route), there is no id, so the middle pane sits with a back
  button + empty state forever. The Shows pane on the left also doesn't
  thread a selection into the right. Net: the iPad layout merely
  composes three independent screens that don't talk to each other —
  the M6.C "Shows timeline + ShowDetail + Map" interaction does not
  function. Direction: hoist a `selectedShowId` into the layout (or a
  React context inside `ThreePaneLayout`) and pass it explicitly into a
  `<ShowDetailScreen showId={…} />` and `<MapScreen focusVenueId={…} />`.

### 3.2 Hardcoded Google brand colors are flagged as intentional — fine
- `apps/mobile/app/(auth)/first-run/welcome.tsx:163-179` uses
  `#FFFFFF` + `#4285F4` for the Google badge with explicit comments
  saying this is intentional (brand recognition takes precedence over
  theme tokens). Re-confirming: this was a regression-prevention item
  on the M1 review; the comments make the intent clear. Not a finding.

### 3.3 Shows tab Timeline uses `ScrollView`, not `FlatList`/`SectionList` — Important
- `apps/mobile/app/(tabs)/shows.tsx:248-267` renders the entire timeline
  via `ScrollView` with nested `View` blocks per section. The C-2 spec
  required a "Timeline: infinite-scroll FlatList of ShowCards, sticky
  month section headers". For a power user with hundreds of past shows
  this drops every row into the React tree at once — there is no
  virtualization, no recycling, no sticky headers. Direction: convert
  to `SectionList` with `stickySectionHeadersEnabled` so scroll perf
  scales linearly with the visible window.

### 3.4 No pull-to-refresh on Shows / Map / ShowDetail / Artists / Venues — Important
- Only Home (`(tabs)/index.tsx:118-123`) and Discover
  (`discover.tsx:122-128`) wire `useThemedRefreshControl` onto their
  ScrollViews. Per the M2 spec ("Skeletons + pull-to-refresh"), every
  list-shaped screen should support pull-to-refresh; instead users have
  to wait for the foreground-sync trigger or kill+relaunch. Direction:
  attach the same `useThemedRefreshControl` to the outer ScrollView in
  `shows.tsx`, `show/[id].tsx`, `artists/index.tsx`,
  `artists/[id].tsx`, `venues/index.tsx`, `venues/[id].tsx`.

### 3.5 Lightbox pan deferred to two fingers; rotation broken — Important
- See 1.10. The same finding applies to display: when zoomed via
  pinch, the user has no single-finger way to inspect the cropped
  edges, and the FlatList's per-page `width: SCREEN_W` snapshot from
  module-load time wedges the pager on rotation.

### 3.6 Mobile ScrollView stat tile width arithmetic looks odd — Minor
- `apps/mobile/app/(tabs)/shows.tsx:660` —
  `width: \`${(100 - 0.5) / 2}%\`` (= `49.75%`). On a narrow iPhone SE
  this works but the math is opaque; the comment is silent. Direction:
  replace with a clean `flexBasis: '50%'` minus a hairline gap and let
  flexbox handle it.

### 3.7 Stats bar uses `width: \`${pct * 100}%\`` strings inside JSX — Minor
- `apps/mobile/app/(tabs)/shows.tsx:491,524,561`. Works, but every
  re-render allocates a new style object — RN warns about this in
  release. Pulling the percentage into a memoized style is a one-line
  perf cleanup.

### 3.8 Setlist composer keyboard avoidance covers list, not chips strip — Minor
- `apps/mobile/app/show/[id]/setlist.tsx:401-404` wraps only
  `DraggableFlatList` inside `KeyboardAvoidingView`. The performer-strip
  chip row above it (lines 342-376) is outside, so on a small screen
  the keyboard pushes the chips off the top while the list stays
  pinned. Direction: move the wrapping `KeyboardAvoidingView` up to
  cover the whole composer body.

### 3.9 Stats tiles allow stat numbers to wrap into two lines — Minor
- `apps/mobile/app/(tabs)/shows.tsx:666-671`. With `letterSpacing:
  -0.6` and a 28pt font, "$10,000" still fits on iPhone SE, but
  "$1,234,567" wraps. Single-line truncation + `numberOfLines={1}`
  would be safer.

### 3.10 Discover empty rail is a hardcoded card, not the EmptyState component — Minor
- `apps/mobile/app/discover.tsx:232-240` renders a one-line "emptyHint"
  in a card style instead of using `<EmptyState>` like the rest of the
  app. The visual differs subtly (no icon, smaller copy) and is the
  only place in the M5 surface that does this. Direction: align with
  `EmptyState` for consistency.

---

## 4. Other observations

### 4.1 Two duplicate copies of an in-memory fake `SQLiteLike` — fix together with 1.2
- `apps/mobile/app/show/[id]/setlist.tsx:106-144` and
  `apps/mobile/app/show/[id]/edit.tsx:115-160` carry the same ~40-line
  shim. The shim mirrors the test-only fake in
  `apps/mobile/lib/__tests__/mutations.test.ts:27-67`. This is dead
  test code shipped to production. Removing it (per finding 1.2)
  removes ~80 LOC of duplication.

### 4.2 No tests cover sign-out cache invariants
- `apps/mobile/lib/__tests__/auth.test.ts` covers the JWT exchange and
  error-mapping helpers, but there is no test asserting that signOut
  clears the SQLite cache + outbox + queryClient. Given finding 1.1's
  severity, a regression here would be very expensive. Direction: add
  a unit test that calls `signOut()` against a fake `CacheStorage` and
  asserts the storage / outbox is empty afterwards. Component tests
  remain out of scope per `mobile-testing-strategy.md`, but this one
  lives in `lib/__tests__/`.

### 4.3 File sizes drifting past the spec's "scope drift" heuristic
- Per `mobile-m2-m6-plan.md` § "Per-milestone deliverable count":
  ShowDetail (851 LOC), Map tab (834 LOC), Shows tab (756 LOC),
  Setlist composer (585 LOC), Edit show (573 LOC), Venue detail (530
  LOC) all crossed 500 LOC. The plan called this out as a drift
  signal. Direction: extract sub-sections (`Hero`, `Facts`, `Lineup`,
  `Photos`, the action sheet, the venue sheet) into their own files —
  not because the code is wrong, but because each is now hard to
  review in one PR.

### 4.4 TODO comments and "Coming in M3 / M4" copy in shipped surfaces
- `apps/mobile/app/artists/[id].tsx:264` —
  `// TODO(M4): when MediaGrid lands, render tagged photos for this performer.`
- `apps/mobile/app/venues/[id].tsx:366` —
  `// TODO(M4): when MediaGrid lands, render media-from-your-shows here.`
- `apps/mobile/app/show/[id].tsx:597-599` —
  "Coming in M3" SetlistStub copy after M3 shipped (also see 1.8).
- `apps/mobile/app/integrations/[id].tsx:51-52` —
  "Coming in M3" hard copy.
- `apps/mobile/app/(tabs)/me.tsx:235-236` — `SHOWBOOK · v0.1 · M2`
  footer label after M5 shipped.

### 4.5 `console.*` and AsyncStorage uses
- Greps for `console.` and `AsyncStorage` in `apps/mobile` returned
  zero hits — the observability rules are honored. No `@ts-ignore` or
  `@ts-expect-error` either. The 12 `as unknown as` casts (see 2.4)
  are the only typed-surface concerns.

### 4.6 Test coverage trends
- Pure-logic coverage is healthy: cache, persister, outbox, sync,
  upload pipeline, auth helpers, search helpers, theme utils, debounce,
  feedback, responsive — every `lib/**` module has at least a smoke
  test. The components/__tests__ directory has only `MediaTile.test.tsx`
  and `SetlistRow` (referenced from the test runner output). The
  per-milestone test deliverables in
  `mobile-testing-strategy.md` ("VenueTypeahead component test,
  SetlistRow component test" for D-1; "MediaTile component test" for
  D-2) are partially met — VenueTypeahead has no component test.

### 4.7 Outbox `_idCounter` resets on cold start
- `apps/mobile/lib/cache/outbox.ts:57-63` resets `_idCounter` on every
  process restart. Because ordering is primarily by `created_at` this
  is correct in practice, but the doc-comment ("Monotonic enough for
  FIFO ordering inside a single process") under-sells the constraint:
  if two writes land in the same millisecond across cold-starts, ids
  collide. Risk is theoretical. Direction: bump the id to a random
  suffix (e.g. `expo-crypto.randomUUID()`) so ids are unique across
  restarts.

### 4.8 `runOptimisticMutation` skips rollback when snapshot is `undefined`
- `apps/mobile/lib/mutations/runMutation.ts:62` —
  `if (ctx.optimistic && snapshot !== undefined)`. A legitimate
  snapshot of "no cache yet" returns `undefined` from
  `queryClient.getQueryData(detailKey)`; the rollback then no-ops on
  failure even though the apply step did mutate the cache. In practice
  the `setQueryData` apply also short-circuits when `prev` is missing,
  so the bug is masked — but the gating-on-`undefined` is misleading.
  Direction: gate on a sentinel (`HAS_SNAPSHOT`) or always pass the
  snapshot through.

### 4.9 Maps tab `setLoadedRegion(region)` re-fits on every "search this area"
- `apps/mobile/app/(tabs)/map.tsx:340-343` — pressing "Search this
  area" calls `setLoadedRegion(region)` and `showsQuery.refetch()`.
  Since `clusterVenues` already runs against the live `region` on
  every render, the refetch is the only side effect. Fine, but the
  button's name implies it filters to the current bounds — there's no
  bounding-box filter on the server call, so it is effectively just a
  refresh. Direction: rename the button to "Refresh" or wire a real
  bbox filter on the server.

### 4.10 Mobile `me.tsx` footer is stale + integrations row hint hardcoded
- `apps/mobile/app/(tabs)/me.tsx:235` shows `SHOWBOOK · v0.1 · M2`
  even though M5 has shipped. `IntegrationRowView` always shows "Not
  connected" regardless of actual integration state
  (line 145-153, 269-270). The header docblock acknowledges the latter
  is awaiting an API change (`prefs.get` doesn't expose third-party
  state); the version string just needs updating.

---

## Severity counts

- **Critical (2)**: 1.1 sign-out leaves cached data visible to next
  user; 1.2 setlist + edit outbox is in-memory; 2.1 PII (email) logged
  on every mobile sign-in.
- **Important (12)**: 1.3 add/action-sheet bypass outbox; 1.4
  first-run flag persists across sign-out; 1.5 allowlist denial log
  has no userId; 1.6 Shows tab + Map bypass useCachedQuery; 1.7
  ShowCard long-press wiring missing; 1.8 ShowDetail never displays
  saved setlist; 1.9 artist/venue media stubs after M4; 1.10 lightbox
  index lag + single-finger pan blocked + rotation; 2.2 no rate limit
  on `/api/auth/mobile-token`; 2.4 `as unknown as` casts on M5
  screens; 3.1 iPad three-pane has no selection plumbing; 3.3
  Timeline uses ScrollView; 3.4 pull-to-refresh missing on most
  screens.
- **Minor (10)**: 2.3 mutation ownership trust pointer; 2.5 example.com
  default URL; 2.6 unencrypted cache DB; 2.7 delete tap-jacking;
  3.2 Google brand colors confirmed intentional; 3.6 stat width math;
  3.7 inline % styles; 3.8 setlist KAV scope; 3.9 stat overflow;
  3.10 Discover empty card vs EmptyState; plus the cluster of items
  in §4 (file size drift, stale TODOs, outbox id collision risk,
  mutation snapshot-undefined gating, map "search this area" naming,
  Me footer text + integrations placeholder).

The Critical items (1.1, 1.2, 2.1) and the iPad selection-plumbing gap
(3.1) are what would slip through to a beta user as visible problems.
Everything else is fixable in follow-up branches without blocking M5
ship.
