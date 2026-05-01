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
| [`mobile-roadmap.md`](mobile-roadmap.md) | Mobile build plan — M1–M6 milestones, stack decisions, status tracker |

### Build Tasks

Implementation tasks structured for parallel execution by Claude Code agent teams. Each task has explicit dependencies, spec references, and verification criteria.

| File | What it is |
|------|-----------|
| [`phases/TASKS.md`](./phases/TASKS.md) | Master task list — 32 tasks across 5 waves, dependency DAG, parallelism summary |
| [`phases/VERIFICATION.md`](./phases/VERIFICATION.md) | Playwright testing strategy, screenshot conventions, data integrity checks, visual checklist |
| [`phases/LAUNCH.md`](./phases/LAUNCH.md) | Agent team launch guide — CLAUDE.md template, the full prompt, acceptance criteria, monitoring tips |

## Key Decisions (quick reference)

- **Ticketmaster Discovery API** is the primary data source for events, venues, and the Discover feed
- **Performer** is the unified entity for headliners, support acts, and theatre cast (all FK references through a join table)
- **Venue** stores lat/lng (geocoded once at creation, not per-render)
- **Announcements** are global (one row per event), user state is separate
- **Chat-mode Add** is powered by LLM parsing into the same structured payload as the form
- **Auth** is Google OAuth only
- **Watching shows auto-delete** when the date passes without tickets
