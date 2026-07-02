# CLI Initiative — Implementation Plan

**Status:** FROZEN — 2026-06-25 — all decisions locked, ready to implement
**Date:** 2026-06-25
**Author:** CLI initiative planning session

> **Purpose:** This document is the gate between "we know what to build" and "we start building." It proposes the full set of ADRs, the PRD outline, the ticket breakdown, the install script design, and the operator-proto migration plan. All 12 open questions are locked.

---

## Part 0 — Locked decisions (the contract for implementation)

These 12 decisions are frozen. Any deviation requires a new ADR.

| # | Decision | Value |
|---|---|---|
| **D1** | ADR numbering | **CLI-001 through CLI-010** (mirror `UI-001` through `UI-017`) |
| **D2** | Operator-plane migration scope | **Full migration, 6 phases** |
| **D3** | Auth flow | **`cambrian login` for interactive + `--token` flag for CI** |
| **D4** | Distribution channels (V1) | **GitHub Releases only**; Homebrew/scoop/choco/winget in V1.1 |
| **D5** | Platform support (V1) | **macOS + Linux**; Windows in V1.1 |
| **D6** | Service manager | **Service-managed, auto-start disabled by default** |
| **D7** | Install script scope | **CLI binary + orchestrator binary only**; `cambrian init` does the rest |
| **D8** | Wizard trigger | **First `cambrian` invocation auto-triggers full stack setup** |
| **D9** | Telemetry | **Anonymous opt-in ping, opt-out via `CAMBRIAN_TELEMETRY=0`** |
| **D10** | LLM defaults | **Local Ollama default, API key optional override** |
| **D11** | Binary delivery | **CLI downloads orchestrator separately during init** |
| **D12** | Update strategy | **Explicit `cambrian update` command** |

---

---

## Part 1 — Context (verified facts)

### The Operator Transport Plane is fully implemented

- **ADR-0047** (`docs/adr/0047-operator-transport-plane.md`) is the design record (Proposed 2026-06-13, grilled, then implemented).
- **`internal/substrate/operator/`** (23 files) implements the `OperatorConsole` gRPC service in Go.
- **`api/proto/operator.proto`** (352 lines, pinned to contract `0047` / kernel `0.6.9-alpha`) is the source of truth.
- **`ui/proto/operator.proto`** is the UI's vendored, read-only copy.
- **Per `ui/AGENTS.md`:** "The runtime's Operator Transport Plane is fully implemented: all `OperatorConsole` RPCs respond; the feed carries auction / agent-ready / session-lifecycle / memory-written / HITL-raised / verifier-round / LLM-health / plan-state / audit / (best-effort) token events; commands have real effects; audit is durable."

### Current CLI uses the wrong proto surface

The CLI today calls **11 RPCs on `Orchestrator`** (agent-facing) with **`x-agent-id`** metadata:

| CLI command | RPC called | Plane | Should move? |
|---|---|---|---|
| `tools list` / `get` / `describe` | `ListTools` | Agent | No — agent-plane by design |
| `tools exec` | `ExecuteTool` | Agent | No — tool execution is agent concern |
| `skills list` / `get` / `describe` | `ListSkills` | Agent | No — skill discovery is agent concern |
| `watches list` / `create` / `delete` / `toggle` / `describe` | `ListWatches` / `RegisterWatch` / `DeleteWatch` / `SetWatchActive` | Agent | No — WatchConfig is agent-plane per ADR-0032 |
| `memory query` / `write` | `QueryMemory` / `IngestMemory` | Agent | No — LTM is agent-scope |
| `approve` / `deny` | `WatchApprovals` / `SubmitApprovalDecision` | **Operator** (proto-commented) | **YES** — migrate to `ResolveHITL` on `OperatorConsole` |

**The only CLI commands touching operator-plane concerns are the HITL approvals, and they use the legacy agent-plane path.** This is the architectural drift the co-founder flagged.

### No CLI initiative docs exist

- No CLI ADR, no CLI PRD, no CLI ticket folder.
- The only CLI-adjacent work: `docs/issues/adr19/0019-08-export-events-cli.md` (an observability export tool, not the CLI initiative).
- `cli/CONTEXT.md` exists but is the internal developer doc, not the product/architecture spec.

### Next available numbers

- **Next ADR:** `0054` (highest existing: `0053`)
- **Next PRD:** `0054` (highest 4-digit: `0053`)
- **Next ticket folder:** `docs/issues/adr54/`
- **UI precedent:** `UI-001` through `UI-017` use a separate `UI-NNN` prefix co-located in `docs/adr/`

---

## Part 2 — Vision (your three requirements)

1. **Standalone installable** on Mac/Windows/Linux from scratch
2. **One shell command** from the website → user is onboarded
3. **One shell command** runs the full sequence: install runtime → setup dependencies → configure → first use

The first-impression install script is a product surface in its own right. The CLI must be the single front door for "learn about Cambrian → run Cambrian."

---

## Part 3 — Gap analysis (current vs. vision)

| Capability | Current CLI | Vision CLI | Gap |
|---|---|---|---|
| Runtime install (Go binary, orchestrator) | None | Install + verify | Full implementation |
| Postgres + pgvector setup | None | Install + init + migrate | Full implementation |
| Python + agent deps | None | Install + verify | Full implementation |
| Config generation | CLI-only (own connection) | Orchestrator `configs/config.json` | Full implementation |
| DB migration runner | None | `psql -f db/migrations/*.sql` | Full implementation |
| Orchestrator lifecycle | None | start / stop / status / logs | Full implementation |
| Service manager (systemd/launchd/Service) | None | Register + auto-start | Full implementation |
| Install command | `git clone ... && cd cli && bun install && bun run proto:gen && bun run build` (5 cmds, requires Bun) | `curl ... \| sh` (1 cmd, no deps) | Full implementation |
| Distribution | Source only (requires Bun runtime) | Standalone binary per platform | Full implementation |
| Auth model | `x-agent-id` (agent principal — wrong for an operator CLI) | `Login → Bearer token` (ADR-0047 D13) | Migrate to operator plane |
| HITL path | `WatchApprovals` / `SubmitApprovalDecision` (agent-plane legacy) | `StreamEvents` + `ResolveHITL` (operator-plane canonical) | Migrate to operator plane |
| Live event feed | None | `StreamEvents` subscription (23 event types) | Full implementation |
| Audit access | None | `QueryAudit` | Full implementation |
| First-run experience | 5-step wizard (CLI connection only) | Full stack setup wizard | Expand wizard |
| Uninstall | None | `cambrian uninstall` | Full implementation |
| Update | None | `cambrian update` | Full implementation |

**Roughly 80% of the vision is net-new capability.** The current CLI's subcommand surface (tools, skills, memory, watches, status, doctor, config) is the right *shape* — it just runs against the wrong proto and assumes the stack already exists.

---

## Part 4 — Proposed ADRs (the architecture decisions)

Following the **UI-NNN** convention (separate from the main `0001-0053` series), co-located in `docs/adr/`. Each ADR is a 1–3 page decision record following the `UI-008` template (Context, Options, Decision, Consequences).

### CLI-001 — Operator Plane Adoption
**Decision:** The CLI must use `OperatorConsole` (operator-plane) for all operator concerns. The `ApprovalHub`-backed RPCs (`WatchApprovals` / `SubmitApprovalDecision` on `Orchestrator`) are legacy paths; the canonical operator path is `StreamEvents` + `ResolveHITL` on `OperatorConsole`.
**Scope:** CLI today has no operator-plane calls. This ADR defines which CLI subcommands route through `OperatorConsole` vs `Orchestrator`.

### CLI-002 — Auth Model (Login + Bearer + Roles)
**Decision:** CLI gets a `cambrian login` flow. On login, store the token in OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service via libsecret). Every operator-plane RPC sends `authorization: Bearer <token>`. Role (`operator` / `viewer`) comes from the login response; CLI hides mutating subcommands from viewers.
**Scope:** Replaces the current `operatorId` config field with proper per-user auth.

### CLI-003 — Distribution Strategy
**Decision:** Ship as standalone binaries per platform (macOS arm64/x64, Linux x64/arm64, Windows x64). Built with `bun build --compile` to a single executable. Distribute via GitHub Releases. Provide `curl ... | sh` installer that fetches the right binary for the platform.
**Scope:** Replaces the "requires Bun + git clone" model.

### CLI-004 — Install Script Design
**Decision:** The first-run script is a product surface. It must work on Mac/Windows/Linux with zero prerequisites (other than `curl` or `powershell`). It must detect the platform, install the runtime binary, install system dependencies (Postgres+pgvector, Python), initialize the database, run migrations, generate config, register a service, and verify the end-to-end flow before declaring success.
**Scope:** The single most important deliverable for first impressions.

### CLI-005 — Onboarding Wizard Expansion
**Decision:** The current 5-step wizard (welcome → server → operator → test → save) only configures the CLI's own connection. Expand to a full stack setup: detect missing deps → install missing deps → init DB → run migrations → start orchestrator → verify → save config.
**Scope:** Triggered when no stack is detected. Replaces current "no config" wizard.

### CLI-006 — Orchestrator Lifecycle Management
**Decision:** CLI manages the orchestrator process: `cambrian start` / `stop` / `restart` / `status` / `logs`. On macOS uses `launchd`; on Linux uses `systemd`; on Windows uses the Service Control Manager. Auto-start on boot is configurable.
**Scope:** New subcommand group. Replaces the "operator must start orchestrator manually" model.

### CLI-007 — Idempotent Command Protocol
**Decision:** Every mutating CLI command auto-generates a `command_id` (UUID v4) and accepts `--reason <text>` (required for destructive ops, optional otherwise). The CLI sends these on every `OperatorConsole` command. Re-running the same command reuses the same `command_id` (idempotency via `operator_audit.command_id` UNIQUE).
**Scope:** Touches every mutating subcommand.

### CLI-008 — Event Feed Integration
**Decision:** The CLI TUI subscribes to `OperatorConsole.StreamEvents` for live updates: auction events, plan state, HITL raised, audit, LLM health, agent ready. Replaces the current polling-based TUI state.
**Scope:** Rewrites the TUI's data layer.

### CLI-009 — Snapshot + Resync Protocol
**Decision:** On connect, CLI calls `Snapshot` to bootstrap state, captures `as_of_seq`, then subscribes to `StreamEvents(as_of_seq)`. On `ResyncRequired`, re-snapshot and resubscribe. Backoff+jitter for reconnects (base 1s, factor 2, cap 30s, ±10%).
**Scope:** New lifecycle in the gRPC client.

### CLI-010 — Audit Log Access
**Decision:** `cambrian audit list` / `audit show <id>` / `audit export` subcommands backed by `OperatorConsole.QueryAudit`. Filterable by actor, command, time range, session.
**Scope:** New subcommand group. Closes the "no audit trail visibility" gap.

---

## Part 5 — Proposed PRD outline

**File:** `docs/requirements/CLI/cli-prd.md` (mirroring `docs/requirements/UI/web-ui-prd.md`)

**Sections:**
1. **Problem statement** — today: 5 commands to install + Bun required + manual DB setup + no service management. Operators must read README, clone repo, install deps, configure, start, verify.
2. **Solution** — one command (`curl ... | sh`) installs everything, configures everything, starts everything, verifies everything. Subsequent `cambrian` invocations are instant.
3. **User stories** (~30 stories, organized by audience)
   - **First-time operator (3 stories)**: runs the one-liner, sees the welcome screen, the system is up.
   - **Returning operator (8 stories)**: `cambrian start` if not running, TUI loads, approves HITL, runs a plan, sees audit.
   - **SSH / remote (4 stories)**: SSHes in, runs `cambrian status --json`, runs `cambrian memory query`, runs `cambrian tools exec`.
   - **CI / scripts (5 stories)**: `cambrian doctor --json` in a health check, `cambrian audit export` for compliance, `cambrian update` in a cron.
   - **Uninstall (2 stories)**: `cambrian uninstall --yes` removes everything cleanly.
4. **The first-run experience (critical)** — exact sequence of screens, time-to-green target (<5 min from curl to first plan), what success looks like, what failure looks like.
5. **Operator vs Viewer** — viewer mode hides all mutating subcommands.
6. **Out of scope** — marketing site, agent IDE, marketplace, full observability clone.
7. **The 10-second demo** — a recording of: `curl ... | sh` → green status → first plan execution. This is the marketing asset.

---

## Part 6 — Proposed ticket breakdown

**Folder:** `docs/issues/cli/` (new — CLI initiative is cross-cutting, not tied to one ADR number)

Or alternatively: `docs/issues/adr54/` (if the CLI initiative is one mega-ADR). Recommendation: **`docs/issues/cli/`** because the initiative spans 10 ADRs.

**Ticket naming:** `cli-NN-*.md` (mirroring the `0047-NN-*.md` style for ADR-0047 sub-issues).

### Phase 0 — Architecture (before any code)

- `cli-01-decide-naming-convention.md` — CLI-NNN vs 0054-NNN for ADRs; docs/issues/cli/ vs docs/issues/adr54/ for tickets. **Must lock before writing ADRs.**
- `cli-02-decide-distribution-channels.md` — GitHub Releases only? Homebrew tap? scoop? chocolatey? winget? snap? **Must lock before CLI-003.**
- `cli-03-decide-auth-flow.md` — Login + password? SSO? Pre-shared token? Cert-based? **Must lock before CLI-002.**
- `cli-04-decide-platform-support-v1.md` — Mac + Linux only? All three for V1? **Must lock before CLI-003 / CLI-004.**
- `cli-05-decide-service-manager-scope.md` — Auto-start on boot included in V1? Manual start only? **Must lock before CLI-006.**

### Phase 1 — Operator plane migration (foundational)

- `cli-10-vendor-operator-proto.md` — Copy `api/proto/operator.proto` to `cli/proto/operator.proto` (vendored, pinned to `0047`, with a header that says so — mirroring `ui/proto/operator.proto`).
- `cli-11-update-proto-embed.md` — Update `scripts/embed-proto.ts` to embed `operator.proto` instead of (or alongside) `cambrian.proto`.
- `cli-12-add-operatorconsole-client.md` — New file `src/grpc/operator-client.ts` wrapping `OperatorConsole` RPCs (Login, Snapshot, StreamEvents, ResolveHITL, QueryAudit, command RPCs).
- `cli-13-migrate-hitl-path.md` — Replace `WatchApprovals` / `SubmitApprovalDecision` calls with `StreamEvents` + `ResolveHITL`.
- `cli-14-add-bearer-auth.md` — Replace `x-agent-id` metadata on operator-plane calls with `authorization: Bearer <token>`. Keep `x-agent-id` for agent-plane calls.
- `cli-15-add-keychain-storage.md` — Token storage in OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service).

### Phase 2 — Distribution

- `cli-20-bun-compile-binary.md` — Add `bun build --compile` to produce single-file binary per platform. Add to CI.
- `cli-21-github-releases.md` — Tag-driven release workflow that builds for all platforms and uploads to GitHub Releases.
- `cli-22-curl-install-script.md` — The `install.sh` (macOS/Linux) and `install.ps1` (Windows) that detect platform, fetch the right binary, place it in PATH, verify.

### Phase 3 — Runtime install + setup

- `cli-30-detect-platform.md` — Cross-platform detection (macOS arm64/x64, Linux x64/arm64, Windows x64).
- `cli-31-install-orchestrator.md` — Download the orchestrator binary from GitHub Releases, place in `/usr/local/bin` or `~/.cambrian/bin`.
- `cli-32-install-postgres.md` — Detect existing Postgres; if missing, install via `brew install postgresql@16 pgvector` (mac), `apt install postgresql postgresql-16-pgvector` (Debian), `dnf install postgresql16 postgresql16-pgvector` (Fedora), or document manual steps (Windows).
- `cli-33-create-database.md` — `createdb cambrian`, create user, set permissions.
- `cli-34-run-migrations.md` — Apply all `db/migrations/*.sql` in order, track applied set in a `schema_migrations` table.
- `cli-35-generate-config.md` — Generate `~/.cambrian/configs/config.json` with safe defaults (localhost Postgres, embedded LLM if no key set, generated secret).
- `cli-36-start-orchestrator.md` — `cambrian start` — launch the orchestrator as a managed service.

### Phase 4 — Service management

- `cli-40-systemd-unit.md` — Generate `~/.config/systemd/user/cambrian.service` for Linux.
- `cli-41-launchd-plist.md` — Generate `~/Library/LaunchAgents/com.cambrian.runtime.plist` for macOS.
- `cli-42-windows-service.md` — Register as Windows Service via `sc create` or NSSM.
- `cli-43-lifecycle-subcommands.md` — `cambrian start|stop|restart|status|logs`.

### Phase 5 — First-run experience

- `cli-50-onboarding-wizard-v2.md` — Rewrite the wizard to handle the full stack setup flow.
- `cli-51-verification-step.md` — After setup, run a `doctor`-like end-to-end check: orchestrator up, DB reachable, LLM reachable, first plan executes successfully. Report time-to-green.
- `cli-52-beautiful-failure.md` — When something fails, show the exact command to fix it, link to docs, suggest common causes. Never show stack traces.

### Phase 6 — Audit + observability

- `cli-60-audit-subcommands.md` — `audit list`, `audit show <id>`, `audit export` backed by `QueryAudit`.
- `cli-61-event-feed-tui.md` — TUI subscribes to `StreamEvents` for live updates.
- `cli-62-snapshot-resync.md` — Bootstrap + reconnect logic with backoff.

### Phase 7 — Polish

- `cli-70-uninstall.md` — `cambrian uninstall --yes` — stop service, remove binaries, drop DB (with confirmation), remove config.
- `cli-71-update.md` — `cambrian update` — fetch latest binary, replace, restart.
- `cli-72-shell-completions.md` — Bash, zsh, fish, PowerShell completions.

**Roughly 30 tickets across 7 phases.** Phases 0–2 unblock everything else. Phases 3–4 deliver the vision. Phases 5–7 are polish.

---

## Part 7 — Install script design (the critical first impression)

> **Reflects locked decisions:** D5 (macOS+Linux V1), D7 (script = CLI + orchestrator only), D8 (first `cambrian` auto-triggers init), D9 (opt-in telemetry), D10 (local Ollama default), D11 (separate binary download), D6 (service-managed, auto-start off).

### The one-liner (the website command)

```bash
# macOS / Linux (Windows install.ps1 comes in V1.1)
curl -fsSL https://cambrian.dev/install.sh | sh
```

### The install script's responsibilities (D7 — CLI + orchestrator only)

1. **Welcome + platform detection** — print the Cambrian banner, detect OS (macOS/Linux) and arch (arm64/x64), confirm with user.
2. **Prereq check** — `curl` exists (it does, since the script is running). Detect `sudo` availability; warn if not.
3. **Download CLI binary** — fetch from `https://github.com/cambrian/cambrian-runtime/releases/latest/download/cambrian-{os}-{arch}`.
4. **Download orchestrator binary** — fetch from the same release at `cambrian-orchestrator-{os}-{arch}` (D11 — separate binary, not bundled).
5. **Install both to `~/.cambrian/bin/`** — no sudo required (D6: user-level service, not system). Verify with `cambrian --version`.
6. **Add `~/.cambrian/bin` to PATH** — update `~/.zshrc` / `~/.bashrc` if not present.
7. **Telemetry opt-in prompt (D9)** — one-line yes/no. If yes, send OS/arch (no PII). Stored in `~/.cambrian/config.json`. `CAMBRIAN_TELEMETRY=0` overrides.
8. **Hand off to `cambrian init`** — print "Cambrian CLI installed. Starting first-run setup..."
9. **`cambrian init` (triggered by D8 — first invocation auto-runs) handles:**
   a. Detect existing Postgres (psql in PATH? running on :5432? has `cambrian` DB?)
   b. If missing Postgres: install via `brew install postgresql@16 pgvector` (mac) or `apt install postgresql postgresql-16-pgvector` (Debian) or `dnf install postgresql16 postgresql16-pgvector` (Fedora). If install fails, show manual steps.
   c. Create `cambrian` DB + role
   d. Run all `db/migrations/*.sql` in order (track in `schema_migrations` table)
   e. Generate `~/.cambrian/configs/config.json` with secure defaults
   f. **LLM provider (D10):** detect Ollama → if missing, auto-install + pull `llama3.2:3b` → user can override with `cambrian config set llm.api_key <key>` for OpenAI/Anthropic
   g. Register service (D6: systemd user unit on Linux, launchd plist on macOS, auto-start OFF)
   h. Start orchestrator: `cambrian start`
   i. Wait for `Snapshot` to return successfully
   j. Print "Cambrian is running. Try: `cambrian chat 'summarize the last 24h of errors'`"
10. **On any failure** — print what failed, what was attempted, the exact next step. Never a stack trace. Always a single `cambrian doctor` command to diagnose.

### Design principles

- **Fast feedback loop** — every step prints what it's doing in plain English with a spinner. No silent waits longer than 2s.
- **Idempotent** — running it twice is safe. Detects "already installed, upgrade?" vs "fresh install."
- **Rollback-aware** — if step 9d fails, it cleans up the DB it just created. If 9h fails, it stops cleanly.
- **Offline-tolerant** — if the orchestrator can't reach the LLM, setup still succeeds; the user gets a warning, not a failure.
- **Beautiful failure** — the install script is the most-seen code in the project. It must read like a senior engineer wrote it for a friend.

---

## Part 8 — Operator proto migration plan (phased)

> **Reflects locked decisions:** D2 (full migration, 6 phases), D3 (login + --token), D11 (separate binary).

### Phase 1: Add the operator client (additive, no breakage)
- Vendor `operator.proto` to `cli/proto/operator.proto` (pinned to `0047`, header mirrors `ui/proto/operator.proto`)
- Add `src/grpc/operator-client.ts` alongside the existing agent-plane client
- CLI can call both planes; no existing subcommand changes

### Phase 2: Migrate the HITL path
- `cambrian approve <id>` → calls `OperatorConsole.ResolveHITL` instead of `SubmitApprovalDecision`
- `cambrian deny <id>` → same
- `cambrian approve list` → subscribes to `StreamEvents` (filtered for `hitl_raised`) instead of `WatchApprovals`
- `command_id` auto-generated as UUID per invocation
- `--reason` flag added to approve/deny (required for destructive ops)

### Phase 3: Add the auth flow (D3)
- `cambrian login` → calls `OperatorConsole.Login`, stores token in OS keychain
- `cambrian logout` → clears keychain
- `cambrian whoami` → shows role from cached login response
- `cambrian --token <jwt>` → one-shot token for CI/scripts
- Viewer role: hide all mutating subcommands in help and TUI

### Phase 4: Add the event feed
- TUI subscribes to `StreamEvents`
- Snapshot + resync protocol
- Backoff+jitter reconnect

### Phase 5: Add audit access
- `cambrian audit list|show|export` backed by `QueryAudit`

### Phase 6: Deprecate (but keep) the agent-plane path
- Tool/skill/memory/watch/execute stay on `Orchestrator` (they're agent-plane by design)
- Document the split clearly in `cli/CONTEXT.md`

**Migration cost:** ~3 weeks of focused work for one engineer, mostly the auth flow (keychain) and the TUI event-feed rewrite.

---

## Part 9 — ~~Open questions~~ LOCKED DECISIONS

All 12 questions are locked. See **Part 0** at the top of this document.

---

## Part 10 — Recommended sequencing (frozen plan)

1. **Write the 10 ADRs** (CLI-001 through CLI-010) — each 1–3 pages, following the `UI-008` template. ~3–4 days.
2. **Write the PRD** — `docs/requirements/CLI/cli-prd.md`. ~2 days.
3. **Momus review** the ADRs + PRD for clarity/verifiability/completeness. ~1 day.
4. **Write the tickets** — `docs/issues/cli/` folder, ~30 tickets across 7 phases. ~1 day.
5. **Implement Phase 1** — operator plane migration (the foundation everything else builds on). ~3 weeks.
6. **Implement Phase 2** — distribution (binary, GitHub Releases, install script). ~2 weeks.
7. **Implement Phase 3** — runtime install + setup (Postgres, migrations, config). ~2 weeks.
8. **Implement Phase 4** — service management (systemd, launchd). ~1 week.
9. **Implement Phase 5** — first-run experience (wizard rewrite, verification). ~1 week.
10. **Implement Phase 6** — audit + event feed. ~1 week.
11. **Implement Phase 7** — polish (uninstall, update, completions). ~1 week.

**Realistic V1 timeline:** 10–12 weeks of one engineer, end to end. The install script + first-run experience (Phases 2 + 3 + 5) is the critical path for first impressions.

---

## Frozen-plan checklist

- [x] Q1–Q12 locked (Part 0)
- [x] ADR titles + scope approved (Part 4)
- [x] PRD section list approved (Part 5)
- [x] Phase ordering approved (Part 10)
- [x] Timeline expectation set (Part 10)
- [x] Install script reflects D5/D7/D8/D9/D10/D11 (Part 7)
- [x] Migration plan reflects D2/D3/D11 (Part 8)
- [x] Plan document at `docs/plans/cli-initiative.md` (confirmed)

**When you're ready, I'll start by writing CLI-001 (Operator Plane Adoption).** I will not start implementation until you say "go."
