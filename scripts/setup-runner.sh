#!/usr/bin/env bash
set -euo pipefail

REPO="ethanasm/showbook"
PROD_DIR="${PROD_DIR:-/opt/showbook}"
RUNNER_DIR="${HOME}/.github-runners/showbook-prod"
RUNNER_NAME="$(hostname -s)-showbook"
RUNNER_LABELS="showbook-prod"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

info() { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn() { printf "${YELLOW}!${NC} %s\n" "$1"; }
fail() { printf "${RED}✗${NC} %s\n" "$1"; exit 1; }
step() { printf "\n${BOLD}%s${NC}\n" "$1"; }

# ── 1. Prerequisites ──────────────────────────────────────────────────
step "Checking prerequisites…"
for cmd in docker git pnpm gh; do
  command -v "$cmd" &>/dev/null || fail "$cmd is required but not found"
done
docker compose version &>/dev/null || fail "docker compose plugin is required"
gh auth status &>/dev/null || fail "gh is not authenticated — run 'gh auth login' first"
info "docker, git, pnpm, gh, docker compose"

# ── 2. Prod tree ──────────────────────────────────────────────────────
step "Setting up prod tree at ${PROD_DIR}…"
if [ -d "$PROD_DIR/.git" ]; then
  info "Already exists — skipping clone"
else
  REMOTE_URL=$(gh repo view "$REPO" --json url -q .url)
  if [ ! -d "$PROD_DIR" ]; then
    sudo mkdir -p "$PROD_DIR"
    sudo chown "$USER" "$PROD_DIR"
  fi
  git clone "$REMOTE_URL" "$PROD_DIR"
  cp "$PROD_DIR/apps/web/.env.example" "$PROD_DIR/.env.prod"
  info "Cloned and created .env.prod template"
  warn "You MUST edit ${PROD_DIR}/.env.prod with real secrets before deploying"
fi

# ── 3. Download runner ────────────────────────────────────────────────
step "Installing GitHub Actions runner…"
if [ -f "$RUNNER_DIR/.runner" ]; then
  info "Already configured at ${RUNNER_DIR} — skipping download"
else
  OS=$(uname -s | tr '[:upper:]' '[:lower:]')
  ARCH=$(uname -m)
  case "$OS" in
    darwin) RUNNER_OS="osx"   ;;
    linux)  RUNNER_OS="linux" ;;
    *)      fail "Unsupported OS: $OS" ;;
  esac
  case "$ARCH" in
    arm64|aarch64) RUNNER_ARCH="arm64" ;;
    x86_64)        RUNNER_ARCH="x64"   ;;
    *)             fail "Unsupported arch: $ARCH" ;;
  esac

  VERSION=$(gh api repos/actions/runner/releases/latest -q .tag_name | sed 's/^v//')
  TARBALL="actions-runner-${RUNNER_OS}-${RUNNER_ARCH}-${VERSION}.tar.gz"
  URL="https://github.com/actions/runner/releases/download/v${VERSION}/${TARBALL}"

  echo "  Downloading runner v${VERSION} (${RUNNER_OS}/${RUNNER_ARCH})…"
  mkdir -p "$RUNNER_DIR"
  curl -sL "$URL" | tar xz -C "$RUNNER_DIR"
  info "Extracted to ${RUNNER_DIR}"

  # Generate registration token
  REG_TOKEN=$(gh api "repos/${REPO}/actions/runners/registration-token" \
    --method POST -q .token)

  # Configure (--unattended skips interactive prompts)
  (cd "$RUNNER_DIR" && ./config.sh \
    --url "https://github.com/${REPO}" \
    --token "$REG_TOKEN" \
    --name "$RUNNER_NAME" \
    --labels "$RUNNER_LABELS" \
    --work _work \
    --unattended \
    --replace)
  info "Runner configured as '${RUNNER_NAME}'"
fi

# ── 4. Ensure tools are on the service PATH ───────────────────────────
# The launchd/systemd service inherits a minimal PATH. Write a .env file
# so the runner process can find docker, pnpm, git, and node.
TOOL_PATHS=""
for cmd in pnpm docker git node; do
  dir=$(dirname "$(command -v "$cmd")")
  case ":${TOOL_PATHS}:" in
    *":${dir}:"*) ;;
    *) TOOL_PATHS="${TOOL_PATHS:+${TOOL_PATHS}:}${dir}" ;;
  esac
done
echo "PATH=${TOOL_PATHS}:/usr/local/bin:/usr/bin:/bin" > "$RUNNER_DIR/.env"
info "Wrote .env with tool paths for the service"

# ── 5. Install + start service ────────────────────────────────────────
# macOS uses user-level launchd (no sudo). Linux uses systemd (needs sudo).
step "Starting runner service…"
cd "$RUNNER_DIR"
if [ "$(uname -s)" = "Darwin" ]; then
  SVC="./svc.sh"
else
  SVC="sudo ./svc.sh"
fi
if $SVC status 2>/dev/null | grep -qi "active\|running\|started"; then
  info "Service is already running"
else
  $SVC install 2>/dev/null || true
  $SVC start
  info "Service installed and started"
fi

# ── 6. Summary ────────────────────────────────────────────────────────
printf "\n${BOLD}══════════════════════════════════════${NC}\n"
printf "${BOLD}  Self-hosted runner is ready${NC}\n"
printf "${BOLD}══════════════════════════════════════${NC}\n\n"
printf "  Runner dir:  %s\n" "$RUNNER_DIR"
printf "  Prod tree:   %s\n" "$PROD_DIR"
printf "  Labels:      self-hosted, %s\n" "$RUNNER_LABELS"
printf "\n  Next steps:\n"
printf "    1. Edit %s/.env.prod with real secrets\n" "$PROD_DIR"
printf "    2. Push to main → CI passes → auto-deploy\n"
printf "\n  Manual deploy:\n"
printf "    Actions → Deploy (prod) → Run workflow\n\n"
