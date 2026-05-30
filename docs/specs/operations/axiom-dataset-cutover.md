# Axiom datasets: `prod-server` + `prod-mobile`

## Why

The original `showbook-prod` Axiom dataset hit Axiom's **257-column hard
cap** (`getschema` reported 258). Once a dataset is at the cap, every write
that introduces a never-before-seen field is **rejected wholesale** — and
the rejection only appears in `docker logs showbook-prod-web`, never in
Axiom itself. The casualties were the mobile telemetry `mobile.*` events:
their context fields (`errCode`, `spotifyTrackId`, `assetId`, …) are new
field names, so for ~2 months in 2026-05 essentially every mobile event was
silently dropped. Over a 90-day window only a single `mobile.*` event
landed.

You cannot raise the column limit yourself — 257 is an org/plan default,
raisable only by Axiom support. The fix is a **fresh dataset whose schema
starts at 0 columns**, plus a **split** so the high-cardinality mobile
field surface never shares the server dataset's budget again:

- **`prod-server`** — all app/server pino logs (the bulk of events).
- **`prod-mobile`** — only the `mobile.*` telemetry relayed through the
  `telemetry.logEvent` tRPC router.

Each dataset gets its own independent 257-column budget.

## How the split works (code)

The mobile app has no direct path to Axiom; its telemetry arrives
server-side via `packages/api/src/routers/telemetry.ts`, which logs through
a child logger bound with `component: 'mobile.telemetry'` under the
`mobile.<event>` namespace.

`packages/observability/src/logger.ts` ships two Axiom transports via
`pino.multistream`:

- `AXIOM_DATASET` (`prod-server`) receives every line **except** mobile
  ones.
- `AXIOM_MOBILE_DATASET` (`prod-mobile`) receives **only** mobile lines.

Routing is a substring match (`isMobileRecord`) on the serialized line's
bound `"component":"mobile.telemetry"` field — no per-line JSON parse.

**Fallback:** if `AXIOM_MOBILE_DATASET` is unset, the logger runs in
single-dataset mode and everything (mobile included) goes to
`AXIOM_DATASET`. So the split is opt-in via env and safe to roll out before
the mobile dataset exists.

## Will each dataset stay under the cap?

Yes, comfortably — the split is what buys the headroom. `prod-server`
regenerates from current app code minus the dead columns that bloated the
old dataset:

| Bucket | Columns |
| --- | --- |
| Old `showbook-prod` schema (`getschema`) | 258 |
| − Dead DOMException constants (`err.*_ERR`) | −25 |
| − Dead `err.params` + `err.cause.params` | −2 |
| − Mobile fields (now in `prod-mobile`) | a handful |
| **= `prod-server` steady state** | **~230** |

`prod-mobile` starts near-empty and only ever holds the mobile field
surface (low double digits), so it has the full 257 to grow into.

The 27 dead `err.*` columns are gone for good: they only existed because
Pino's old `stdSerializers.err` enumerated every enumerable property on
DOMException-like errors. The allowlist `serializeErr` in
`packages/observability/src/logger.ts` (`ALLOWED_ERROR_FIELDS`) now refuses
them, so they won't regenerate in either dataset.

## Operator setup (Axiom UI + `.env.prod`)

Repo side (logger split, health-check default, docs) is already done and
points at `prod-server` / `prod-mobile`. The host/Axiom side:

1. **Create both datasets.** Axiom UI → Settings → Datasets → New dataset →
   `prod-server`, then `prod-mobile`. (Or `POST /v1/datasets` with a
   management-capable token + `X-AXIOM-ORG-ID: showbook-egap`. **Not** the
   ingest token — it lacks create permission, and auto-create-on-ingest
   won't fire.)

2. **Grant the ingest token access to BOTH datasets (silent-failure trap).**
   The `AXIOM_TOKEN` in `.env.prod` must have ingest on `prod-server` **and**
   `prod-mobile` (or mint a token scoped to both). If a dataset isn't
   covered, its events vanish with **no error in Axiom** — only in
   `docker logs`.

3. **Set env and restart prod.** In `.env.prod`:
   ```
   AXIOM_DATASET=prod-server
   AXIOM_MOBILE_DATASET=prod-mobile
   AXIOM_QUERY_DATASET=prod-server
   ```
   These live **only in `.env.prod`** — not on dev machines (dev never
   ships to Axiom) and not in GitHub secrets (CI doesn't ship logs). Then
   recreate the web container (`pnpm prod:up`) so the env reloads, and
   confirm the values inside the running container.

   Note: until the logger code change deploys, prod runs single-dataset
   mode and `AXIOM_MOBILE_DATASET` is ignored — mobile lands in
   `prod-server` harmlessly until the split ships.

4. **Repoint the read side.**
   - Health-check cron: code default is now `prod-server`
     (`packages/jobs/src/health-check/axiom.ts`, `axiomDataset()`), so no
     action needed unless overriding via `AXIOM_QUERY_DATASET`.
   - `AXIOM_QUERY_TOKEN` (read PAT): PATs usually cover all org datasets; a
     scoped advanced token needs Query granted on both new datasets.
   - Repoint any Axiom monitors / alerts / dashboards / saved queries that
     referenced `["showbook-prod"]` → `["prod-server"]` (and add
     `["prod-mobile"]` views where mobile matters).

5. **Verify.** Query `['prod-mobile']` and confirm `mobile.*` events appear;
   query `['prod-server']` and confirm they do **not** (and that server
   events do).

## Separate cleanup: the dev-leak `showbook` dataset

There was a second dataset, plain `showbook`, receiving ~2,000 events/30d,
almost all `env=development`. Dev is supposed to **never** ship to Axiom
(`AXIOM_TOKEN`/`AXIOM_DATASET` unset in `.env.dev` / `apps/web/.env.local`).
Some dev/local environment had those set — unset them wherever that's
running. Harmless to prod, but it's noise and a stray ingest path.

## Keeping both datasets under the cap

The split removes the acute risk, but the field-name discipline still
matters per dataset:

- **Keep the field-name surface stable.** Each unique dotted field name is a
  permanent column. Reuse existing keys (`event`, `userId`, `jobId`, `key`,
  `bytes`, `elapsedMs`, `host`, `status`, `reason`, …) instead of inventing
  a new key per log line. A single `log.X({ newRandomKey })` callsite
  widens the schema forever.
- **Mobile context bags** (`telemetry.logEvent`'s `context`) now widen only
  `prod-mobile`, but the same rule applies — prefer a small, stable set of
  keys over ad-hoc ones.
