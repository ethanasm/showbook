#!/usr/bin/env bash
# Showbook verification: build + lint + unit tests, with optional e2e.
# Status of each step is reported at the end.
#
# Usage:
#   pnpm verify          # build, lint, unit tests
#   pnpm verify:e2e      # also run Playwright e2e
#   RUN_E2E=1 pnpm verify

set -o pipefail

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
  local name="$1"
  local reason="$2"
  STEP_NAMES+=("$name")
  STEP_RESULTS+=("skip")
  echo ""
  echo "${PURPLE}${BOLD}━━━ ${name} ━━━${NC}"
  echo "${YELLOW}${SKIP} skipped: ${reason}${NC}"
}

# ── Steps ────────────────────────────────────────────────────────────────
run_step "Build"      pnpm build
run_step "Lint"       pnpm lint
run_step "Unit tests" pnpm exec nx run-many -t test

if [ "$RUN_E2E" = "1" ]; then
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^showbook-postgres\|^showbook-dev-db'; then
    skip_step "E2E (Playwright)" "postgres container not running — run 'docker compose up -d postgres' first"
    FAILED=1
  else
    run_step "E2E (Playwright)" pnpm test:e2e
  fi
else
  skip_step "E2E (Playwright)" "pass --e2e or set RUN_E2E=1 to run"
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
