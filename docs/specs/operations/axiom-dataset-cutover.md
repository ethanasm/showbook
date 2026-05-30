# Axiom dataset cutover: `showbook-prod` → `showbook-prod-v2`

## Why

The `showbook-prod` Axiom dataset hit Axiom's **257-column hard cap**
(`getschema` reports 258). Once a dataset is at the cap, every write that
introduces a never-before-seen field is **rejected wholesale** — and the
rejection only appears in `docker logs showbook-prod-web`, never in Axiom
itself. The casualties were the mobile telemetry `mobile.*` events: their
context fields (`errCode`, `spotifyTrackId`, `assetId`, …) are new field
names, so for ~2 months in 2026-05 essentially every mobile event was
silently dropped. Over a 90-day window only a single `mobile.*` event
landed.

You cannot raise the column limit yourself — 257 is an org/plan default,
raisable only by Axiom support. The fix is a **fresh dataset**
(`showbook-prod-v2`): the schema starts at 0 columns, so mobile telemetry
flows again immediately.

## Will v2 stay under the cap?

Yes, with thin margin. Measured breakdown:

| Bucket | Columns |
| --- | --- |
| Current `showbook-prod` schema (`getschema`) | 258 |
| − Dead DOMException constants (`err.*_ERR`) | −25 |
| − Dead `err.params` + `err.cause.params` | −2 |
| = Regenerates in v2 from current app code | 231 |
| + Net-new mobile columns (currently blocked) | +9 |
| **= v2 projected steady state** | **~240** |

The 27 dead `err.*` columns are gone for good: they only existed because
Pino's old `stdSerializers.err` enumerated every enumerable property on
DOMException-like errors. The allowlist `serializeErr` in
`packages/observability/src/logger.ts` (`ALLOWED_ERROR_FIELDS`) now refuses
them, so they won't regenerate.

The 9 net-new mobile columns are `assetId`, `bodyPreview`, `errCode`,
`httpStatus`, `mediaType`, `mimeType`, `spotifyTrackId`, `targetIndex`,
`type` (the other mobile field keys already exist as columns).

**~240/257 leaves only ~16 columns of headroom.** That is enough today but
will not absorb much growth. See "Keeping v2 under the cap" below.

## Cutover steps

You cannot do all of this from the repo — items 1–4 are host / Axiom-UI
actions. The repo side (defaults, docs) is already updated to point at
`showbook-prod-v2`.

1. **Create the dataset.** Axiom UI → Settings → Datasets → New dataset →
   `showbook-prod-v2`. (Or `POST /v1/datasets` with a management-capable
   token + `X-AXIOM-ORG-ID: showbook-egap`. **Not** the ingest token — it
   lacks create permission, and auto-create-on-ingest won't fire.)

2. **Grant the ingest token access to v2 (critical, silent-failure trap).**
   The `AXIOM_TOKEN` in `.env.prod` is scoped to `showbook-prod`. Either
   grant it ingest on `showbook-prod-v2`, or mint a new ingest token scoped
   to v2 and replace `AXIOM_TOKEN`. If you skip this, nothing lands and
   there is **no error in Axiom** — only in `docker logs`.

3. **Set the env var and restart prod.** In `.env.prod`:
   `AXIOM_DATASET=showbook-prod-v2`. Then recreate the web container
   (`pnpm prod:up`) so the env reloads. Confirm the value inside the
   running container.

4. **Repoint the read side.**
   - Health-check cron: the code default is now `showbook-prod-v2`
     (`packages/jobs/src/health-check/axiom.ts`, `axiomDataset()`), so no
     action needed unless you override — set `AXIOM_QUERY_DATASET` in
     `.env.prod` only to read a *different* dataset (e.g. temporarily the
     retired `showbook-prod`).
   - `AXIOM_QUERY_TOKEN` (the read PAT): PATs usually cover all org
     datasets; if you used a scoped advanced token, grant it Query on v2.
   - Any Axiom monitors / alerts / dashboards / saved queries referencing
     `["showbook-prod"]`.

5. **Verify ingest.** Query `['showbook-prod-v2']` for recent events and
   confirm `mobile.*` events now appear.

6. **Leave the old dataset.** `showbook-prod` is read-only and expires
   after the 30-day retention window. Note the cutover time so you know
   where the seam is.

## Separate cleanup: the dev-leak `showbook` dataset

There is a second dataset, plain `showbook`, receiving ~2,000 events/30d,
almost all `env=development`. Dev is supposed to **never** ship to Axiom
(`AXIOM_TOKEN`/`AXIOM_DATASET` unset in `.env.dev` / `apps/web/.env.local`).
Some dev/local environment has those set — unset them wherever that's
running. Harmless to prod, but it's noise and a stray ingest path.

## Keeping v2 under the cap

~16 columns of headroom is thin, and mobile telemetry is actively growing
(that's the point of unblocking it). Two levers, most-durable first:

1. **Give mobile its own dataset (recommended next step).** A separate
   `showbook-mobile` dataset means app-server logs and mobile logs each get
   their own 257 budget instead of sharing one. This decouples the two and
   stops the cap from being a recurring fire. Set the mobile telemetry sink
   to ship there.
2. **Keep the field-name surface stable.** Each unique dotted field name is
   a permanent column. Reuse existing keys (`event`, `userId`, `jobId`,
   `key`, `bytes`, `elapsedMs`, `host`, `status`, `reason`, …) instead of
   inventing a new key per log line. A single `log.X({ newRandomKey })`
   callsite widens the schema forever.
