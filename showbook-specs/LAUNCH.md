# Showbook — Agent Team Launch Guide

---

## Pre-flight

1. **Docker** is running
2. **Git repo** initialized with `showbook-specs/` and `design/` committed
3. **CLAUDE.md** exists in repo root (see below)
4. **tmux** installed (`brew install tmux`)
5. **iTerm2 Python API** enabled (Settings → General → Magic → Enable Python API)
6. **Agent teams** enabled in `~/.claude/settings.json`:
   ```json
   { "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" } }
   ```
7. **API keys** ready (set during build, but have them handy):
   - Google OAuth client ID + secret
   - Ticketmaster API key
   - setlist.fm API key
   - Groq API key
   - Cloudflare R2 credentials

---

## CLAUDE.md

Put this in your repo root:

```markdown
# Showbook

Personal entertainment tracker for live shows — concerts, theatre, comedy, festivals.

## For agents

Read these files in order:
1. `showbook-specs/README.md` — index of all specs
2. `showbook-specs/phases/TASKS.md` — 32 tasks, 5 waves, dependency DAG
3. `showbook-specs/phases/VERIFICATION.md` — Playwright testing strategy

## Stack
- TypeScript everywhere (Next.js 15 + Expo + Drizzle + tRPC)
- Nx monorepo with pnpm
- Docker Compose: two containers (postgres on 5433, web on 3001)
- pg-boss for background jobs (runs inside the Next.js process)
- Groq for LLM (chat-mode Add, playbill cast extraction)
- Playwright for testing
- Cloudflare Tunnel on the host (not Docker) for external access

## Docker

Two containers. Postgres on port 5433, Next.js web on port 3001.

```bash
docker compose up -d              # start both
docker compose logs web           # check Next.js
docker compose exec showbook-db pg_isready -U showbook  # check Postgres
```

Port 5432 and 3000 are used by vacation-price-tracker. Do NOT use those ports.

Run migrations from the host via the exposed port:
```bash
DATABASE_URL=postgresql://showbook:showbook_dev@localhost:5433/showbook npx drizzle-kit migrate
```

Inside the web container, DATABASE_URL uses the Docker service name:
`postgresql://showbook:showbook_dev@postgres:5432/showbook`

## Git
- Work on `main` branch
- Commit after each task: `T{XX}: {description}`
- Push after each wave
- No feature branches
```

---

## Launch

```bash
tmux -CC
cd ~/path/to/showbook
claude
```

---

## The Prompt

```
/model opus-4-6

Read showbook-specs/README.md, then showbook-specs/phases/TASKS.md, then
showbook-specs/phases/VERIFICATION.md.

This is a greenfield build of Showbook. The specs directory has complete schemas,
data source mappings, enrichment pipelines, infrastructure decisions, and a task graph.

TASKS.md defines 32 tasks across 5 waves with a dependency DAG. Execute ALL tasks,
wave by wave, until the project is complete and passes every acceptance criterion below.
Do not stop between waves.

## Execution rules

1. Read TASKS.md. Understand the dependency graph before assigning work.
2. Maximize parallelism within each wave — assign independent tasks to teammates.
3. Each teammate reads the spec files listed in their task before starting.
4. Everything runs in Docker. `docker compose up -d` starts Postgres (5433) and
   web (3001). Ports 5432 and 3000 are taken by another project — never use them.
5. Run migrations from the host: 
   DATABASE_URL=postgresql://showbook:showbook_dev@localhost:5433/showbook npx drizzle-kit migrate
6. Inside the web container, DATABASE_URL is:
   postgresql://showbook:showbook_dev@postgres:5432/showbook
7. Commit after each task: "T{XX}: {description}"
8. Push to main after each wave.
9. Run Playwright tests after each UI task. Fix failures before moving on.
10. Use delegate mode — coordinate and review, don't implement directly.
11. After all 32 tasks, run the full acceptance criteria below and report status.

## Acceptance criteria — DONE when ALL pass:

### Infrastructure
- [ ] `docker compose up -d` starts showbook-db and showbook-web, both healthy
- [ ] `http://localhost:3001` loads the app
- [ ] All database tables exist (verify via docker compose exec showbook-db psql -U showbook -c '\dt')

### Auth
- [ ] Google OAuth sign-in completes end to end
- [ ] Session persists across page refreshes
- [ ] Unauthenticated tRPC requests return 401

### Add flow
- [ ] Add a concert via form → TM enrichment fills venue + date
- [ ] Add a past concert → setlist.fm populates setlist
- [ ] Add a theatre show with playbill photo → Groq extracts cast
- [ ] Add a festival with multiple headliners + end_date
- [ ] Chat mode: free text → Groq parse → confirm → save
- [ ] All shows in Postgres with correct state, venue FK, performer FKs

### Shows page
- [ ] List: past (solid color bar), ticketed (TIX chip), watching (WATCHING chip)
- [ ] Click row → expand detail with headliner, venue, setlist
- [ ] Year rail filters work
- [ ] Calendar mode shows dots
- [ ] Stats mode shows counts

### Home page
- [ ] Hero card: next ticketed show with countdown
- [ ] Recent 5 past shows below
- [ ] Empty states render correctly

### Discover
- [ ] Follow a venue → run ingestion job → announcements appear
- [ ] Discover page shows announcements grouped by venue
- [ ] Watch button creates watching show in Shows list
- [ ] Near You tab works with user regions

### Map
- [ ] Pins at venue lat/lng coordinates
- [ ] Click pin → inspector with show count, kinds, follow button

### Background jobs
- [ ] Nightly job: ticketed → past when date passes
- [ ] Nightly job: deletes expired watching shows
- [ ] Setlist retry: enriches past concerts from setlist.fm
- [ ] Discovery ingestion: fetches TM events for followed venues

### Preferences
- [ ] Theme toggle (dark/light/system)
- [ ] Region CRUD (add, remove, toggle)
- [ ] Followed venues with unfollow

### Photos
- [ ] Upload → 3 WebP variants in R2
- [ ] Show detail renders photo from R2 URL

### Playwright
- [ ] `npx playwright test` passes with 0 failures
- [ ] Screenshots exist for every page (desktop + mobile viewports)

### Git
- [ ] All commits on main, one per task (T01–T32)
- [ ] All pushed

Report final status and any known issues when done.
```

---

## Monitoring

- Watch tmux panes for errors or stalled agents
- Check `/usage` periodically — agent teams burn tokens
- If a teammate stalls, tell the lead to nudge or replace it
- If the lead dies, `/resume` and tell it to continue from where it stopped (spawn new teammates)

---

## Fallback: wave-by-wave

If continuous execution is unstable:

```
Execute Wave 1 from TASKS.md (T01-T05). All 5 are independent — maximize
parallelism. Commit each task, push when done. Report status.
```

Then:

```
Wave 1 complete. Execute Wave 2 (T06-T13). Check dependencies within the wave.
Push when done.
```

Continue through Wave 5.
