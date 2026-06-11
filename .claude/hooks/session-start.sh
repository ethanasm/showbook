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
  # Match the packageManager pin in package.json (pnpm@10.33.4). Activating a
  # different pnpm here makes install rewrite pnpm-lock.yaml because pnpm
  # minor versions serialize peer-dependency keys differently.
  corepack prepare pnpm@10.33.4 --activate
fi

# Use --frozen-lockfile so install never rewrites pnpm-lock.yaml. A plain
# `pnpm install` "fixes up" the lockfile's peer-dependency serialization on
# every boot, leaving an uncommitted `M pnpm-lock.yaml` that every agent then
# flags. The lockfile is committed and authoritative; CI installs the same way.
# If deps genuinely change, update the lockfile in a commit rather than letting
# session-start mutate it out from under the agent.
log "Installing pnpm dependencies..."
pnpm install --frozen-lockfile --prefer-offline

# 3. Bring up the Postgres container (the web container needs .env.local and is
#    not required for tests — Playwright spins up its own dev server).
#    The compose file lives under infra/, so pin it explicitly — a bare
#    `docker compose` from the repo root finds no configuration file unless
#    the environment happens to export COMPOSE_FILE.
export COMPOSE_FILE="$CLAUDE_PROJECT_DIR/infra/docker-compose.yml"

# Docker Hub rate-limits unauthenticated pulls aggressively enough that a
# fresh sandbox often can't pull the db image at all ("You have reached your
# unauthenticated pull rate limit"), which used to kill this hook and block
# everything that needs Postgres — migrations, Playwright e2e, and the
# pr-screenshots web captures. The registries below are pull-through mirrors
# of the official Docker Hub images — byte-identical content, no auth, no
# practical rate limit — so fall back through them and retag locally under
# the canonical name the compose file expects.
DB_IMAGE=$(grep -m1 -E '^\s*image:' "$COMPOSE_FILE" | awk '{print $2}')
if ! docker image inspect "$DB_IMAGE" >/dev/null 2>&1; then
  log "Pulling $DB_IMAGE..."
  if ! docker pull "$DB_IMAGE" >/dev/null 2>&1; then
    pulled=""
    for mirror in "mirror.gcr.io/library/$DB_IMAGE" "public.ecr.aws/docker/library/$DB_IMAGE"; do
      log "Docker Hub pull failed (rate limit?); trying $mirror..."
      if docker pull "$mirror" >/dev/null 2>&1; then
        docker tag "$mirror" "$DB_IMAGE"
        log "Pulled $DB_IMAGE via $mirror."
        pulled=1
        break
      fi
    done
    if [ -z "$pulled" ]; then
      log "ERROR: could not pull $DB_IMAGE from Docker Hub or any mirror."
      exit 1
    fi
  fi
fi

log "Starting postgres container..."
docker compose up -d db

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
  docker compose logs db | tail -40 || true
  exit 1
fi

# 4. Run database migrations.
log "Running drizzle migrations..."
pnpm dev:db:migrate

# 5. Install Playwright Chromium for every workspace that runs Playwright.
#    cdn.playwright.dev may be blocked depending on the environment's network
#    policy, so try the standard installer first (it fetches the exact build
#    the workspace's @playwright/test pins) and fall back to pulling Chrome
#    for Testing directly from Google's public storage.
#
#    BOTH apps/web and apps/mobile run Playwright, and the tree can carry more
#    than one playwright-core (e.g. a transitive tool pins an older version).
#    Each workspace must get the browser revision ITS OWN playwright-core
#    wants — the previous `find … | head -1` grabbed an arbitrary
#    playwright-core, so it installed the wrong chromium revision and left the
#    other workspace's tests with no browser. Resolve per workspace instead.
PW_BROWSERS_DIR="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
mkdir -p "$PW_BROWSERS_DIR"

install_playwright_for() {
  local app="$1"
  log "Installing Playwright Chromium for '$app'..."
  if pnpm --filter "$app" exec playwright install chromium >/dev/null 2>&1; then
    log "playwright install ($app) succeeded via standard CDN."
    return 0
  fi
  log "playwright install ($app) failed (CDN blocked); falling back to direct CFT download."

  # Ask THIS workspace's own playwright binary exactly what it would install
  # (version + target dir) via --dry-run, then pull the matching
  # Chrome-for-Testing zip from Google's public bucket. Driving the fallback
  # off the binary avoids guessing a revision from an arbitrary playwright-core
  # in a pnpm-hoisted tree (the old `find … | head -1` bug, which grabbed the
  # wrong version and left a workspace's tests with no browser). The dry-run
  # prints, per build:
  #   Install location:    /opt/pw-browsers/chromium-1223
  #   Download url:        https://cdn.playwright.dev/builds/cft/<ver>/linux64/chrome-linux64.zip
  local plan
  if ! plan=$(pnpm --filter "$app" exec playwright install chromium --dry-run 2>/dev/null); then
    log "ERROR: could not compute Playwright install plan for '$app'."
    return 1
  fi

  # Emit "<install_dir>\t<google_cft_zip_url>" for each Chrome-for-Testing
  # build in the plan (skips ffmpeg, whose URL isn't under /builds/cft/).
  local entries
  entries=$(printf '%s\n' "$plan" | node -e '
    const lines = require("fs").readFileSync(0, "utf8").split(/\r?\n/);
    let dir = null;
    for (const line of lines) {
      const loc = line.match(/Install location:\s*(\S+)/);
      if (loc) { dir = loc[1]; continue; }
      const url = line.match(/Download url:\s*(https?:\/\/\S+\/builds\/cft\/\S+)/);
      if (url && dir) {
        const cft = url[1].replace(
          /^https?:\/\/[^/]+\/builds\/cft\//,
          "https://storage.googleapis.com/chrome-for-testing-public/",
        );
        console.log(dir + "\t" + cft);
        dir = null;
      }
    }
  ')
  if [ -z "$entries" ]; then
    log "ERROR: no Chrome-for-Testing builds in install plan for '$app'."
    return 1
  fi

  local dir url zip tmp
  while IFS=$'\t' read -r dir url; do
    [ -n "$dir" ] || continue
    if [ -f "$dir/INSTALLATION_COMPLETE" ]; then
      log "$(basename "$dir") already installed."
      continue
    fi
    zip=$(basename "$url")
    tmp=$(mktemp -d)
    log "Downloading $zip -> $dir"
    curl -sSfL --max-time 180 -o "$tmp/$zip" "$url"
    mkdir -p "$dir"
    unzip -q -o "$tmp/$zip" -d "$dir"
    touch "$dir/INSTALLATION_COMPLETE"
    rm -rf "$tmp"
    log "Installed $(basename "$dir")"
  done <<< "$entries"
}

pw_failed=0
for app in web mobile; do
  install_playwright_for "$app" || pw_failed=1
done
if [ "$pw_failed" -ne 0 ]; then
  log "ERROR: Playwright browser install failed for at least one workspace."
  exit 1
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
SPOTIFY_CLIENT_ID=stub-spotify-client-id
SPOTIFY_CLIENT_SECRET=stub-spotify-client-secret
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
