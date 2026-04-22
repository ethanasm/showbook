# Showbook

Personal entertainment tracker for live shows — concerts, theatre, comedy, festivals.

## Project structure
- `showbook-specs/` — All specs: schema, data sources, pipelines, infrastructure, decisions
- `showbook-specs/phases/TASKS.md` — Master task list with dependency DAG (32 tasks, 5 waves)
- `showbook-specs/phases/VERIFICATION.md` — Playwright testing + visual verification strategy
- `design/` — Hi-fi prototypes from Claude Design (reference only, don't modify)

## Key decisions
- TypeScript everywhere (Next.js + Expo + Drizzle + tRPC)
- Nx monorepo with pnpm
- Self-hosted on desktop (local Postgres, Caddy, Cloudflare Tunnel)
- pg-boss for background jobs (runs inside Next.js process)
- Groq for LLM (chat-mode Add, playbill cast extraction)
- Ticketmaster Discovery API as primary data source
- Playwright for functional + visual testing

## For agents
Read `showbook-specs/README.md` first. It indexes all spec files.
Read `showbook-specs/phases/TASKS.md` for the full task breakdown and dependency graph.
Each task specifies which spec files to read and how to verify completion.
