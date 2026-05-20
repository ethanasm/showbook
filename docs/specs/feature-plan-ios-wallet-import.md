# Feature plan — iOS wallet share-sheet import

**Goal:** Let an iPhone user share a `.pkpass` ticket (Apple Wallet) to
Showbook from the share sheet, land in the existing Add Show form
with every field pre-filled from the pass, review, and tap Save. One
share, two taps to confirm, show added.

**Status:** not started.

**Scope:** iOS only. No inbox queue. No background scanning. No
schema migrations. No new tRPC procedures — the wallet path
routes into the existing `shows.create` mutation via the existing
`/add/form` prefill URL params.

This is a focused **first slice** of the broader
[`feature-plan-personal-data-import.md`](feature-plan-personal-data-import.md)
plan. That doc's §5 contemplates a wallet-pass share target sitting
on top of an `import_suggestions` inbox table; this spec deliberately
**skips the inbox** and routes parsed passes straight into the Add
Show form for in-flow confirmation. The inbox table remains
deferred until a later source (Gmail auto-scan, Photos library scan)
genuinely needs it.

---

## 1. The flow, end-to-end

1. User taps a `.pkpass` file — from Mail, Messages, the Wallet app's
   share button, or any iOS file provider.
2. iOS share sheet shows "Showbook" as a destination because the app
   registers `com.apple.pkpass` as a document type it can open
   (`app.json` → `expo.ios.infoPlist.CFBundleDocumentTypes`).
3. iOS hands the file URI to Showbook via the standard "open with"
   intent. Expo Router's deep-link handler receives the URI on cold
   launch or while the app is backgrounded.
4. App reads the pass: `react-native-zip-archive` to unzip into a
   tmp dir under `FileSystem.cacheDirectory`, then
   `JSON.parse(pass.json)`.
5. App navigates to `/add/form` with the parsed fields stuffed into
   query params plus a new `source=wallet` param.
6. Add Show form renders with all fields populated and a
   wallet-specific banner at the top of the scroll view.
7. User reviews, optionally edits, taps Save (existing
   `testID="save-show"` button).
8. Existing `shows.create` mutation runs through the optimistic
   mutation runner exactly like the manual Add path. Outbox replay
   on offline is free.
9. On success, router replaces to `/add?savedShowId=<id>` — the
   same destination the manual form already lands on — so the
   chat-style confirmation card surfaces.

No new screens. No new mutations. No new tables. The new code is the
share-extension registration, the pkpass parser, the deep-link
handler, and a banner component on the existing form.

---

## 2. iOS document-type registration

Edit `apps/mobile/app.json`:

```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "CFBundleDocumentTypes": [
          {
            "CFBundleTypeName": "Apple Wallet Pass",
            "LSItemContentTypes": ["com.apple.pkpass"],
            "CFBundleTypeRole": "Viewer",
            "LSHandlerRank": "Alternate"
          }
        ]
      }
    }
  }
}
```

- `LSHandlerRank: "Alternate"` keeps the system Wallet app as the
  default opener — we just want to appear in the share sheet, not
  hijack pkpass opens.
- Requires a development build. Expo Go cannot register custom
  document types.

After the next EAS build, `pkpass` files surface "Showbook" in the
share sheet alongside Wallet / Mail / Messages.

---

## 3. Pass parsing

### 3a. Library choice

`react-native-zip-archive` for the unzip step (already an
implicit dep via other RN packages — confirm at implementation
time and add if missing). `expo-file-system` for reading the
extracted `pass.json`. Both are Expo-friendly and ship to iOS.

### 3b. Parser shape

New module: `apps/mobile/lib/wallet/parse-pkpass.ts`.

```ts
import { unzip } from 'react-native-zip-archive';
import * as FileSystem from 'expo-file-system';
import { logger } from '@showbook/observability';

export interface ParsedPass {
  headliner: string | null;       // pass.eventTicket.primaryFields[event].value
  venueName: string | null;       // pass.eventTicket.primaryFields[venue].value
  showDate: string | null;        // YYYY-MM-DD from pass.relevantDate
  seat: string | null;            // composed from sections/row/seat aux fields
  kindHint: 'concert' | 'theatre' | 'comedy' | 'festival' | null;
  serialNumber: string;           // dedup key — stored on shows.sourceRefs
  passTypeIdentifier: string;     // e.g. "pass.com.ticketmaster.tickets"
}

export async function parsePkpass(uri: string): Promise<ParsedPass | null>;
```

Implementation outline:

1. `unzip(uri, FileSystem.cacheDirectory + 'pkpass-' + Date.now())`.
2. Read `pass.json` as UTF-8.
3. Extract fields with defensive lookups (every field below can be
   missing depending on the issuer):

   | pass.json path | Output field |
   |---|---|
   | `eventTicket.primaryFields` `[key="event"]` `.value` | `headliner` |
   | `eventTicket.primaryFields` `[key="venue"]` `.value` (or first secondary field if absent) | `venueName` |
   | `relevantDate` (ISO 8601 with TZ) → date portion in the venue's local TZ | `showDate` |
   | `eventTicket.secondaryFields` / `auxiliaryFields` (keys `section`, `row`, `seat`) → `"SEC X · ROW Y · SEAT Z"` | `seat` |
   | `passTypeIdentifier` mapped via small lookup table (`pass.com.ticketmaster.tickets` → `concert`, theatre/comedy issuers we know → their kind) | `kindHint` |
   | `serialNumber` | `serialNumber` |

4. Delete the temp dir (best-effort; ignore failures).
5. Emit a structured log:
   `logger.info({ event: 'wallet.import.parsed', passTypeIdentifier, hasDate, hasVenue, hasHeadliner }, 'pkpass parsed')`.
6. On any throw, log
   `logger.warn({ event: 'wallet.import.parse_failed', err }, 'pkpass parse failed')`
   and return `null`. Caller surfaces a toast.

### 3c. Fixtures + unit tests

`apps/mobile/lib/wallet/__tests__/parse-pkpass.test.ts`. Five
anonymized pkpass fixtures committed under
`apps/mobile/lib/wallet/__tests__/fixtures/`:

- `ticketmaster-concert.pkpass` — typical TM concert
- `axs-concert.pkpass` — AXS-issued concert
- `dice-show.pkpass` — Dice-issued show (often missing venue
  primary field — covers the secondary-field fallback)
- `mlb-game.pkpass` — sports kind (covers unknown kind hint →
  null)
- `broadway-theatre.pkpass` — TodayTix / Telecharge theatre

Assertions per fixture: the four user-facing fields are extracted
correctly; the kind hint is correct or null; `serialNumber` is
read.

The fixtures live inside the mobile coverage gate
(`apps/mobile/lib/**`), so the parser counts toward the 80% gate
without separate config.

---

## 4. Deep-link routing

Expo Router exposes the iOS "open with file" intent via
`expo-linking`'s `getInitialURL()` and `addEventListener('url')`.
The URL is a `file://` URI pointing at the pass in the share-sheet
sandbox.

Wire it in `apps/mobile/app/_layout.tsx` (top-level layout already
runs auth + cache bridges; one more side effect fits cleanly):

```ts
useEffect(() => {
  const handle = async (uri: string | null) => {
    if (!uri || !uri.endsWith('.pkpass')) return;
    const parsed = await parsePkpass(uri);
    if (!parsed) {
      showToast({ kind: 'error', text: "Couldn't read that ticket" });
      return;
    }
    router.push({
      pathname: '/add/form',
      params: {
        headliner: parsed.headliner ?? '',
        venueHint: parsed.venueName ?? '',
        dateHint: parsed.showDate ?? '',
        seatHint: parsed.seat ?? '',
        kindHint: parsed.kindHint ?? 'concert',
        source: 'wallet',
        walletSerial: parsed.serialNumber,
        walletPassType: parsed.passTypeIdentifier,
      },
    });
  };
  Linking.getInitialURL().then(handle);
  const sub = Linking.addEventListener('url', ({ url }) => void handle(url));
  return () => sub.remove();
}, []);
```

The `source`, `walletSerial`, `walletPassType` params are new —
they're read by the form (§5) for banner rendering and stamped onto
`shows.sourceRefs` at save time (§6).

If the user is signed out when the share lands, the auth gate at
`(auth)/_layout.tsx` already redirects unauthenticated routes back
to sign-in. The query params survive the redirect because we hand
them to `router.push` only after the layout effect runs — if the
gate kicks them out, the URL is gone. **Trade-off:** sharing while
signed out drops the import. Acceptable for v1; if it bites we can
stash the parsed payload in SecureStore and replay after sign-in.

---

## 5. Add Show form changes

Two small additions to `apps/mobile/app/add/form.tsx`:

### 5a. Read the `source` param

```ts
const params = useLocalSearchParams();
const importSource = paramString(params.source) === 'wallet' ? 'wallet' : null;
```

### 5b. Banner at the top of the scroll view

New component: `apps/mobile/components/ImportSourceBanner.tsx`.

Renders inside the `NestableScrollContainer` above
`<ShowFormFields>`. Wallet variant:

```
┌────────────────────────────────────────────────┐
│ 🎫  Imported from Apple Wallet                 │
│ Review the details below and tap ✓ to add this │
│ show to your library.                          │
└────────────────────────────────────────────────┘
```

- Background: accent-tinted surface (use the existing `accentSoft`
  token from `lib/theme.ts`).
- Title: `Geist Sans 13.5/500`, ink colour.
- Subtitle: `Geist Sans 12/400`, muted colour.
- No dismiss affordance — the banner is bound to this
  single-form-instance and disappears when the user navigates away.
- `testID="import-source-banner-wallet"` for Maestro.

Pass the source through to the banner:

```tsx
{importSource === 'wallet' ? (
  <ImportSourceBanner variant="wallet" />
) : null}
<ShowFormFields ... />
```

Two reasons not to put the banner *inside* `<ShowFormFields>`:
the banner is form-scoped UI not field UI, and `<ShowFormFields>`
is shared with the Edit screen where the banner would never apply.

### 5c. Pass the wallet sourceRef through to save

Extend the `submit` callback to attach `sourceRefs` when the
import source is wallet:

```ts
const payload = serializeShowFormForKind({ ...values, date: ..., endDate: ... });
const sourceRefs = importSource === 'wallet'
  ? {
      wallet: {
        passTypeIdentifier: paramString(params.walletPassType),
        serialNumber: paramString(params.walletSerial),
        importedAt: new Date().toISOString(),
      },
    }
  : undefined;

await runOptimisticMutation({
  mutation: 'shows.create',
  input: { ...payload, sourceRefs },
  ...
});
```

`shows.create` already accepts an optional `sourceRefs` jsonb
field (the `shows.source_refs` column exists today —
`packages/db/schema/shows.ts:66`). Pass-through is a single line in
the procedure; no migration. Confirm at implementation time that
the tRPC input schema permits it; if it currently doesn't, the
change is one Zod field plus a passthrough into the insert.

---

## 6. Storage shape

The wallet path writes a normal `shows` row plus a `source_refs`
JSON payload. **No new columns. No new tables.**

```jsonc
// shows.source_refs after a wallet import
{
  "wallet": {
    "passTypeIdentifier": "pass.com.ticketmaster.tickets",
    "serialNumber": "4f9c…",
    "importedAt": "2026-05-20T14:33:01.000Z"
  }
}
```

### 6a. Dedup

`shows.source_refs->'wallet'->>'serialNumber'` is the dedup key.
Two ways the user could re-share the same pass:

- **Same pass shared twice.** Catch on the client before navigating
  to the form: do a `shows.findByWalletSerial` lookup (small new
  tRPC query — see §6b) and if it returns a hit, toast
  `"Already in your library"` plus a deep-link to the existing
  show and skip the form push.
- **Same event, two different pkpass files (e.g. two tickets, one
  per attendee).** Different serial numbers → two `shows.create`
  calls — but the existing show-create dedup (same user, same
  venue, same date, same headliner) catches it server-side and
  returns the existing row. Behaviour mirrors the manual-add dedup.

### 6b. New tRPC query

Add `shows.findByWalletSerial(serialNumber: string) → { id } | null`
to `packages/api/src/routers/shows.ts`. Trivial — `select shows.id
where user_id = $userId and source_refs->'wallet'->>'serialNumber'
= $serialNumber limit 1`. Unit-test it inline with the existing
`shows.test.ts` fixtures.

### 6c. Why store `source_refs` at all if we're not running an inbox?

Two future uses:

- **Analytics rollup.** Axiom queries that group on
  `source_refs->>'source'` already exist for ticketmaster /
  gmail / manual; adding `wallet` makes the rollup honest.
- **Re-parse later.** If a future schema change wants to read seat
  geometry or order #, the serial number lets us re-pull a fresh
  copy of the pass via the user (no Apple-side API). Cheap
  insurance.

---

## 7. Observability

New event names (logged via `@showbook/observability`):

- `wallet.import.parsed` — pkpass parsed successfully. Fields:
  `passTypeIdentifier`, `hasDate`, `hasVenue`, `hasHeadliner`,
  `kindHint`. **Do not log** the serial number or the raw pass —
  serial numbers identify individual purchases and are
  PII-adjacent.
- `wallet.import.parse_failed` — parse threw. Fields: `err`
  (serialised by the observability package).
- `wallet.import.routed_to_form` — fired in the deep-link handler
  after `router.push`. Useful for measuring the parse-to-form
  funnel.
- `wallet.import.duplicate_skipped` — fired when
  `shows.findByWalletSerial` returns a hit and the form push is
  skipped.
- `wallet.import.saved` — fired in the form's `submit` success
  branch when `importSource === 'wallet'`. Fields:
  `passTypeIdentifier`, `kindHint`. Lets Axiom chart wallet-saved
  vs. wallet-routed conversion.

Add the curated-event-name notes for these to the repo-root
`CLAUDE.md` "Structured event names worth knowing" list when the
work ships.

No Langfuse traces — there's no LLM in this path.

---

## 8. Offline behaviour

The user has the pass in their hand at the moment of share, and
the parse is purely local. The form's existing optimistic
mutation runner already queues `shows.create` to the SQLite
outbox if the device is offline, so the wallet path inherits
offline-by-default save semantics for free.

The only network-dependent step is the new
`shows.findByWalletSerial` dedup check. If it fails (offline,
500, etc.), proceed to the form anyway — server-side dedup on
save catches duplicates. The duplicate-check is a UX nicety, not a
correctness gate.

---

## 9. Permissions, security, ToS

- **No new iOS permissions.** Document-type registration is not a
  permission — it's just metadata that adds Showbook to the share
  sheet for pkpass files.
- **No external APIs.** Parsing is purely local zip-and-JSON. No
  Apple Wallet API, no PassKit entitlements, no carrier API
  calls. Nothing to rate-limit.
- **No ToS exposure.** The user shares a file they already own.
  We are not scraping Apple, Ticketmaster, AXS, or anyone else.
- **PII discipline.** Don't log the raw `pass.json`. Don't log the
  serial number. Don't ship the pass payload off-device — only the
  five parsed fields above hit the server, and they're identical
  to what the user would otherwise type into Add manually.

---

## 10. Android

Out of scope. Google Wallet doesn't expose pass JSON the same way
through Android's share intents, so the analogous flow there would
need an OCR / vision-LLM step on a screenshot of the pass. Tracked
in `feature-plan-personal-data-import.md` §5b but explicitly
deferred — iOS-only is the v1.

---

## 11. Testing

- **Unit** — `parse-pkpass.test.ts` with five fixtures (§3c). One
  test per fixture asserting the four user-facing fields plus
  kind hint and serial number. Inside the mobile coverage gate.
- **Unit** — `shows.findByWalletSerial.test.ts` next to the
  existing `shows` router tests. One hit, one miss, one
  cross-user-isolation case.
- **Unit** — `ImportSourceBanner.test.tsx` if anything beyond
  static markup ships. (Banner is layout-only; the form-level
  branching is what matters.)
- **Maestro** — extend `apps/mobile/e2e/flows/show-detail-tabs.yaml`?
  No — wallet import doesn't touch show detail. Skip Maestro for
  v1: the share-sheet hop is impossible to drive on the emulator
  without a paid Apple Pay test environment, and the
  deep-link-into-form path is covered by the unit tests on the
  parser plus the existing add-show Maestro flow that exercises
  the form save path.
- **Manual iOS smoke** — required before merge:
  1. EAS build with the new `app.json` document-type entry.
  2. Email yourself a pkpass (TM concert ticket is easiest), tap
     it on the device, share → Showbook.
  3. Confirm: form opens, banner shows, fields are pre-filled,
     Save succeeds, show appears under Shows.
  4. Re-share the same pass: confirm duplicate-skipped toast.

---

## 12. Sequencing

One PR is fine — the change is small enough and tightly coupled:

1. `app.json` document-type entry.
2. `lib/wallet/parse-pkpass.ts` + fixtures + tests.
3. Deep-link handler in `app/_layout.tsx`.
4. `source` param + banner in `app/add/form.tsx`.
5. `ImportSourceBanner.tsx` component.
6. `shows.findByWalletSerial` tRPC query + test + duplicate
   short-circuit in the deep-link handler.
7. `shows.create` input schema extension to accept `sourceRefs`
   (if not already permissive).
8. Observability events + CLAUDE.md entry.

CI runs unit + integration + Playwright as usual. Maestro skipped
for v1. Manual iOS smoke gate before merge.

---

## 13. Out of scope (for this spec)

- **Inbox of suggestions.** Deferred until a background source
  (Gmail auto-scan, Photos library scan) actually needs it. The
  schema in `feature-plan-personal-data-import.md` §2a remains the
  reference design for when that day comes.
- **Outbound pkpass generation.** Generating a Showbook-side
  `.pkpass` for upcoming shows
  (`feature-brainstorm-2026-05-02.md` §4m) is a separate feature
  going the other direction.
- **Pass Library scanning.** "Scan all my passes" without a share
  share-sheet tap is a future enhancement that needs its own
  permission model and probably the inbox table.
- **Android.** See §10.
- **Festival multi-day passes.** A festival pkpass with a
  date range needs `endDate` handling — parser returns the
  earliest `relevantDate` and the user fills in the end date on
  the form. Multi-day extraction can land later.
