#!/usr/bin/env bash
# Showbook coverage verification: build + lint + unit + integration with
# merged Node native code coverage, enforced 80% threshold across lines,
# branches, functions. Uses Nx for cached test runs.
#
# Usage:
#   pnpm verify:coverage
#   SKIP_INTEGRATION=1 pnpm verify:coverage   # unit only
#   SKIP_BUILD=1 pnpm verify:coverage         # iterate faster
#   THRESHOLD=70 pnpm verify:coverage         # tune locally

set -o pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

THRESHOLD="${THRESHOLD:-80}"
SKIP_INTEGRATION="${SKIP_INTEGRATION:-0}"
SKIP_BUILD="${SKIP_BUILD:-0}"
SKIP_LINT="${SKIP_LINT:-0}"

GREEN=$'\033[0;32m'
RED=$'\033[0;31m'
YELLOW=$'\033[0;33m'
PURPLE=$'\033[0;35m'
DIM=$'\033[2m'
BOLD=$'\033[1m'
NC=$'\033[0m'
CHECK="✓"
CROSS="✗"
SKIP="—"

declare -a STEP_NAMES
declare -a STEP_RESULTS
FAILED=0

run_step() {
  local name="$1"; shift
  echo ""
  echo "${PURPLE}${BOLD}━━━ ${name} ━━━${NC}"
  echo "${DIM}\$ $*${NC}"
  if "$@"; then
    STEP_NAMES+=("$name")
    STEP_RESULTS+=("pass")
    echo "${GREEN}${CHECK} ${name} passed${NC}"
  else
    STEP_NAMES+=("$name")
    STEP_RESULTS+=("fail")
    echo "${RED}${CROSS} ${name} failed${NC}"
    FAILED=1
  fi
}

skip_step() {
  STEP_NAMES+=("$1")
  STEP_RESULTS+=("skip")
  echo ""
  echo "${PURPLE}${BOLD}━━━ $1 ━━━${NC}"
  echo "${YELLOW}${SKIP} skipped: $2${NC}"
}

# Reset per-package coverage outputs (Nx will replay from cache when source unchanged).
find packages apps -maxdepth 3 -type d -name coverage -exec rm -rf {} + 2>/dev/null || true
mkdir -p "$REPO_ROOT/coverage"

# ── Build & lint ────────────────────────────────────────────────────────
if [ "$SKIP_BUILD" = "1" ]; then
  skip_step "Build" "SKIP_BUILD=1"
else
  run_step "Build" pnpm build
fi
if [ "$SKIP_LINT" = "1" ]; then
  skip_step "Lint" "SKIP_LINT=1"
else
  run_step "Lint" pnpm lint
fi

# ── Unit tests with coverage (Nx caches per-project) ────────────────────
run_step "Unit tests + coverage" pnpm exec nx run-many -t test:coverage

# ── Integration tests with coverage ─────────────────────────────────────
postgres_available() {
  if [ "$CI" = "true" ]; then
    pg_isready -h localhost -p 5433 -U showbook >/dev/null 2>&1
  else
    docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^showbook-postgres\|^showbook-db'
  fi
}

prepare_e2e_db() {
  if [ "$CI" = "true" ]; then
    # In CI the postgres service container is reachable directly; bypass
    # the docker-compose helpers in db:prepare:e2e.
    PGPASSWORD=showbook_dev psql -h localhost -p 5433 -U showbook -d showbook \
      -c 'DROP DATABASE IF EXISTS showbook_e2e WITH (FORCE);' && \
    PGPASSWORD=showbook_dev psql -h localhost -p 5433 -U showbook -d showbook \
      -c 'CREATE DATABASE showbook_e2e;' && \
    DATABASE_URL="${E2E_DATABASE_URL:-postgresql://showbook:showbook_dev@localhost:5433/showbook_e2e}" \
      pnpm --filter @showbook/db drizzle-kit migrate && \
    DATABASE_URL="${E2E_DATABASE_URL:-postgresql://showbook:showbook_dev@localhost:5433/showbook_e2e}" \
      pnpm --filter @showbook/jobs bootstrap-pgboss
  else
    pnpm db:prepare:e2e
  fi
}

if [ "$SKIP_INTEGRATION" = "1" ]; then
  skip_step "Integration tests" "SKIP_INTEGRATION=1"
else
  if ! postgres_available; then
    skip_step "Integration tests" "postgres not reachable on localhost:5433"
    FAILED=1
  else
    run_step "DB prepare (e2e)" prepare_e2e_db
    export DATABASE_URL="${E2E_DATABASE_URL:-postgresql://showbook:showbook_dev@localhost:5433/showbook_e2e}"
    run_step "Integration tests + coverage" pnpm exec nx run-many -t test:integration:coverage --parallel=1
  fi
fi

# ── Coverage report + threshold gate ────────────────────────────────────
echo ""
echo "${PURPLE}${BOLD}━━━ Coverage report (threshold ${THRESHOLD}%) ━━━${NC}"
if node "$REPO_ROOT/scripts/coverage-report.mjs" --threshold="$THRESHOLD" --write=coverage/lcov.info; then
  STEP_NAMES+=("Coverage threshold")
  STEP_RESULTS+=("pass")
  echo "${GREEN}${CHECK} Coverage at or above ${THRESHOLD}%${NC}"
else
  STEP_NAMES+=("Coverage threshold")
  STEP_RESULTS+=("fail")
  echo "${RED}${CROSS} Coverage below ${THRESHOLD}%${NC}"
  FAILED=1
fi

# ── Summary ─────────────────────────────────────────────────────────────
echo ""
echo "${BOLD}┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓${NC}"
echo "${BOLD}┃              VERIFY:COVERAGE SUMMARY                     ┃${NC}"
echo "${BOLD}┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${NC}"

for i in "${!STEP_NAMES[@]}"; do
  case "${STEP_RESULTS[$i]}" in
    pass) printf "  ${GREEN}${CHECK}${NC} %s\n" "${STEP_NAMES[$i]}" ;;
    fail) printf "  ${RED}${CROSS}${NC} %s\n" "${STEP_NAMES[$i]}" ;;
    skip) printf "  ${YELLOW}${SKIP}${NC} %s ${DIM}(skipped)${NC}\n" "${STEP_NAMES[$i]}" ;;
  esac
done

echo ""
if [ $FAILED -eq 1 ]; then
  echo "${RED}${BOLD}Coverage verification failed.${NC}"
  exit 1
else
  echo "${GREEN}${BOLD}Coverage verification passed.${NC}"
  exit 0
fi
