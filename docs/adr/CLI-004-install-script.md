# CLI-004 — Install Script Design

**Date:** 2026-06-25
**Status:** Accepted (D7, D8, D9, D10, D11 locked in `docs/plans/cli-initiative.md` Part 0)
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

There is no Windows version in V1 (D5). The README points to `cambrian update` and the V1.1 follow-up.

### The install script's responsibilities (D7)

The script is **~80 lines of bash**. It does these things, in order, with a spinner and a plain-English status line for each:

1. **Welcome** — print the Cambrian banner (1 line of ASCII), version, GitHub link.
2. **Platform detection** — `uname -sm`. Map to `darwin-arm64` / `darwin-x64` / `linux-x64` / `linux-arm64`. If unsupported (Windows, BSD, musl), print "V1 supports macOS + Linux. See V1.1 roadmap for Windows." and exit 1.
3. **Architecture validation** — confirm 64-bit (we don't ship 32-bit). Refuse musl libc on Linux for V1 (V1.1 will ship `cambrian-linux-x64-musl`).
4. **Latest version lookup** — `curl -fsSL https://api.github.com/repos/cambrian/cambrian-runtime/releases/latest | grep tag_name`. If GitHub is unreachable, print "Could not reach GitHub. Check your network or install manually: https://cambrian.dev/manual-install" and exit 1.
5. **Download CLI binary** — `cambrian-{os}-{arch}` from the release. Stream to a temp file. Print `[#              ] 1.2 MB / 9.8 MB` progress.
6. **Download orchestrator binary** — `cambrian-orchestrator-{os}-{arch}` from the orchestrator's release (different repo, linked from the CLI release notes). Same progress pattern.
7. **Verify checksums** — both against `SHA256SUMS` from the release. If mismatch, print "Binary integrity check failed. Refusing to install. Possible cause: incomplete download or compromised release. Try again or report at https://github.com/cambrian/cambrian-runtime/issues" and exit 1.
8. **Install to `~/.cambrian/bin/`** — `mkdir -p`, `mv` the two binaries. No `sudo` required (D6: user-level install).
9. **Update `PATH`** — append `export PATH="$HOME/.cambrian/bin:$PATH"` to `~/.zshrc` (macOS default) or `~/.bashrc` (Linux default) if not already present. Idempotent — checks for the line first.
10. **Verify install** — `~/.cambrian/bin/cambrian --version` should print `cambrian <version>`. If it doesn't, the binary is broken; print a clear error.
11. **Telemetry opt-in (D9)** — print "Help us improve Cambrian by sending anonymous install metrics (OS, version, success/fail). No PII. [Y/n]:". If yes, write `telemetry_enabled: true` to `~/.cambrian/config.json`. The CLI then sends a single `POST` to `https://telemetry.cambrian.dev/v1/install` with `{os, arch, version, result: "success"}`. `CAMBRIAN_TELEMETRY=0` env var pre-empts the prompt with "off".
12. **Hand off to `cambrian init` (D8)** — print "Cambrian installed. Running first-time setup..." and `exec ~/.cambrian/bin/cambrian` (no args). The CLI detects "no config + no keychain + first run" and runs the full stack setup wizard (CLI-005).

### The install script's non-responsibilities (D7)

The install script **does not**:
- Install Postgres or pgvector.
- Create the `cambrian` database.
- Run DB migrations.
- Generate `config.json`.
- Register a service.
- Start the orchestrator.
- Prompt for LLM API keys.

All of that is `cambrian init`'s job. The split is intentional: the `curl | sh` step is "get the tools." The `cambrian init` step is "set up the world." Users who already have Postgres can skip the install step; users who want a manual install can do it without the script.

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
| Unsupported OS | "Cambrian V1 supports macOS and Linux. Windows is coming in V1.1." |
| GitHub unreachable | "Could not reach GitHub. Check your network or install manually: https://cambrian.dev/manual-install" |
| Checksum mismatch | "Binary integrity check failed. Refusing to install. Possible cause: incomplete download or compromised release. Try again or report at https://github.com/cambrian/cambrian-runtime/issues" |
| Permission denied (writing to `~/.cambrian/bin/`) | "Cannot write to ~/.cambrian/bin. Check disk space and permissions." |
| Binary doesn't run | "Downloaded binary is not executable. Report at https://github.com/cambrian/cambrian-runtime/issues" |
| User Ctrl-C | Exit immediately, no cleanup needed (nothing was modified yet) |

**No stack traces. No log dumps. Always a single `cambrian doctor` command to diagnose.**

### Manual install (for users who can't run `curl | sh`)

Documented in the README and at `cambrian.dev/manual-install`:

```bash
# 1. Download from GitHub Releases
curl -fsSL https://github.com/cambrian/cambrian-runtime/releases/latest/download/cambrian-$(uname -sm | tr ' ' '-' | tr A-Z a-z) -o cambrian
curl -fsSL https://github.com/cambrian/cambrian-orchestrator/releases/latest/download/cambrian-orchestrator-$(uname -sm | tr ' ' '-' | tr A-Z a-z) -o cambrian-orchestrator

# 2. Verify checksums
curl -fsSL https://github.com/cambrian/cambrian-runtime/releases/latest/download/SHA256SUMS | grep $(uname -sm | tr ' ' '-' | tr A-Z a-z)
shasum -a 256 cambrian cambrian-orchestrator  # must match

# 3. Install
mkdir -p ~/.cambrian/bin
mv cambrian cambrian-orchestrator ~/.cambrian/bin/
chmod +x ~/.cambrian/bin/cambrian ~/.cambrian/bin/cambrian-orchestrator

# 4. Add to PATH (shell-specific)
echo 'export PATH="$HOME/.cambrian/bin:$PATH"' >> ~/.zshrc  # or ~/.bashrc

# 5. Run
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

- [ ] `cambrian.dev/install.sh` serves the script.
- [ ] `cli/scripts/install.sh` exists in the repo (mirror of the hosted version).
- [ ] Script handles: platform detection, version lookup, CLI + orchestrator download, checksum verification, install to `~/.cambrian/bin/`, `PATH` update, telemetry opt-in, handoff to `cambrian init`.
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
