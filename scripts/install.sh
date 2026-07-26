#!/bin/sh
# Cambrian installer — SOURCE mode. Clones the repos and builds the two binaries on the
# machine, then hands off to `cambrian init`. It does NOT set up Postgres/Python/models/config
# — that is init's job.
#
#   curl -fsSL https://cambrian.dev/install.sh | sh
#
# Why source and not GitHub releases: Cambrian is under active daily development and the
# release channel is empty. `git clone` + build is the only thing that yields a current
# binary, and re-running this script is the update path (fetch → reset → rebuild).
#
# Build inputs (must be on PATH): git, go (≥1.21 — it bootstraps the toolchain go.mod asks
# for), bun (≥1.3). Everything lands under ~/.cambrian; no sudo.
#
# Knobs:
#   CAMBRIAN_HOME       install prefix                    (default ~/.cambrian)
#   CAMBRIAN_SRC        checkout dir                      (default $CAMBRIAN_HOME/src)
#   CAMBRIAN_REF        branch/tag for every repo         (default: each repo's default branch)
#   CAMBRIAN_CLI_REF / CAMBRIAN_CORE_REF / CAMBRIAN_SDK_REF   per-repo override
#   CAMBRIAN_GIT_BASE   git host base                     (default https://github.com)
#   CAMBRIAN_FORCE=1    rebuild even when the checkouts did not move
#   CAMBRIAN_SKIP_INIT=1  install only; do not run `cambrian init`
#
# POSIX sh (no bashisms): runs under dash/ash on minimal systems.
set -eu

CLI_REPO="cambrian-sh/cli"
CORE_REPO="cambrian-sh/core"
SDK_REPO="cambrian-sh/agent-sdk-python"
GIT_BASE="${CAMBRIAN_GIT_BASE:-https://github.com}"

PREFIX="${CAMBRIAN_HOME:-$HOME/.cambrian}"
BIN_DIR="$PREFIX/bin"
SRC_DIR="${CAMBRIAN_SRC:-$PREFIX/src}"
CLI_DIR="$SRC_DIR/cli"
CORE_DIR="$SRC_DIR/core"
SDK_DIR="$SRC_DIR/sdk"
CONFIG="$PREFIX/config.json"
STAMP="$PREFIX/.build-stamp"
TELEMETRY_URL="https://telemetry.cambrian.dev/v1/install"

# --- pretty output (no color when not a tty) ---------------------------------------------
if [ -t 1 ]; then B="$(printf '\033[1m')"; G="$(printf '\033[32m')"; R="$(printf '\033[31m')"; Y="$(printf '\033[33m')"; Z="$(printf '\033[0m')"; else B=""; G=""; R=""; Y=""; Z=""; fi
say()  { printf '%s\n' "$*"; }
step() { printf '  %s… ' "$1"; }
ok()   { printf '%s✓%s\n' "$G" "$Z"; }
die()  { printf '\n%s✗ %s%s\n' "$R" "$*" "$Z" >&2; exit 1; }

say "${B}Cambrian${Z} installer  ·  building from source  ·  https://github.com/${CLI_REPO}"

# --- 1. platform --------------------------------------------------------------------------
uname_s="$(uname -s 2>/dev/null || echo unknown)"
uname_m="$(uname -m 2>/dev/null || echo unknown)"
case "$uname_s" in
  Darwin) OS="darwin" ;;
  Linux)  OS="linux" ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    die "On Windows, run:  powershell -ExecutionPolicy Bypass -c \"irm https://cambrian.dev/install.ps1 | iex\"" ;;
  *) die "Cambrian supports macOS, Linux, and Windows (install.ps1). '$uname_s' is not supported." ;;
esac
say "  platform: ${B}${OS}-${uname_m}${Z}  (source build)"

# --- 2. build toolchain -------------------------------------------------------------------
# Everything is built here, so the toolchain is a hard requirement — not a nicety.
need() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required to build Cambrian from source.
    $2"
}
need git "Install git, then re-run this script."
need go  "Install Go ≥1.21 from https://go.dev/dl (it auto-fetches the exact toolchain go.mod pins), then re-run."
need bun "Install Bun ≥1.3:  curl -fsSL https://bun.sh/install | bash    then re-run."
say "  toolchain: ${B}$(git --version | awk '{print $3}')${Z} git · ${B}$(go version | awk '{print $3}')${Z} · ${B}bun $(bun --version)${Z}"

# --- 3. sync a checkout (clone, or fetch+reset to the remote) ------------------------------
# Never destroys work: a dirty checkout aborts the install instead of being reset.
sync_repo() { # slug dir ref
  slug="$1"; dir="$2"; ref="$3"
  url="$GIT_BASE/$slug.git"
  if [ -d "$dir/.git" ]; then
    git -C "$dir" diff --quiet 2>/dev/null && git -C "$dir" diff --cached --quiet 2>/dev/null \
      || die "Uncommitted changes in $dir.
    This installer resets checkouts to the remote and will not discard your work.
    Commit/stash them, or point CAMBRIAN_SRC at a different directory."
    git -C "$dir" remote set-url origin "$url" 2>/dev/null || true
    if [ -n "$ref" ]; then
      git -C "$dir" fetch --depth 1 --tags origin "$ref" >/dev/null 2>&1 \
        || die "Could not fetch '$ref' from $url. Check the ref name and your network."
    else
      git -C "$dir" fetch --depth 1 origin HEAD >/dev/null 2>&1 \
        || die "Could not fetch $url. Check your network (or GitHub access if the repo is private)."
    fi
    git -C "$dir" reset --hard FETCH_HEAD >/dev/null 2>&1 || die "Could not update $dir."
  else
    [ -e "$dir" ] && die "$dir exists but is not a git checkout. Move it aside and re-run."
    mkdir -p "$(dirname "$dir")"
    if [ -n "$ref" ]; then
      git clone --depth 1 --branch "$ref" "$url" "$dir" >/dev/null 2>&1 \
        || die "Could not clone $url at '$ref'. Check the ref name and your network."
    else
      git clone --depth 1 "$url" "$dir" >/dev/null 2>&1 \
        || die "Could not clone $url. Check your network (or GitHub access if the repo is private)."
    fi
  fi
  git -C "$dir" rev-parse --short HEAD
}

say ""
say "${B}Sources${Z} → $SRC_DIR"
step "cli";  CLI_SHA="$(sync_repo  "$CLI_REPO"  "$CLI_DIR"  "${CAMBRIAN_CLI_REF:-${CAMBRIAN_REF:-}}")";  printf '%s ' "$CLI_SHA";  ok
step "core"; CORE_SHA="$(sync_repo "$CORE_REPO" "$CORE_DIR" "${CAMBRIAN_CORE_REF:-${CAMBRIAN_REF:-}}")"; printf '%s ' "$CORE_SHA"; ok
# The agent SDK is only needed by `cambrian init` (it pip-installs it into the venv). A
# failure here is not fatal — init falls back to the PyPI package.
step "sdk";  SDK_SHA="$(sync_repo  "$SDK_REPO"  "$SDK_DIR"  "${CAMBRIAN_SDK_REF:-${CAMBRIAN_REF:-}}" 2>/dev/null || true)"
if [ -n "${SDK_SHA:-}" ]; then printf '%s ' "$SDK_SHA"; ok; else printf '%sskipped (init will use PyPI)%s\n' "$Y" "$Z"; SDK_DIR=""; fi

# --- 4. idempotency: did anything actually move? -------------------------------------------
WANT="cli=$CLI_SHA core=$CORE_SHA"
if [ "${CAMBRIAN_FORCE:-0}" != "1" ] && [ -x "$BIN_DIR/cambrian" ] && [ -x "$BIN_DIR/cambrian-orchestrator" ] \
   && [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$WANT" ]; then
  say ""
  say "${G}Already up to date${Z} (${WANT}).  Re-run setup with ${B}cambrian init${Z}, or force a rebuild with ${B}CAMBRIAN_FORCE=1${Z}."
  exit 0
fi

TMP="$(mktemp -d 2>/dev/null || mktemp -d -t cambrian)"
trap 'rm -rf "$TMP"' EXIT INT TERM

# --- 5. build ------------------------------------------------------------------------------
say ""
say "${B}Build${Z}"

# Kernel: pure Go, no cgo. Version is stamped from the checkout so `--version` is traceable.
CORE_VER="$(git -C "$CORE_DIR" describe --tags --always 2>/dev/null || echo "$CORE_SHA")"
step "cambrian-orchestrator (go, ${CORE_VER})"
( cd "$CORE_DIR" && CGO_ENABLED=0 go build -trimpath \
    -ldflags "-s -w -X main.version=${CORE_VER}" \
    -o "$TMP/cambrian-orchestrator" ./cmd/orchestrator ) >"$TMP/go.log" 2>&1 \
  || { say ""; sed -n '1,20p' "$TMP/go.log" >&2; die "Go build failed (log above). Full log: $TMP/go.log"; }
ok

# CLI: bun deps → vendored protos → single-file executable.
step "cambrian (bun)"
(
  cd "$CLI_DIR"
  bun install --frozen-lockfile || bun install
  bun run scripts/embed-proto.ts
  bun run build:bin
) >"$TMP/bun.log" 2>&1 \
  || { say ""; sed -n '1,20p' "$TMP/bun.log" >&2; die "CLI build failed (log above). Full log: $TMP/bun.log"; }
# bun appends .exe on Windows only, but check both so the script stays honest.
CLI_BUILT=""
for c in "$CLI_DIR/dist/cambrian" "$CLI_DIR/dist/cambrian.exe"; do [ -f "$c" ] && CLI_BUILT="$c"; done
[ -n "$CLI_BUILT" ] || die "CLI build produced no binary in $CLI_DIR/dist. Log: $TMP/bun.log"
cp "$CLI_BUILT" "$TMP/cambrian"
ok

# --- 6. install to ~/.cambrian/bin (no sudo) -----------------------------------------------
mkdir -p "$BIN_DIR" 2>/dev/null || die "Cannot write to $BIN_DIR. Check disk space and permissions."
# Replace, don't overwrite in place: a running orchestrator holds its inode, not the name.
for b in cambrian cambrian-orchestrator; do
  rm -f "$BIN_DIR/$b" 2>/dev/null || true
  mv "$TMP/$b" "$BIN_DIR/$b" || die "Cannot write to $BIN_DIR. Check disk space and permissions."
  chmod +x "$BIN_DIR/$b"
done
step "installed to $BIN_DIR"; ok

# Reference config bundle: `cambrian init` reads configs/config.example.json + tuning.json
# from its working directory (we hand off with cwd=$PREFIX), and writes the real
# config.json next to them. Seeding the templates here is what makes the generated bundle
# complete rather than a bare stub.
mkdir -p "$PREFIX/configs"
cp "$CORE_DIR/configs/config.example.json" "$PREFIX/configs/config.example.json" 2>/dev/null || true
[ -f "$PREFIX/configs/tuning.json" ] || cp "$CORE_DIR/configs/tuning.json" "$PREFIX/configs/tuning.json" 2>/dev/null || true

# Where init should look for the moving parts that live in the source tree. Recorded so a
# later `cambrian init` run (outside this script) finds them too.
cat > "$PREFIX/source.env" <<EOF
# Written by install.sh — the source checkouts this installation was built from.
# Source this before running \`cambrian init\` by hand.
export CAMBRIAN_SRC="$SRC_DIR"
export CAMBRIAN_AGENTS_DIR="$CORE_DIR/agents"
export CAMBRIAN_SDK_DIR="$SDK_DIR"
export CAMBRIAN_COMPOSE="$CORE_DIR/db/docker-compose.yml"
EOF

printf '%s' "$WANT" > "$STAMP"

# --- 7. PATH update (idempotent) -----------------------------------------------------------
PATH_LINE="export PATH=\"$BIN_DIR:\$PATH\""
case "$OS" in darwin) RC="$HOME/.zshrc" ;; *) RC="$HOME/.bashrc" ;; esac
if [ -f "$RC" ] && grep -qs '.cambrian/bin' "$RC"; then :; else
  printf '\n# Cambrian\n%s\n' "$PATH_LINE" >> "$RC" 2>/dev/null || true
  say "  added to PATH in ${B}${RC}${Z} (restart your shell or: ${B}source ${RC}${Z})"
fi

# --- 8. verify the binaries run ------------------------------------------------------------
"$BIN_DIR/cambrian" --version >/dev/null 2>&1 || die "Built CLI does not run. Report at https://github.com/${CLI_REPO}/issues"
"$BIN_DIR/cambrian-orchestrator" --version >/dev/null 2>&1 || die "Built orchestrator does not run. Report at https://github.com/${CORE_REPO}/issues"

# --- 9. telemetry opt-in (reads /dev/tty; default OFF when non-interactive) -----------------
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
if [ "$telem" = "on" ] && command -v curl >/dev/null 2>&1; then
  curl -fsS -m 5 -X POST "$TELEMETRY_URL" -H 'Content-Type: application/json' \
    -d "{\"os\":\"$OS\",\"arch\":\"$uname_m\",\"version\":\"$CORE_VER\",\"source\":\"git\",\"result\":\"success\"}" >/dev/null 2>&1 || true
fi

say ""
say "${G}${B}Cambrian built and installed.${Z}  cli ${CLI_SHA} · core ${CORE_VER}"

# --- 10. hand off to `cambrian init` -------------------------------------------------------
# cwd=$PREFIX so init resolves ~/.cambrian/configs; the env vars point it at the checkouts
# for the agents, the Python SDK, and the Postgres compose file.
export CAMBRIAN_AGENTS_DIR="$CORE_DIR/agents"
export CAMBRIAN_COMPOSE="$CORE_DIR/db/docker-compose.yml"
[ -n "$SDK_DIR" ] && export CAMBRIAN_SDK_DIR="$SDK_DIR"
cd "$PREFIX"
if [ "${CAMBRIAN_SKIP_INIT:-0}" = "1" ]; then
  say "Run ${B}cambrian init${Z} to finish setup (Postgres, Python, models, config)."
elif [ -r /dev/tty ]; then
  say "Running first-time setup…"
  exec "$BIN_DIR/cambrian" init < /dev/tty
else
  say "Run ${B}cambrian init${Z} to finish setup (Postgres, Python, models, config)."
  say "  ${B}. $PREFIX/source.env${Z} first, so init finds the agents/SDK/compose in $SRC_DIR."
fi
