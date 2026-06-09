# Axiom: bound the schema with a `fields` map field (`prod-v2`)

## Why

Axiom datasets have a hard per-dataset field cap (256 on our plan). Each
unique top-level or dotted field name across all logged events becomes a
permanent column, and once a dataset is at the cap **every write that
introduces a never-before-seen field is rejected wholesale** — the rejection
appears only in `docker logs showbook-prod-web`, never in Axiom.

The May-2026 fix split the original `showbook-prod` into `prod-server` +
`prod-mobile` (see [`axiom-dataset-cutover.md`](./axiom-dataset-cutover.md)).
That only *doubled* the budget — it didn't *bound* it — so `prod-server`
filled up again in June 2026 (Axiom emailed that ingest was being rejected).

Axiom's recommended answer is **map fields**: you designate one top-level
field as a map field on the dataset; the nested keys inside it are stored as
key-value pairs in a **single** column that does **not** count against the
field cap. Trade-off: querying a map field costs more query-hours and
compresses slightly worse than a real column.

## The design

Reshape every Axiom-bound log record so only a small fixed allowlist of
"core" fields stay top-level columns and **everything else folds into one map
field named `fields`**. The schema then becomes structurally bounded forever
— the cap can't be hit no matter what keys call-sites log — with **no
call-site changes**, and stdout / `docker logs` stay flat (the reshape runs
on the Axiom stream only).

This also lets us **merge back to a single dataset** (`prod-v2`): the original
reason for the server/mobile split (mobile's unbounded field growth) is gone
once every non-core key folds into the map.

### Code

`packages/observability/src/logger.ts`:

- **`CORE_FIELDS`** — the allowlist of keys that stay top-level columns:
  `_time`, `time`, `level`, `msg`, `event`, `component`, `job`, `jobId`,
  `userId`, `err`, `env`, `service`, `pid`, `hostname`, `reason`, `status`,
  `durationMs`, `elapsedMs`. These are the fields filtered / grouped /
  aggregated in APL (the health-check queries in
  `packages/jobs/src/health-check/checks.ts`, dashboards) or numeric dims you
  `summarize avg()` on, where folding into the string-typed map would hurt.
  `err` is kept flat (and bounded by `serializeErr` / `ALLOWED_ERROR_FIELDS`)
  because `err.code` / `err.detail` are hot triage paths. `component` stays
  top-level so `summarize by component` keeps working and still distinguishes
  mobile telemetry (`component: 'mobile.telemetry'`) in the merged dataset.
- **`reshapeForAxiom(line)`** — pure string→string: parse the pino JSON line,
  keep `CORE_FIELDS` at the top level, fold every other key under `fields`
  (omitting `fields` entirely when there's nothing to fold). Malformed or
  non-object lines pass through untouched so a line is never dropped. A
  literal top-level `fields` key folds to `fields.fields` — `fields` is
  deliberately NOT in `CORE_FIELDS`.
- A single Axiom stream (`buildAxiomStream`) runs the reshape in its
  `Transform` before piping to `@axiomhq/pino`. Reads `AXIOM_TOKEN` +
  `AXIOM_DATASET` only; the `AXIOM_MOBILE_DATASET` / `isMobileRecord` split is
  gone.

Result: `CORE_FIELDS` (~18) + `err.*` (~21–42, bounded by the allowlist) +
`fields` (1) ≈ **~40 columns, permanently**. Mobile telemetry adds nothing
new — its context keys fold into `fields`, and it never logs `Error` objects.

### Read side

`packages/jobs/src/health-check/axiom.ts` `axiomDataset()` now resolves
`AXIOM_QUERY_DATASET ?? AXIOM_DATASET ?? 'prod-v2'`, so the dataset name is
set once via `AXIOM_DATASET`; `AXIOM_QUERY_DATASET` remains an optional
override for reading a different dataset.

### Querying folded fields

Fields in the map are addressed with map syntax:
`['fields']['spotifyTrackId']` or `fields.venueId`, e.g.

```
['prod-v2']
| where event == "venue.follow"
| extend vid = ['fields']['venueId']
| project _time, event, userId, vid
```

`_time`, `level`, `msg`, `event`, `component`, `job`, `jobId`, `userId`,
`reason`, `status`, `durationMs`/`elapsedMs` and `err.*` stay top-level
columns and are queried directly.

## Operator runbook (host / Axiom side)

The repo side (reshaper, single-stream logger, health-check default, docs)
is done. The Axiom side needs an **admin/PAT token** — the repo's
ingest-only `AXIOM_TOKEN` cannot create datasets or map fields.

**Order matters:** the map field must exist **before** any event ingests. If
even one event lands first, `fields` becomes an ordinary nested column (its
sub-keys count against the cap) and the design silently fails.

1. **Create the dataset** `prod-v2` (Axiom UI → Settings → Datasets → New
   dataset, or `POST /v1/datasets` with a management-capable token +
   `X-AXIOM-ORG-ID: showbook-egap`).

2. **Designate the `fields` map field — before any ingest:**
   ```bash
   curl -sS -X POST "https://api.axiom.co/v2/datasets/prod-v2/mapfields" \
     -H "Authorization: Bearer $ADMIN_OR_PAT_TOKEN" \
     -H "X-AXIOM-ORG-ID: showbook-egap" \
     -H "Content-Type: application/json" \
     -d '{"name":"fields"}'
   ```
   (`$ADMIN_OR_PAT_TOKEN` = a PAT or advanced token with dataset-management
   capability. The ingest-only `AXIOM_TOKEN` will be rejected.)

3. **Grant the ingest `AXIOM_TOKEN` ingest on `prod-v2`** (silent-failure
   trap: an uncovered dataset drops events with no error in Axiom — only in
   `docker logs`).

4. **Set env and restart prod.** In `.env.prod`:
   ```
   AXIOM_DATASET=prod-v2
   ```
   Remove `AXIOM_MOBILE_DATASET` (no longer read). `AXIOM_QUERY_DATASET` can
   also be removed — it now defaults to `AXIOM_DATASET`. These live **only in
   `.env.prod`** (dev never ships to Axiom; CI doesn't ship logs). Then
   `pnpm prod:up` to reload and confirm the values inside the container.

5. **Repoint the read side.** Health-check cron default is now `prod-v2`
   (`axiomDataset()`), so no action unless overriding. Repoint any Axiom
   monitors / alerts / dashboards / saved queries from `["prod-server"]` /
   `["prod-mobile"]` to `["prod-v2"]`, and rewrite projections of any
   now-folded field to `['fields']['x']`.

6. **Verify.** Query `['prod-v2']`: confirm core fields are real columns, an
   ad-hoc context key shows under `fields` (`['fields']['<key>']` resolves),
   and both server logs and `component == "mobile.telemetry"` rows land in
   the one dataset. A `getschema` should show ~40 columns that does **not**
   grow as new events arrive.

The old `prod-server` / `prod-mobile` datasets stay read-only for their
30-day retention, then expire.

## Keeping the schema healthy

- **Ad-hoc keys are no longer fatal** — `log.X({ newRandomKey })` lands
  `newRandomKey` in the `fields` map at zero column cost. But prefer reusing
  stable keys (`event`, `userId`, `jobId`, `key`, `bytes`, `elapsedMs`,
  `host`, `status`, `reason`, …) for query ergonomics: a folded field is
  `['fields']['k']`, costs more query-hours, and is stored as a string.
- **Promote into `CORE_FIELDS` deliberately** — only when a key is genuinely
  filtered / grouped / aggregated in APL and the map-field cost or string
  typing hurts. Each promotion is a permanent real column, so keep the list
  small (it's nowhere near the cap, but the discipline keeps query plans and
  dashboards predictable).
- **`err` stays flat and allowlisted** — add new error shapes to
  `ALLOWED_ERROR_FIELDS`, never reach for a permissive enumeration shortcut
  (that's how the original DOMException-constant column blowout happened).
