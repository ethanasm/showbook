#!/usr/bin/env bash
# Showbook verification: build + lint + unit tests, with optional e2e.
# Status of each step is reported at the end.
#
# Each step's combined stdout/stderr is also teed to .verify-logs/<slug>.log
# with a sidecar .verify-logs/<slug>.status (pass|fail|skip). Those files
# back scripts/post-verify-failure-comment.mjs, which posts a sticky PR
# comment in CI so failure detail reaches the PR webhook stream.
#
# Usage:
#   pnpm verify          # build, lint, unit tests
#   pnpm verify:e2e      # also run Playwright e2e
#   RUN_E2E=1 pnpm verify

set -o pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$REPO_ROOT/.verify-logs"

RUN_E2E="${RUN_E2E:-0}"
for arg in "$@"; do
  case "$arg" in
    --e2e) RUN_E2E=1 ;;
  esac
done

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
declare -a STEP_RESULTS  # pass | fail | skip
FAILED=0

rm -rf "$LOG_DIR"
mkdir -p "$LOG_DIR"

run_step() {
  local name="$1"; shift
  local slug="$1"; shift
  local log="$LOG_DIR/${slug}.log"
  local status_file="$LOG_DIR/${slug}.status"
  echo ""
  echo "${PURPLE}${BOLD}━━━ ${name} ━━━${NC}"
  echo "${DIM}\$ $*${NC}"
  # Tee combined output to the log while preserving exit code via PIPESTATUS.
  "$@" 2>&1 | tee "$log"
  local rc=${PIPESTATUS[0]}
  if [ "$rc" -eq 0 ]; then
    STEP_NAMES+=("$name")
    STEP_RESULTS+=("pass")
    echo "pass" > "$status_file"
    echo "${GREEN}${CHECK} ${name} passed${NC}"
  else
    STEP_NAMES+=("$name")
    STEP_RESULTS+=("fail")
    echo "fail" > "$status_file"
    echo "${RED}${CROSS} ${name} failed${NC}"
    FAILED=1
  fi
}

skip_step() {
  local name="$1"
  local slug="$2"
  local reason="$3"
  STEP_NAMES+=("$name")
  STEP_RESULTS+=("skip")
  echo "skip" > "$LOG_DIR/${slug}.status"
  echo ""
  echo "${PURPLE}${BOLD}━━━ ${name} ━━━${NC}"
  echo "${YELLOW}${SKIP} skipped: ${reason}${NC}"
}

# ── Steps ────────────────────────────────────────────────────────────────
run_step "Build"      build      pnpm build
run_step "Lint"       lint       pnpm lint
run_step "Unit tests" unit-tests pnpm exec nx run-many -t test

if [ "$RUN_E2E" = "1" ]; then
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^showbook-dev-db$'; then
    skip_step "E2E (Playwright)" e2e "postgres container not running — run 'docker compose up -d db' first"
    FAILED=1
  else
    run_step "E2E (Playwright)" e2e pnpm test:e2e
  fi
else
  skip_step "E2E (Playwright)" e2e "pass --e2e or set RUN_E2E=1 to run"
fi

# ── Summary ──────────────────────────────────────────────────────────────
echo ""
echo "${BOLD}┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓${NC}"
echo "${BOLD}┃                  VERIFICATION SUMMARY                    ┃${NC}"
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
  echo "${RED}${BOLD}Some checks failed.${NC}"
  exit 1
else
  echo "${GREEN}${BOLD}All checks passed.${NC}"
  exit 0
fi
