# Showbook — Data Specs

Technical specifications for the Showbook data layer: entity schemas, external data sources, and enrichment pipelines.

These are the **operative contracts** that version with the code.
Historical planning and review material (the greenfield task DAG, the
mobile roadmap, feature plans, point-in-time reviews, the decision log
D1–D24, and the live planned-improvements backlog) lives in the private
knowledge vault — `brain/projects/showbook/` in the workspace, entry
point `showbook.md`.

## Status

- **Schemas:** Draft — reviewed, feedback incorporated
- **Data sources:** Draft — TM primary, setlist.fm secondary, manual fallback
- **Pipelines:** Draft — enrichment + discovery feed defined
- **Infrastructure:** Done — Nx/TypeScript stack, self-hosted on desktop

## Files

| File | What it covers |
|------|---------------|
| [`schema.md`](schema.md) | All entity definitions, field types, relationships, join tables, state machine |
| [`data-sources.md`](data-sources.md) | Ticketmaster, setlist.fm, manual entry, LLM extraction — what each provides, auth, limits |
| [`pipelines.md`](pipelines.md) | Add-flow enrichment sequence, Discover feed ingestion, delayed enrichment retries |
| [`decisions.md`](decisions.md) | D25/D26 — the decisions CI automation cites by ID (D1–D24 are in the vault) |
| [`infrastructure.md`](infrastructure.md) | Stack (TypeScript/Nx), service architecture, costs, offline strategy, Drizzle migration path |
| [`operations.md`](operations.md) | Operator runbook — self-hosted runner / CD, prod DB query endpoint, E2E DB isolation, dev/prod port layout |
| [`VERIFICATION.md`](./VERIFICATION.md) | Playwright testing strategy, screenshot conventions, data integrity checks, visual checklist |

### Mobile

| File | What it covers |
|------|---------------|
| [`mobile-deployment.md`](mobile-deployment.md) | Run on a device, EAS build/submit, beta (TestFlight + Play internal), first-submission checklist |
| [`app-store-listing.md`](app-store-listing.md) | Store listing copy (App Store Connect + Play Console) with per-field character limits |
| [`mobile-testing-strategy.md`](mobile-testing-strategy.md) | Tiered mobile test strategy; the `lib/**`-scoped 80% gate; Maestro waves |

### Operations

| File | What it covers |
|------|---------------|
| [`operations.md`](operations.md) | Operator runbook — self-hosted runner / CD, prod DB query endpoint, dev/prod ports |
| [`operations/axiom-map-fields.md`](operations/axiom-map-fields.md) | Axiom map-field reshape that bounds the per-dataset column cap |
| [`operations/backups.md`](operations/backups.md) | Postgres + R2 backup procedure |
| [`cloudflare-tunnel-setup.md`](cloudflare-tunnel-setup.md) | Cloudflare Tunnel ingress for the self-hosted stack |

### Setlist intelligence

Predicting what an artist plays at an upcoming show. Full sub-tree under
[`setlist-intelligence/`](setlist-intelligence/README.md) — feature plan,
music layer, phase docs (00–11), UI spec, eval harness.

## Key Decisions (quick reference)

- **Ticketmaster Discovery API** is the primary data source for events, venues, and the Discover feed
- **Performer** is the unified entity for headliners, support acts, and theatre cast (all FK references through a join table)
- **Venue** stores lat/lng (geocoded once at creation, not per-render)
- **Announcements** are global (one row per event), user state is separate
- **Chat-mode Add** is powered by LLM parsing into the same structured payload as the form
- **Auth** is Google OAuth only
- **Watching shows auto-delete** when the date passes without tickets
