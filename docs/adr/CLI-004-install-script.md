# CLI-004 — Install Script Design

**Date:** 2026-06-25
**Amended:** 2026-07-13 — repo URLs updated to `cambrian-sh` org; telemetry prompt reads `/dev/tty` (piped-stdin fix); version lookup switched to release-redirect; manual-install arch mapping corrected; Windows `install.ps1` pulled into V1; `cambrian init` scope extended to the Python/agent/model runtime
**Status:** Accepted (D7, D8, D9, D10, D11 locked in `docs/plans/cli-initiative.md` Part 0; amended 2026-07-13)
**Author:** CLI initiative
**Depends on:** CLI-003 (distribution — the script downloads from GitHub Releases)
**Relates to:** CLI-005 (onboarding wizard — what runs after the script), CLI-006 (service management)

---

## Context

The install script is the **first surface a new user touches**. It runs from a `curl | sh` on a clean machine. It is responsible for one thing and one thing only: **getting the Cambrian binaries on the machine and handing off to `cambrian init`**.

The user's first impression is determined by this script. If it fails silently, prints a stack trace, or asks 10 questions before doing anything, the project loses the user. If it works in under 30 seconds and prints a green checkmark, the user is committed.

D7 locks the split: the `curl | sh` script does the **minimum** — install the CLI and orchestrator binaries to `~/.cambrian/bin/`, update `PATH`. Everything else (Postgres, pgvector, Python, DB migrations, config, service registration, first start) is `cambrian init`'s job.

---

## Decision

### The one-liner (the website command)

```bash
# macOS / Linux
curl -fsSL https://cambrian.dev/install.sh | sh
```

```powershell
# Windows (V1, per the 2026-07-13 D5 amendment in CLI-003)
powershell -ExecutionPolicy Bypass -c "irm https://cambrian.dev/install.ps1 | iex"
```

The two scripts share the same asset-naming contract and step order; `install.ps1` installs to `%USERPROFILE%\.cambrian\bin` and updates the user-level `PATH` via the registry (no admin elevation).

### The install script's responsibilities (D7)

The script is **~80 lines of bash**. It does these things, in order, with a spinner and a plain-English status line for each:

1. **Welcome** — print the Cambrian banner (1 line of ASCII), version, GitHub link.
2. **Platform detection** — `uname -sm`, then **normalize the arch**: `x86_64` → `x64`, `aarch64`/`arm64` → `arm64`, `Darwin`/`Linux` lowercased — asset names use `x64`/`arm64`, never raw `uname` output. Map to `darwin-arm64` / `darwin-x64` / `linux-x64` / `linux-arm64`. If unsupported (BSD, musl, 32-bit), print "Cambrian supports macOS, Linux (glibc), and Windows (via install.ps1). See the roadmap for musl." and exit 1. (Windows users landing in the bash script — e.g. Git Bash — are pointed at the `install.ps1` one-liner.)
3. **Architecture validation** — confirm 64-bit (we don't ship 32-bit). Refuse musl libc on Linux for V1 (V1.1 will ship `cambrian-linux-x64-musl`).
4. **Latest version lookup** — no API call, no JSON scraping: download directly via the stable redirect `https://github.com/cambrian-sh/cli/releases/latest/download/<asset>` (the tag, when needed for display, comes from the redirect's final URL). This avoids API rate limits and brittle `grep tag_name` parsing. If GitHub is unreachable, print "Could not reach GitHub. Check your network or install manually: https://cambrian.dev/manual-install" and exit 1.
5. **Download CLI binary** — `cambrian-{os}-{arch}` from the `cambrian-sh/cli` release. Stream to a temp file with progress (binaries are ~50–100 MB — Bun runtime embedded — so progress display matters).
6. **Download orchestrator binary** — `cambrian-orchestrator-{os}-{arch}` from the kernel repo's release (`github.com/cambrian-sh/core/releases`, version pinned in the CLI release notes). Same progress pattern.
7. **Verify checksums** — both against each repo's `SHA256SUMS`. If mismatch, print "Binary integrity check failed. Refusing to install. Possible cause: incomplete download or compromised release. Try again or report at https://github.com/cambrian-sh/cli/issues" and exit 1.
8. **Install to `~/.cambrian/bin/`** — `mkdir -p`, `mv` the two binaries. No `sudo` required (D6: user-level install).
9. **Update `PATH`** — append `export PATH="$HOME/.cambrian/bin:$PATH"` to `~/.zshrc` (macOS default) or `~/.bashrc` (Linux default) if not already present. Idempotent — checks for the line first.
10. **Verify install** — `~/.cambrian/bin/cambrian --version` should print `cambrian <version>`. If it doesn't, the binary is broken; print a clear error.
11. **Telemetry opt-in (D9)** — print "Help us improve Cambrian by sending anonymous install metrics (OS, version, success/fail). No PII. [Y/n]:". **The prompt must read from `/dev/tty`, not stdin** — under `curl | sh`, stdin *is* the script, so a plain `read` consumes script text or hits EOF. If `/dev/tty` is unavailable (CI, containers, no terminal), skip the prompt and default to **off**. If yes, write `telemetry_enabled: true` to `~/.cambrian/config.json`. The CLI then sends a single `POST` to `https://telemetry.cambrian.dev/v1/install` with `{os, arch, version, result: "success"}`. `CAMBRIAN_TELEMETRY=0` env var pre-empts the prompt with "off".
12. **Hand off to `cambrian init` (D8)** — print "Cambrian installed. Running first-time setup..." and `exec ~/.cambrian/bin/cambrian < /dev/tty` (no args) — the stdin re-attach matters for the same reason as step 11: the wizard is an interactive TUI and the pipe is exhausted. If there is no TTY, skip the handoff and print "Run `cambrian` to finish setup." The CLI detects "no config + no keychain + first run" and runs the full stack setup wizard (CLI-005).

### The install script's non-responsibilities (D7)

The install script **does not**:
- Install Postgres or pgvector.
- Create the `cambrian` database.
- Run DB migrations.
- Generate `config.json`.
- Register a service.
- Start the orchestrator.
- Prompt for LLM API keys.
- Build the Python agent runtime (venv, per-agent `requirements.txt`, SDK install).
- Download models (Ollama embedder pull, HuggingFace pre-fetch for the reranker cross-encoder and docling models).

All of that is `cambrian init`'s job. The split is intentional: the `curl | sh` step is "get the tools." The `cambrian init` step is "set up the world." Users who already have Postgres can skip the install step; users who want a manual install can do it without the script.

> **Scope note for CLI-005 (added 2026-07-13):** the original wizard scope
> (Postgres, migrations, config, service) is incomplete for a working kernel.
> `cambrian init` must additionally own: **(a)** Python ≥3.11 detection and venv
> creation, **(b)** installing the agent SDK and each system agent's pinned
> `requirements.txt`, with a per-agent import self-check that names exactly which
> agent is missing what, **(c)** `ollama pull` of the configured embedder model,
> **(d)** HuggingFace pre-fetch of the reranker/docling models so the first query
> isn't a multi-GB download. The full step order lives in the kernel repo's
> `docs/reports/distribution-production-readiness.md` §4.3. Every step is
> check-then-do, so re-running `cambrian init` repairs a broken setup.

### Idempotency

Running the script twice is safe:
- If `~/.cambrian/bin/cambrian` already exists, compare versions. If installed version ≥ latest, print "Cambrian is up to date (vX.Y.Z)." and exit 0. If newer version available, replace.
- If the orchestrator binary already exists, same comparison.
- `PATH` line in shell rc is checked before appending (no duplicates).
- Telemetry opt-in prompt is skipped if `~/.cambrian/config.json` already has `telemetry_enabled` set.

### Rollback

The script does not modify the system outside `~/.cambrian/` and the user's shell rc. Uninstall is:
```bash
rm -rf ~/.cambrian
# Remove the PATH line from ~/.zshrc / ~/.bashrc (manual, or `cambrian uninstall` in V1.1)
```

`cambrian uninstall` (Phase 7) handles the full cleanup including the DB and the service.

### Failure modes and messages

| Failure | Message |
|---|---|
| Unsupported OS | "Cambrian supports macOS, Linux (glibc), and Windows (install.ps1). musl/BSD are on the roadmap." |
| Windows user in the bash script | "On Windows, run: powershell -ExecutionPolicy Bypass -c \"irm https://cambrian.dev/install.ps1 \| iex\"" |
| GitHub unreachable | "Could not reach GitHub. Check your network or install manually: https://cambrian.dev/manual-install" |
| Checksum mismatch | "Binary integrity check failed. Refusing to install. Possible cause: incomplete download or compromised release. Try again or report at https://github.com/cambrian-sh/cli/issues" |
| Permission denied (writing to `~/.cambrian/bin/`) | "Cannot write to ~/.cambrian/bin. Check disk space and permissions." |
| Binary doesn't run | "Downloaded binary is not executable. Report at https://github.com/cambrian-sh/cli/issues" |
| No TTY (piped, CI) | Telemetry defaults to off; setup handoff skipped with "Run `cambrian` to finish setup." |
| User Ctrl-C | Exit immediately, no cleanup needed (nothing was modified yet) |

**No stack traces. No log dumps. Always a single `cambrian doctor` command to diagnose.**

### Manual install (for users who can't run `curl | sh`)

Documented in the README and at `cambrian.dev/manual-install`:

```bash
# 1. Determine your platform string (assets use x64/arm64, NOT raw uname output)
PLATFORM="$(uname -s | tr A-Z a-z)-$(uname -m | sed -e 's/x86_64/x64/' -e 's/aarch64/arm64/')"
# → darwin-arm64 | darwin-x64 | linux-x64 | linux-arm64

# 2. Download from GitHub Releases (CLI from cambrian-sh/cli, orchestrator from cambrian-sh/core)
curl -fsSL "https://github.com/cambrian-sh/cli/releases/latest/download/cambrian-${PLATFORM}" -o cambrian
curl -fsSL "https://github.com/cambrian-sh/core/releases/latest/download/cambrian-orchestrator-${PLATFORM}" -o cambrian-orchestrator

# 3. Verify checksums (each binary against its own repo's SHA256SUMS)
curl -fsSL "https://github.com/cambrian-sh/cli/releases/latest/download/SHA256SUMS"  | grep "$PLATFORM"
curl -fsSL "https://github.com/cambrian-sh/core/releases/latest/download/SHA256SUMS" | grep "$PLATFORM"
shasum -a 256 cambrian cambrian-orchestrator  # must match

# 4. Install
mkdir -p ~/.cambrian/bin
mv cambrian cambrian-orchestrator ~/.cambrian/bin/
chmod +x ~/.cambrian/bin/cambrian ~/.cambrian/bin/cambrian-orchestrator

# 5. Add to PATH (shell-specific)
echo 'export PATH="$HOME/.cambrian/bin:$PATH"' >> ~/.zshrc  # or ~/.bashrc

# 6. Run
cambrian init
```

---

## Options considered

| Option | What | Why rejected |
|---|---|---|
| **A. curl|sh + cambrian init split (chosen)** | `curl|sh` installs binaries only. `cambrian init` (auto-triggered) does everything else. | Clean separation. Script is ~80 lines and easy to audit. `cambrian init` is testable, debuggable, can be re-run. Users with custom setups can skip the script. |
| **B. curl|sh does everything** | Single script installs Postgres, creates DB, runs migrations, registers service, starts orchestrator. | Script becomes 500+ lines. Hard to debug when something fails mid-way. No way to re-run only the steps that failed. Users with existing Postgres are forced through detection logic that may miss. |
| **C. curl|sh installs only the CLI; orchestrator downloaded at first start** | Two downloads, deferred to first use. | First `cambrian` invocation is slow. No way to pre-flight the install. |

---

## Consequences

### Positive

- **Audit-friendly.** The install script is ~80 lines of bash. Anyone can read it before piping to `sh`. No surprises.
- **Idempotent.** Running twice is safe. The script detects "already installed" and either upgrades or exits.
- **Fast.** The script does only I/O (downloads, file moves). Total wall time: ~10–20 seconds on a typical connection.
- **No surprise sudo.** Everything happens in `~/.cambrian/`. The user is not asked for `sudo` at any point during the install. Service registration in `cambrian init` may need `sudo` for system-level service managers; user-level systemd / launchd is the default.
- **Telemetry is opt-in, not opt-out.** The first-run experience asks. The `CAMBRIAN_TELEMETRY=0` env var pre-empts the prompt with a clear "off" (no nag).
- **Failure messages are actionable.** Every error path prints the next step. No "Error: undefined" or stack traces.

### Negative

- **Two binaries, not one.** The user has `cambrian` and `cambrian-orchestrator` in `~/.cambrian/bin/`. This is internal — the user never invokes the orchestrator directly. But `ls ~/.cambrian/bin/` shows two files. The README explains.
- **GitHub Releases is the only distribution point.** Outage = install outage. V1.1 adds mirrors.
- **No signature verification.** Checksums only. Cosign is V1.1.
- **Telemetry endpoint must exist.** `telemetry.cambrian.dev/v1/install` is a new piece of infrastructure. Either a Cloudflare Worker or a tiny `telemetry` Go service. Tracked as a separate ticket (Phase 2).

### Neutral

- The install script lives at `cambrian.dev/install.sh` (hosted statically, e.g., on the website's CDN). It's the same script that's in the repo at `cli/scripts/install.sh` (or `scripts/install.sh` once the repo is restructured). The website just serves it.
- The script is rewritten to be re-runnable; `cambrian update` is a separate code path that uses the same download + verify logic.

---

## Acceptance criteria

- [ ] `cambrian.dev/install.sh` and `cambrian.dev/install.ps1` serve the scripts.
- [ ] `cli/scripts/install.sh` and `cli/scripts/install.ps1` exist in the repo (mirrors of the hosted versions).
- [ ] Script handles: platform detection (with `x86_64→x64` / `aarch64→arm64` normalization), release-redirect download (no API/JSON parsing), CLI + orchestrator download from `cambrian-sh/cli` and `cambrian-sh/core`, checksum verification, install to `~/.cambrian/bin/`, `PATH` update, telemetry opt-in, handoff to `cambrian init`.
- [ ] All interactive reads use `/dev/tty`; under `curl | sh` with no TTY, telemetry defaults to off and the handoff is skipped with a printed next step (tested both ways).
- [ ] Script is idempotent: re-running on a fresh install upgrades; re-running on an up-to-date install exits 0 with a message.
- [ ] All failure modes print actionable messages; no stack traces.
- [ ] Manual install documented in README and at `cambrian.dev/manual-install`.
- [ ] Telemetry opt-in is the default; `CAMBRIAN_TELEMETRY=0` pre-empts.
- [ ] Telemetry endpoint exists and accepts the `POST`.
- [ ] `cambrian update` works as described in CLI-003 (re-uses the download + verify logic).
- [ ] 42 existing smoke tests pass; new tests cover: platform detection matrix, checksum verification (positive + negative), idempotency.
- [ ] `tsc --noEmit` clean.

---

## Follow-on ADRs

- **CLI-005** — Onboarding Wizard: the `cambrian init` flow that runs after the install script.
- **CLI-006** — Orchestrator Lifecycle: the `cambrian start|stop|restart|status|logs` subcommands.
