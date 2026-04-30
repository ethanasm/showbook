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
  status=$(docker inspect -f '{{.State.Health.Status}}' showbook-dev-db 2>/dev/null || echo "starting")
  if [ "$status" = "healthy" ]; then
    log "postgres is healthy."
    break
  fi
  sleep 1
done

if [ "$(docker inspect -f '{{.State.Health.Status}}' showbook-dev-db 2>/dev/null)" != "healthy" ]; then
  log "ERROR: postgres did not become healthy in time."
  docker compose logs postgres | tail -40 || true
  exit 1
fi

# 4. Run database migrations.
log "Running drizzle migrations..."
pnpm db:migrate

# 5. Install Playwright Chromium.
#    cdn.playwright.dev is blocked in the sandbox network, so try the standard
#    installer first (in case the host gets allowlisted later) and fall back to
#    pulling Chrome for Testing directly from Google's public storage.
PW_BROWSERS_DIR="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
mkdir -p "$PW_BROWSERS_DIR"

PW_BROWSERS_JSON=$(find "$CLAUDE_PROJECT_DIR/node_modules" -path "*playwright-core/browsers.json" 2>/dev/null | head -1)
if [ -z "$PW_BROWSERS_JSON" ]; then
  log "ERROR: could not locate playwright-core/browsers.json after pnpm install."
  exit 1
fi

read_browsers_json() {
  node -e "
    const j = require('$PW_BROWSERS_JSON');
    const b = j.browsers.find(x => x.name === '$1');
    if (!b) process.exit(1);
    console.log(b.revision + ' ' + b.browserVersion);
  "
}

install_cft_zip() {
  local name="$1"           # chromium | chromium-headless-shell
  local zip_basename="$2"   # chrome-linux64.zip | chrome-headless-shell-linux64.zip
  local revision version dir
  read revision version < <(read_browsers_json "$name")
  dir="$PW_BROWSERS_DIR/${name//-/_}-${revision}"

  if [ -f "$dir/INSTALLATION_COMPLETE" ]; then
    log "$name-$revision already installed."
    return 0
  fi

  local url="https://storage.googleapis.com/chrome-for-testing-public/${version}/linux64/${zip_basename}"
  local tmp; tmp=$(mktemp -d)
  log "Downloading $name $version from $url"
  curl -sSfL --max-time 180 -o "$tmp/$zip_basename" "$url"
  mkdir -p "$dir"
  unzip -q -o "$tmp/$zip_basename" -d "$dir"
  touch "$dir/INSTALLATION_COMPLETE"
  rm -rf "$tmp"
  log "Installed $name to $dir"
}

log "Installing Playwright Chromium..."
if pnpm --filter web exec playwright install chromium >/dev/null 2>&1; then
  log "playwright install succeeded via standard CDN."
else
  log "playwright install failed (CDN blocked); falling back to direct CFT download."
  install_cft_zip chromium chrome-linux64.zip
  install_cft_zip chromium-headless-shell chrome-headless-shell-linux64.zip
fi

# 6. Stub apps/web/.env.local so the Next.js dev server can boot under Playwright.
#    Modules read these eagerly at import time; placeholder values are fine for
#    tests that don't actually call the third-party services. Next loads env
#    from the directory where `next dev` runs, which is apps/web.
if [ ! -f apps/web/.env.local ]; then
  log "Writing stub apps/web/.env.local (placeholder values for tests)..."
  cat > apps/web/.env.local <<'ENVEOF'
DATABASE_URL=postgresql://showbook:showbook_dev@localhost:5433/showbook
NEXTAUTH_URL=https://localhost:3001
NEXTAUTH_SECRET=test-secret-not-for-production
GOOGLE_CLIENT_ID=stub-google-client-id
GOOGLE_CLIENT_SECRET=stub-google-client-secret
TICKETMASTER_API_KEY=stub-ticketmaster
SETLISTFM_API_KEY=stub-setlistfm
GROQ_API_KEY=gsk_stub_groq_key_for_tests
GOOGLE_PLACES_API_KEY=stub-google-places
R2_ACCOUNT_ID=stub
R2_ACCESS_KEY_ID=stub
R2_SECRET_ACCESS_KEY=stub
R2_BUCKET_NAME=stub
R2_PUBLIC_URL=http://localhost/r2
LOG_LEVEL=info
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_BASEURL=
AXIOM_TOKEN=
AXIOM_DATASET=
ENVEOF
fi

# 7. Persist DATABASE_URL so the agent shell sees it.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export DATABASE_URL="postgresql://showbook:showbook_dev@localhost:5433/showbook"' >> "$CLAUDE_ENV_FILE"
fi

log "Session start hook complete."
