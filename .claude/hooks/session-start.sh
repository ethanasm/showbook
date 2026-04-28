#!/bin/bash
set -euo pipefail

# Only run in Claude Code on the web (remote) environments.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

log() { echo "[session-start] $*"; }

# 1. Start the Docker daemon if it isn't already running.
if ! docker info >/dev/null 2>&1; then
  log "Starting dockerd..."
  mkdir -p /var/log
  nohup dockerd >/var/log/dockerd.log 2>&1 &

  for i in {1..30}; do
    if docker info >/dev/null 2>&1; then
      log "dockerd is up."
      break
    fi
    sleep 1
  done

  if ! docker info >/dev/null 2>&1; then
    log "ERROR: dockerd failed to start. Tail of /var/log/dockerd.log:"
    tail -40 /var/log/dockerd.log || true
    exit 1
  fi
else
  log "dockerd already running."
fi

# 2. Install workspace dependencies (pnpm).
if ! command -v pnpm >/dev/null 2>&1; then
  log "Enabling pnpm via corepack..."
  corepack enable
  corepack prepare pnpm@9.15.4 --activate
fi

log "Installing pnpm dependencies..."
pnpm install --prefer-offline

# 3. Bring up the Postgres container (the web container needs .env.local and is
#    not required for tests — Playwright spins up its own dev server).
log "Starting postgres container..."
docker compose up -d postgres

log "Waiting for postgres to be healthy..."
for i in {1..60}; do
  status=$(docker inspect -f '{{.State.Health.Status}}' showbook-db 2>/dev/null || echo "starting")
  if [ "$status" = "healthy" ]; then
    log "postgres is healthy."
    break
  fi
  sleep 1
done

if [ "$(docker inspect -f '{{.State.Health.Status}}' showbook-db 2>/dev/null)" != "healthy" ]; then
  log "ERROR: postgres did not become healthy in time."
  docker compose logs postgres | tail -40 || true
  exit 1
fi

# 4. Run database migrations.
log "Running drizzle migrations..."
pnpm db:migrate

# 5. Install Playwright browsers for e2e tests (best-effort).
#    cdn.playwright.dev may not be in the sandbox network allowlist, so we
#    don't fail the hook if the download is blocked — lint/typecheck/db tasks
#    still work without it.
log "Installing Playwright browsers (best-effort)..."
if ! pnpm --filter web exec playwright install chromium; then
  log "WARN: Playwright browser install failed (likely network allowlist). Skipping."
fi

# 6. Persist DATABASE_URL so the agent shell sees it.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export DATABASE_URL="postgresql://showbook:showbook_dev@localhost:5433/showbook"' >> "$CLAUDE_ENV_FILE"
fi

log "Session start hook complete."
