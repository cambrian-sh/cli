# CLI-003 — Distribution Strategy

**Date:** 2026-06-25
**Amended:** 2026-07-13 — repo URLs updated to the `cambrian-sh` org (kernel repo renamed to `core`); binary-size estimate corrected; version lookup switched to the release-redirect pattern; Windows x64 + `install.ps1` pulled into V1 (D5 amended)
**Status:** Accepted (D4, D5, D11 locked in `docs/plans/cli-initiative.md` Part 0; D5 amended 2026-07-13)
**Author:** CLI initiative
**Depends on:** —
**Relates to:** CLI-004 (install script — what the distribution enables)

---

## Context

The current CLI is distributed as TypeScript source. To run it, the user must:

1. `git clone` the repo
2. Install Bun (a JS runtime)
3. `cd cli && bun install`
4. `bun run proto:gen` (generates the embedded proto)
5. `bun run build` (bundles to `dist/index.js`)

This is a 5-command install that requires the user to have Git + Bun on the machine, and it requires the proto regeneration step to be re-run after every proto change. **This is a non-starter for the "one shell command from the website" vision.** The install must be: `curl ... | sh` with no prerequisites other than `curl` (which is running the script in the first place).

Two technical realities shape the distribution:

1. **`bun build --compile` produces a single-file binary.** Bun 1.1+ can compile a TypeScript entry point into a self-contained executable that bundles the Bun runtime + all JS code. Output is a single binary per platform — realistically **~50–100 MB**, since the Bun runtime is embedded (verify exact size at first release; `--minify` and stripping help at the margin). No Bun install required at runtime.

2. **The CLI and the orchestrator are separate Go and TypeScript codebases.** They have different release cadences. Bundling the orchestrator binary into the CLI binary (D11 rejected) would force them to ship together. V1 keeps them separate: the CLI binary downloads the orchestrator binary during `cambrian init`.

---

## Decision

The V1 distribution is **GitHub Releases only** (on the CLI repo, `github.com/cambrian-sh/cli`), with the CLI as a **standalone binary per platform**, downloaded via a **single `curl | sh` install script** (`install.ps1` on Windows). Package managers (Homebrew, scoop, winget, .deb/.rpm) are deferred to V1.1.

### Platforms (V1, D5 — amended 2026-07-13 to include Windows)

| Platform | Binary name | Build target |
|---|---|---|
| macOS arm64 (Apple Silicon) | `cambrian-darwin-arm64` | `bun build --compile --target=bun-darwin-arm64` |
| macOS x64 (Intel) | `cambrian-darwin-x64` | `bun build --compile --target=bun-darwin-x64` |
| Linux x64 (glibc) | `cambrian-linux-x64` | `bun build --compile --target=bun-linux-x64` |
| Linux arm64 (glibc) | `cambrian-linux-arm64` | `bun build --compile --target=bun-linux-arm64` |
| Windows x64 | `cambrian-windows-x64.exe` | `bun build --compile --target=bun-windows-x64` |

Linux musl (Alpine) is a V1.1 follow-up. Windows x64 is **in V1** (amended: the core team develops on Windows — dogfooding the install path matters more than the original deferral).

### Release artifact (per release)

```
cambrian-darwin-arm64          # ~50–100 MB each (Bun runtime embedded)
cambrian-darwin-x64
cambrian-linux-x64
cambrian-linux-arm64
cambrian-windows-x64.exe
SHA256SUMS                     # checksums for all binaries
```

The orchestrator binary is **not** in the CLI release. It is downloaded from the kernel repo's GitHub Releases (`github.com/cambrian-sh/core`) during `cambrian init` (D11). The CLI's release notes link to the orchestrator version it was tested against.

### Install script (D7)

`curl -fsSL https://cambrian.dev/install.sh | sh` (or, on Windows, `powershell -ExecutionPolicy Bypass -c "irm https://cambrian.dev/install.ps1 | iex"`) does this:

1. Detect OS/arch.
2. Download the matching `cambrian-{os}-{arch}` from the latest GitHub Release.
3. Verify the SHA256 checksum against `SHA256SUMS`.
4. Install to `~/.cambrian/bin/cambrian` (user-level, no `sudo`).
5. Add `~/.cambrian/bin` to `PATH` in `~/.zshrc` / `~/.bashrc` (idempotent — don't duplicate).
6. Print `cambrian --version` and hand off to `cambrian init` (D8).

The full install script design lives in **CLI-004**.

### CI build (tag-driven)

A GitHub Actions workflow on `v*` tag:

1. Build all 5 platform binaries via `bun build --compile`.
2. Generate `SHA256SUMS`.
3. Create a GitHub Release with the binaries + `SHA256SUMS` attached.
4. Update a `latest` symlink (GitHub Releases' "latest" flag).

No signing for V1 (cosign is a V1.1 follow-up). Checksum verification is the only integrity check.

### Update channel (D12)

`cambrian update` is the explicit user-facing command. It:

1. Reads the current version (`cambrian --version` → embedded at build time via `Bun.env.CAMBRIAN_VERSION`).
2. Resolves the latest version by following the `https://github.com/cambrian-sh/cli/releases/latest` redirect (no API call, no rate limits, no JSON scraping); the tag is the final URL segment.
3. If newer, downloads + verifies + replaces the binary + restarts the service.
4. `--check` flag reports available version without applying.

Auto-update is **not** in V1. No background check, no auto-download. The user runs `cambrian update` when they want to update.

### V1.1 follow-ups (not in V1)

- Homebrew tap: `brew install cambrian-sh/tap/cambrian` (do first — cheapest, one auto-bumpable formula repo).
- scoop bucket: `scoop install cambrian` (one JSON manifest in our own repo).
- winget manifest (PR to `microsoft/winget-pkgs`; `wingetcreate` automates version bumps).
- `.deb`/`.rpm` as release assets via `nfpm` (no hosted apt/dnf repos — repo hosting + GPG signing is a permanent ops burden with no matching pull yet).
- Linux musl (Alpine) binary.
- Cosign signature verification.
- Auto-update with opt-out.

Dropped from the follow-up list (2026-07-13): npm package (`@cambrian/cli`) — rejected in Options below and it stays rejected; chocolatey — superseded by winget + scoop.

---

## Options considered

| Option | What | Why rejected |
|---|---|---|
| **A. GitHub Releases + standalone binaries + curl|sh (chosen)** | 4 platform binaries, downloaded by a small install script. No runtime deps. | Zero infra to set up. Fastest to ship. Standard pattern (cf. `rustup`, `deno`, `bun` itself). |
| **B. GitHub Releases + Homebrew + scoop + chocolatey in V1** | All channels on day one. | 2–3× the work (tap repo, formula, CI for each). Delays V1. The `curl|sh` install covers the 90% case; package managers are reach, not foundation. |
| **C. GitHub Releases + npm** | `@cambrian/cli` package. | Adds npm-specific design (package.json scripts, semver, lockfile behavior). Doesn't help non-JS users. Doesn't fit the "one curl command" story. |
| **D. Bundle the orchestrator binary inside the CLI binary** | One download, ~150 MB binary. | D11 rejected this. Couples CLI and orchestrator release cadences. Larger binary for users who only want the CLI. |
| **E. Source-only distribution (current state)** | `git clone` + `bun install` + `bun run proto:gen` + `bun run build`. | What we have today. Fails the "one shell command" vision. |

---

## Consequences

### Positive

- **One command to install.** `curl -fsSL https://cambrian.dev/install.sh | sh` works on macOS and Linux; the `irm | iex` PowerShell equivalent covers Windows.
- **No runtime dependencies.** Bun is bundled into the binary. The user only needs `curl` (which they're already using).
- **Fast updates.** Tag a release → CI builds → users run `cambrian update`. No npm publish, no Homebrew formula PR.
- **Single-file CLI binary.** ~50–100 MB (Bun runtime embedded) — not small, but one file, no runtime deps. The orchestrator binary is downloaded separately during `cambrian init` and lives in `~/.cambrian/bin/`.
- **Decoupled releases.** CLI and orchestrator version independently. `cambrian --version` reports the CLI version; `cambrian status` reports the orchestrator version.

### Negative

- **Windows support means two install scripts.** `install.sh` and `install.ps1` must stay behavior-identical (platform detection aside); divergence is a real maintenance risk. Mitigated by sharing the same asset-naming contract and a common test matrix.
- **No signature verification in V1.** Checksums are the only integrity check. A compromised GitHub release would ship malicious binaries. Mitigated by V1.1 cosign signing and clear "verify the checksum" docs.
- **No auto-update.** Users must run `cambrian update` to upgrade. Acceptable for V1; may become friction.
- **GitHub Releases is a single point of failure.** If GitHub goes down, no one can install. Mitigated by mirror plan in V1.1 (Cloudflare R2 + signed manifests).
- **Bun-compiled binary cold-start is ~50ms slower than Go native.** Acceptable for a CLI that does I/O-bound work (gRPC calls). Not a concern for the TUI (which is interactive).

### Neutral

- The CLI's `dist/index.js` (current Bun bundle, ~2 MB) is replaced by a Bun-compiled binary. The build target changes from `bun build` to `bun build --compile`. `package.json` script `build:bin` already exists for this.
- The proto-embed step (`bun run proto:gen`) still happens at build time, but the result is embedded in the compiled binary. The user's `cambrian` binary contains the proto as a string constant.

---

## Acceptance criteria

- [ ] `bun run build:bin` produces a standalone binary per platform (macOS arm64/x64, Linux x64/arm64, Windows x64).
- [ ] GitHub Actions workflow builds all 5 binaries on `v*` tag and creates a Release on `cambrian-sh/cli`.
- [ ] `SHA256SUMS` is generated and attached to each release.
- [ ] `install.sh` (at `cambrian.dev/install.sh`) detects platform, downloads the right binary, verifies the checksum, installs to `~/.cambrian/bin/`, updates `PATH`.
- [ ] `install.ps1` (at `cambrian.dev/install.ps1`) does the same on Windows (install to `%USERPROFILE%\.cambrian\bin`, user-level `PATH` update).
- [ ] `cambrian --version` prints the embedded version.
- [ ] `cambrian update` checks GitHub Releases, downloads + verifies + replaces the binary.
- [ ] `cambrian update --check` reports the available version without applying.
- [ ] README documents the one-line install and the manual `cambrian update` path.
- [ ] 42 existing smoke tests pass against the compiled binary.
- [ ] `tsc --noEmit` clean.

---

## Follow-on ADRs

- **CLI-004** — Install Script Design: the `install.sh` and `cambrian init` flow in detail.
