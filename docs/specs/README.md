# Showbook — Data Specs

Technical specifications for the Showbook data layer: entity schemas, external data sources, and enrichment pipelines.

## Status

- **Schemas:** Draft — reviewed, feedback incorporated
- **Data sources:** Draft — TM primary, setlist.fm secondary, manual fallback
- **Pipelines:** Draft — enrichment + discovery feed defined
- **Infrastructure:** Done — Nx/TypeScript stack, self-hosted on desktop
- **Build tasks:** Ready — 32 tasks across 5 waves, dependency DAG, Playwright verification strategy

## Files

| File | What it covers |
|------|---------------|
| [`schema.md`](schema.md) | All entity definitions, field types, relationships, join tables, state machine |
| [`data-sources.md`](data-sources.md) | Ticketmaster, setlist.fm, manual entry, LLM extraction — what each provides, auth, limits |
| [`pipelines.md`](pipelines.md) | Add-flow enrichment sequence, Discover feed ingestion, delayed enrichment retries |
| [`decisions.md`](decisions.md) | Resolved design decisions + remaining open questions |
| [`infrastructure.md`](infrastructure.md) | Stack (TypeScript/Nx), service architecture, costs, offline strategy, Drizzle migration path |
| [`operations.md`](operations.md) | Operator runbook — self-hosted runner / CD, prod DB query endpoint, E2E DB isolation, dev/prod port layout |
| [`mobile-roadmap.md`](mobile-roadmap.md) | Mobile build plan — milestones, stack decisions, status tracker |

### Build Tasks

Implementation tasks structured for parallel execution by Claude Code agent teams. Each task has explicit dependencies, spec references, and verification criteria.

| File | What it is |
|------|-----------|
| [`TASKS.md`](./TASKS.md) | Master task list — 32 tasks across 5 waves, dependency DAG, parallelism summary |
| [`VERIFICATION.md`](./VERIFICATION.md) | Playwright testing strategy, screenshot conventions, data integrity checks, visual checklist |
| [`LAUNCH.md`](./LAUNCH.md) | Agent-team launch guide for the **original greenfield build** (historical — see the file header) |

### Mobile

| File | What it covers |
|------|---------------|
| [`mobile-roadmap.md`](mobile-roadmap.md) | Milestones (M1–M6), stack decisions, status tracker |
| [`mobile-m2-m6-plan.md`](mobile-m2-m6-plan.md) | M2–M6 parallel-execution plan with dependency arrows |
| [`mobile-deployment.md`](mobile-deployment.md) | Run on a device, EAS build/submit, beta (TestFlight + Play internal), first-submission checklist |
| [`mobile-testing-strategy.md`](mobile-testing-strategy.md) | Tiered mobile test strategy; the `lib/**`-scoped 80% gate; Maestro waves |

### Operations

| File | What it covers |
|------|---------------|
| [`operations.md`](operations.md) | Operator runbook — self-hosted runner / CD, prod DB query endpoint, dev/prod ports |
| [`operations/axiom-map-fields.md`](operations/axiom-map-fields.md) | Axiom map-field reshape that bounds the per-dataset column cap |
| [`operations/axiom-dataset-cutover.md`](operations/axiom-dataset-cutover.md) | Superseded prod-server/prod-mobile split (kept for history) |
| [`operations/backups.md`](operations/backups.md) | Postgres + R2 backup procedure |
| [`cloudflare-tunnel-setup.md`](cloudflare-tunnel-setup.md) | Cloudflare Tunnel ingress for the self-hosted stack |

### Setlist intelligence

Predicting what an artist plays at an upcoming show. Full sub-tree under
[`setlist-intelligence/`](setlist-intelligence/README.md) — feature plan,
music layer, phase docs (00–11), UI spec, eval harness.

### Reviews & feature plans (point-in-time, kept for reference)

`codebase-review-2026-05-04.md`, `security-review-2026-04-30.md`,
`security-review-2026-06-09.md`, `preferences-review-2026-04-29.md`,
`data-model-deletion-cascades-2026-04-29.md`,
`email-ingestion-improvements-2026-05-08.md`,
`feature-brainstorm-2026-05-02.md`, `feature-plan-*.md`, and
[`planned-improvements.md`](planned-improvements.md) (the live follow-up backlog).

## Key Decisions (quick reference)

- **Ticketmaster Discovery API** is the primary data source for events, venues, and the Discover feed
- **Performer** is the unified entity for headliners, support acts, and theatre cast (all FK references through a join table)
- **Venue** stores lat/lng (geocoded once at creation, not per-render)
- **Announcements** are global (one row per event), user state is separate
- **Chat-mode Add** is powered by LLM parsing into the same structured payload as the form
- **Auth** is Google OAuth only
- **Watching shows auto-delete** when the date passes without tickets
