#!/bin/sh
# Cambrian installer — CLI-004 (D7). Gets the two binaries onto the machine and hands off
# to `cambrian init`. It does NOT set up Postgres/Python/models/config — that is init's job.
#
#   curl -fsSL https://cambrian.dev/install.sh | sh
#
# POSIX sh (no bashisms): runs under dash/ash on minimal systems. ~140 lines with all the
# actionable error paths. Modifies only ~/.cambrian and the user's shell rc; no sudo.
set -eu

CLI_REPO="cambrian-sh/cli"
CORE_REPO="cambrian-sh/core"
PREFIX="${CAMBRIAN_HOME:-$HOME/.cambrian}"
BIN_DIR="$PREFIX/bin"
CONFIG="$PREFIX/config.json"
TELEMETRY_URL="https://telemetry.cambrian.dev/v1/install"

# --- pretty output (no color when not a tty) ---------------------------------------------
if [ -t 1 ]; then B="$(printf '\033[1m')"; G="$(printf '\033[32m')"; R="$(printf '\033[31m')"; Y="$(printf '\033[33m')"; Z="$(printf '\033[0m')"; else B=""; G=""; R=""; Y=""; Z=""; fi
say()  { printf '%s\n' "$*"; }
step() { printf '  %s…%s ' "$1" ""; }
ok()   { printf '%s✓%s\n' "$G" "$Z"; }
die()  { printf '\n%s✗ %s%s\n' "$R" "$*" "$Z" >&2; exit 1; }

say "${B}Cambrian${Z} installer  ·  https://github.com/${CLI_REPO}"

# --- 1. platform detection + arch normalization (assets use x64/arm64) --------------------
uname_s="$(uname -s 2>/dev/null || echo unknown)"
uname_m="$(uname -m 2>/dev/null || echo unknown)"
case "$uname_s" in
  Darwin) OS="darwin" ;;
  Linux)  OS="linux" ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    die "On Windows, run:  powershell -ExecutionPolicy Bypass -c \"irm https://cambrian.dev/install.ps1 | iex\"" ;;
  *) die "Cambrian supports macOS, Linux (glibc), and Windows (install.ps1). musl/BSD are on the roadmap." ;;
esac
case "$uname_m" in
  x86_64|amd64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) die "Unsupported architecture '$uname_m'. Cambrian ships x64 and arm64 (64-bit) only." ;;
esac
# Refuse musl on Linux for V1 (glibc-only build).
if [ "$OS" = "linux" ] && ldd --version 2>&1 | grep -qi musl; then
  die "Cambrian supports macOS, Linux (glibc), and Windows (install.ps1). musl/BSD are on the roadmap."
fi
PLATFORM="${OS}-${ARCH}"
say "  platform: ${B}${PLATFORM}${Z}"

command -v curl >/dev/null 2>&1 || die "curl is required. Install curl and re-run."

# --- helpers: release-redirect download (no API, no JSON parsing) --------------------------
asset_url() { printf 'https://github.com/%s/releases/latest/download/%s' "$1" "$2"; }
# Resolve the latest tag from the redirect target of releases/latest (for display + idempotency).
latest_tag() {
  curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$1/releases/latest" 2>/dev/null \
    | sed -n 's#.*/tag/##p' | tr -d '\r\n'
}
LATEST="$(latest_tag "$CLI_REPO" || true)"
[ -n "$LATEST" ] || die "Could not reach GitHub. Check your network or install manually: https://cambrian.dev/manual-install"
say "  latest:   ${B}${LATEST}${Z}"

# --- idempotency: already installed and up to date? ---------------------------------------
if [ -x "$BIN_DIR/cambrian" ]; then
  CUR="$("$BIN_DIR/cambrian" --version 2>/dev/null | awk '{print $NF}' || true)"
  if [ -n "$CUR" ] && [ "$CUR" = "${LATEST#v}" -o "v$CUR" = "$LATEST" ]; then
    say "${G}Cambrian is up to date (${LATEST}).${Z}"
    exit 0
  fi
  say "  ${Y}upgrading ${CUR:-?} → ${LATEST}${Z}"
fi

TMP="$(mktemp -d 2>/dev/null || mktemp -d -t cambrian)"
trap 'rm -rf "$TMP"' EXIT INT TERM

# --- download + checksum-verify one asset from a repo -------------------------------------
fetch_verified() {
  repo="$1"; asset="$2"; out="$3"
  curl -fSL --progress-bar "$(asset_url "$repo" "$asset")" -o "$out" \
    || die "Could not reach GitHub. Check your network or install manually: https://cambrian.dev/manual-install"
  sums="$TMP/$(basename "$repo").SHA256SUMS"
  curl -fsSL "$(asset_url "$repo" "SHA256SUMS")" -o "$sums" \
    || die "Could not download SHA256SUMS for ${repo}. Try again or install manually: https://cambrian.dev/manual-install"
  expected="$(grep " ${asset}\$" "$sums" 2>/dev/null | awk '{print $1}' | head -n1)"
  [ -n "$expected" ] || die "No checksum for ${asset} in ${repo} SHA256SUMS. Refusing to install."
  if command -v shasum >/dev/null 2>&1; then actual="$(shasum -a 256 "$out" | awk '{print $1}')"
  elif command -v sha256sum >/dev/null 2>&1; then actual="$(sha256sum "$out" | awk '{print $1}')"
  else die "Need shasum or sha256sum to verify integrity. Install coreutils and re-run."; fi
  [ "$expected" = "$actual" ] || die "Binary integrity check failed. Refusing to install. Possible cause: incomplete download or compromised release. Try again or report at https://github.com/${CLI_REPO}/issues"
}

say ""
step "Downloading cambrian (${PLATFORM})"; ok
fetch_verified "$CLI_REPO"  "cambrian-${PLATFORM}"              "$TMP/cambrian"
step "Downloading cambrian-orchestrator (${PLATFORM})"; ok
fetch_verified "$CORE_REPO" "cambrian-orchestrator-${PLATFORM}" "$TMP/cambrian-orchestrator"

# --- install to ~/.cambrian/bin (no sudo) -------------------------------------------------
mkdir -p "$BIN_DIR" 2>/dev/null || die "Cannot write to $BIN_DIR. Check disk space and permissions."
mv "$TMP/cambrian" "$TMP/cambrian-orchestrator" "$BIN_DIR/" || die "Cannot write to $BIN_DIR. Check disk space and permissions."
chmod +x "$BIN_DIR/cambrian" "$BIN_DIR/cambrian-orchestrator"
step "Installed to $BIN_DIR"; ok

# --- PATH update (idempotent) -------------------------------------------------------------
PATH_LINE="export PATH=\"\$HOME/.cambrian/bin:\$PATH\""
case "$OS" in darwin) RC="$HOME/.zshrc" ;; *) RC="$HOME/.bashrc" ;; esac
if [ -f "$RC" ] && grep -qs '.cambrian/bin' "$RC"; then :; else
  printf '\n# Cambrian\n%s\n' "$PATH_LINE" >> "$RC" 2>/dev/null || true
  say "  added to PATH in ${B}${RC}${Z} (restart your shell or: ${B}source ${RC}${Z})"
fi

# --- verify the binary runs ---------------------------------------------------------------
"$BIN_DIR/cambrian" --version >/dev/null 2>&1 || die "Downloaded binary is not executable. Report at https://github.com/${CLI_REPO}/issues"

# --- telemetry opt-in (reads /dev/tty; default OFF when non-interactive) ------------------
telem="off"
if [ "${CAMBRIAN_TELEMETRY:-}" = "0" ]; then telem="off"
elif grep -qs 'telemetry_enabled' "$CONFIG" 2>/dev/null; then telem="kept"
elif [ -r /dev/tty ]; then
  printf 'Help us improve Cambrian by sending anonymous install metrics (OS, version, success/fail). No PII. [Y/n]: ' > /dev/tty
  read ans < /dev/tty 2>/dev/null || ans="n"
  case "$ans" in [Nn]*) telem="off" ;; *) telem="on" ;; esac
fi
if [ "$telem" = "on" ] || [ "$telem" = "off" ]; then
  mkdir -p "$PREFIX"
  printf '{"telemetry_enabled": %s}\n' "$( [ "$telem" = on ] && echo true || echo false )" > "$CONFIG" 2>/dev/null || true
fi
if [ "$telem" = "on" ]; then
  curl -fsS -m 5 -X POST "$TELEMETRY_URL" -H 'Content-Type: application/json' \
    -d "{\"os\":\"$OS\",\"arch\":\"$ARCH\",\"version\":\"$LATEST\",\"result\":\"success\"}" >/dev/null 2>&1 || true
fi

say ""
say "${G}${B}Cambrian ${LATEST} installed.${Z}"

# --- hand off to `cambrian init` (re-attach the TTY; skip when piped/CI) -------------------
if [ -r /dev/tty ]; then
  say "Running first-time setup…"
  exec "$BIN_DIR/cambrian" init < /dev/tty
else
  say "Run ${B}cambrian init${Z} to finish setup (Postgres, Python, models, config)."
fi
