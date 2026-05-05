#!/usr/bin/env bash
# Idempotent one-time setup for Android e2e on the self-hosted runner.
#
# Run this on the prod box AFTER scripts/setup-runner.sh has the runner
# itself online. It installs Android command-line tools + the platform
# packages Maestro needs (platform-tools, emulator, a single system
# image) and creates the AVD `.github/workflows/mobile-e2e.yml` looks
# for.
#
# Re-running is safe — every step checks for the artifact it would
# create and skips if present.

set -euo pipefail

ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-/opt/android-sdk}"
CMDLINE_TOOLS_VERSION="${CMDLINE_TOOLS_VERSION:-13114758}" # latest as of 2026-05
SYSTEM_IMAGE="${SYSTEM_IMAGE:-system-images;android-34;google_apis;x86_64}"
PLATFORM="${PLATFORM:-platforms;android-34}"
AVD_NAME="${AVD_NAME:-showbook_e2e}"

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
for cmd in curl unzip java; do
  command -v "$cmd" &>/dev/null || fail "$cmd is required but not found"
done
# Java 17 is what AGP 8.x and the latest cmdline-tools want.
JAVA_MAJOR=$(java -version 2>&1 | awk -F'"' '/version/ {split($2, a, "."); print (a[1]=="1") ? a[2] : a[1]}')
if [ "$JAVA_MAJOR" -lt 17 ]; then
  fail "Java 17+ required (found $JAVA_MAJOR). On Ubuntu: sudo apt-get install -y openjdk-17-jdk"
fi
info "java $JAVA_MAJOR, curl, unzip"

# ── 2. cmdline-tools ──────────────────────────────────────────────────
step "Installing Android cmdline-tools at ${ANDROID_SDK_ROOT}…"
CMDLINE_BIN="$ANDROID_SDK_ROOT/cmdline-tools/latest/bin"
if [ -x "$CMDLINE_BIN/sdkmanager" ]; then
  info "cmdline-tools already present"
else
  if [ ! -d "$ANDROID_SDK_ROOT" ]; then
    sudo mkdir -p "$ANDROID_SDK_ROOT"
    sudo chown "$USER" "$ANDROID_SDK_ROOT"
  fi
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT
  ZIP="$TMP/cmdline-tools.zip"
  URL="https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS_VERSION}_latest.zip"
  echo "  Downloading $URL"
  curl -sSL -o "$ZIP" "$URL"
  unzip -q "$ZIP" -d "$TMP"
  mkdir -p "$ANDROID_SDK_ROOT/cmdline-tools"
  # The zip extracts to ./cmdline-tools/; sdkmanager wants it nested
  # under cmdline-tools/latest/.
  rm -rf "$ANDROID_SDK_ROOT/cmdline-tools/latest"
  mv "$TMP/cmdline-tools" "$ANDROID_SDK_ROOT/cmdline-tools/latest"
  info "Installed to $ANDROID_SDK_ROOT/cmdline-tools/latest"
fi

export ANDROID_SDK_ROOT
export PATH="$CMDLINE_BIN:$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/emulator:$PATH"

# ── 3. SDK packages ───────────────────────────────────────────────────
step "Installing SDK packages (platform-tools, emulator, $PLATFORM, $SYSTEM_IMAGE)…"
yes | sdkmanager --licenses >/dev/null
sdkmanager --install \
  "platform-tools" \
  "emulator" \
  "$PLATFORM" \
  "$SYSTEM_IMAGE" >/dev/null
info "SDK packages installed"

# ── 4. AVD ────────────────────────────────────────────────────────────
step "Creating AVD '$AVD_NAME'…"
if avdmanager list avd 2>/dev/null | grep -q "Name: ${AVD_NAME}\$"; then
  info "AVD already exists"
else
  echo "no" | avdmanager create avd \
    --name "$AVD_NAME" \
    --package "$SYSTEM_IMAGE" \
    --device "pixel_6" \
    --force
  # Lower memory + bigger SD card so Metro doesn't OOM the AVD on
  # first launch. Override by editing ~/.android/avd/$AVD_NAME.avd/config.ini.
  CFG="$HOME/.android/avd/${AVD_NAME}.avd/config.ini"
  if [ -f "$CFG" ]; then
    {
      echo "hw.ramSize=2048"
      echo "vm.heapSize=512"
      echo "disk.dataPartition.size=4096M"
      echo "hw.gpu.enabled=yes"
      echo "hw.gpu.mode=swiftshader_indirect"
    } >> "$CFG"
  fi
  info "AVD '$AVD_NAME' created (Pixel 6, $SYSTEM_IMAGE)"
fi

# ── 5. KVM check (WSL2) ──────────────────────────────────────────────
step "Checking KVM acceleration…"
if [ -e /dev/kvm ] && [ -r /dev/kvm ] && [ -w /dev/kvm ]; then
  info "/dev/kvm is accessible — emulator boots will be hardware-accelerated"
else
  warn "/dev/kvm not accessible. Emulator will fall back to software rendering and"
  warn "boots may take 5+ minutes per run. On WSL2, enable nestedVirtualization=true"
  warn "in %UserProfile%\\.wslconfig and 'sudo usermod -aG kvm \$USER' (then log out / in)."
fi

# ── 6. Maestro ────────────────────────────────────────────────────────
step "Installing Maestro CLI (idempotent)…"
if command -v maestro >/dev/null 2>&1; then
  info "Maestro already on PATH ($(maestro --version 2>&1 | head -1))"
else
  curl -fsSL "https://get.maestro.mobile.dev" | bash
  info "Maestro installed at \$HOME/.maestro"
  warn "Add 'export PATH=\"\$HOME/.maestro/bin:\$PATH\"' to your shell rc"
fi

# ── 7. Summary ────────────────────────────────────────────────────────
printf "\n${BOLD}══════════════════════════════════════${NC}\n"
printf "${BOLD}  Android e2e tooling ready${NC}\n"
printf "${BOLD}══════════════════════════════════════${NC}\n\n"
printf "  SDK:    %s\n" "$ANDROID_SDK_ROOT"
printf "  AVD:    %s\n" "$AVD_NAME"
printf "  System: %s\n" "$SYSTEM_IMAGE"
printf "\n  Verify:\n"
printf "    \$ %s/emulator/emulator -list-avds\n" "$ANDROID_SDK_ROOT"
printf "\n  Repo variable to set (Settings → Variables):\n"
printf "    ANDROID_SDK_ROOT = %s\n" "$ANDROID_SDK_ROOT"
printf "    MOBILE_E2E_ENABLED = true (once secrets are in place)\n\n"
