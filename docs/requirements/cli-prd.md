# Cambrian CLI — Product Requirements Document (PRD)

**Source:** `docs/plans/cli-initiative.md` (frozen 2026-06-25)
**Status:** Draft v0.1 — for review
**Scope of this document:** This PRD defines **what the Cambrian CLI is**, **what flows exist**, **what the system promises**, and **what it refuses to do**. It contains no technical decisions; those live in `docs/adr/CLI-001` through `CLI-010` and in the UI's mirror ADRs (`UI-001` through `UI-017`).
**Vocabulary source:** `CONTEXT.md` §7 (Cambrian domain glossary) and the data-surface list in ADR-0047.
**Related docs:**
- ADRs: `docs/adr/CLI-001-operator-plane-adoption.md` through `CLI-010-audit-log-access.md`
- Plan: `docs/plans/cli-initiative.md`
- UI mirror: `ui/docs/web-ui-prd.md` (the CLI is the SSH/script/headless companion to the UI)
- Kernel: ADR-0047 (Operator Transport Plane)

---

## 1. Problem Statement

Cambrian is a distributed multi-agent orchestrator written in Go. Today, to install and run it, the user must:

1. Install Go 1.25.5+
2. Install PostgreSQL 16 with the pgvector extension
3. Install Python 3.x and the agent dependencies
4. `git clone https://github.com/cambrian/cambrian-runtime`
5. Copy `configs/config.example.json` to `configs/config.json` and edit 8+ fields
6. Initialize the database: `psql -f db/migrations/001_initial.sql` × 7
7. `go run cmd/orchestrator/main.go`
8. Configure an LLM provider (Ollama, OpenAI, or Anthropic)
9. Open a second terminal to talk to the orchestrator

This is a **9-step install** that requires a developer who already knows what Cambrian is, what Postgres+pgvector is, and what a Go toolchain is. The first impression of Cambrian is "this is a project for people who already have Go installed."

For the operator (the developer or technical user who runs Cambrian after install), the only surfaces today are:

- Direct gRPC calls against the orchestrator, by hand
- A small set of CLI subcommands in `cli/` that assume the orchestrator is already running
- Logs

The operator cannot:

- Install Cambrian from scratch in under 5 minutes
- See what's happening in a running plan in real time from a terminal
- Approve a HITL intervention in a terminal (must use the UI)
- Audit who did what when
- Script Cambrian operations in CI
- Recover from a service crash without `tail -f` on logs

This is not a polish problem; it is a **go-to-market problem**. Every new user faces the same 9-step install. Every operator's first session ends with "where do I look to see what just happened?"

---

## 2. Solution

The Cambrian CLI is the **install, setup, and operational companion** for Cambrian. It targets three audiences the UI and the bare-gRPC surfaces do not:

1. **First-time operators** — someone who just learned Cambrian exists and wants to run it.
2. **SSH / remote operators** — operators on headless servers, in containers, or on remote machines where a Tauri desktop UI is not available.
3. **CI / scripts** — automation that needs to read state, trigger actions, or audit.

The CLI delivers a single user-facing promise:

> **One shell command. From zero to first plan executing. In under 5 minutes.**

```
curl -fsSL https://cambrian.dev/install.sh | sh
```

That's it. The script installs the CLI and the orchestrator binary. The first `cambrian` invocation auto-triggers the full stack setup wizard (Postgres, pgvector, DB, config, service). When the wizard ends, the user has:

- A working orchestrator running as a user-level service
- An operator account with a Bearer token in the OS keychain
- A live TUI showing plans, approvals, agents, and watches
- The audit log ready for compliance

The product does **not**:

- Replace the Tauri UI (the UI is the canonical interactive surface; the CLI is the companion)
- Become a marketing site, agent IDE, marketplace, or full observability clone
- Speak a different vocabulary from the runtime
- Replace the kernel's hexagonal architecture: it is a controller over the kernel's boundary, not a back door
- Hide failures. Crashed agents, failed plans, unreachable kernels are first-class states

The V1 demo path is: **Operator runs `curl | sh` → sees the welcome banner → wizard walks through dep install, DB setup, LLM choice, first operator account → orchestrator starts → TUI opens → operator approves a HITL intervention → operator runs `cambrian audit list` to see the approval in the log. Total time: 3–5 minutes.**

---

## 3. User Stories

The stories are organized by the audiences defined in the problem statement. Numbering is stable so future docs can refer to stories by id.

### First-time operator

1. As a first-time operator, I want to run a single shell command, so that the install is one decision, not nine.
2. As a first-time operator, I want the install script to fetch and verify the CLI and orchestrator binaries, so that I can trust what I'm running.
3. As a first-time operator, I want the first `cambrian` invocation to launch a setup wizard, so that I don't need to remember a `cambrian init` command.
4. As a first-time operator, I want the wizard to detect and install missing dependencies (Postgres, pgvector, Python), so that I don't have to know which versions are required.
5. As a first-time operator, I want to choose my LLM provider as part of setup (Ollama default, OpenAI, or Anthropic), so that I don't have to configure it later.
6. As a first-time operator, I want the wizard to create the database, run migrations, and start the orchestrator, so that I see a working system at the end of the wizard.
7. As a first-time operator, I want to create my first operator account in the wizard, so that I'm logged in when the TUI opens.
8. As a first-time operator, I want a "time to first plan" under 5 minutes, so that I can demo Cambrian to a colleague in a coffee break.

### Returning operator (daily use)

9. As a returning operator, I want `cambrian` to open the TUI immediately, so that the dashboard is one keystroke away.
10. As a returning operator, I want the TUI to show pending HITL interventions in real time, so that I can approve without leaving the terminal.
11. As a returning operator, I want to see the current plan, active agent, and LLM health in a status strip, so that I know the system state at a glance.
12. As a returning operator, I want `cambrian start` / `stop` / `restart` / `status` / `logs` to manage the orchestrator service, so that I don't need to learn `launchctl` or `systemctl`.
13. As a returning operator, I want the service to auto-restart on crash but not auto-start on boot (by default), so that I have the right balance of resilience and control.
14. As a returning operator, I want `cambrian update` to check for and install a newer CLI version, so that I stay current without a `git pull`.

### SSH / remote

15. As an SSH operator, I want every subcommand to have a `--json` output mode, so that I can script and pipe.
16. As an SSH operator, I want `cambrian status --json` to print a structured report, so that I can grep / jq.
17. As an SSH operator, I want `cambrian tools exec` to work from a non-TTY session, so that I can run a tool in an SSH session.
18. As an SSH operator, I want `cambrian logs --tail 100` to print the last 100 lines and exit, so that I can grep without subscribing.
19. As an SSH operator, I want the TUI to gracefully fail on a non-TTY session with a clear "TTY required" message, so that I get an error, not garbled output.

### CI / scripts

20. As a CI user, I want `cambrian --token <jwt> <subcommand>` to run a one-shot command with a pre-shared token, so that no `cambrian login` is required.
21. As a CI user, I want `CAMBRIAN_TOKEN` env var to be a one-shot token override, so that I can keep tokens out of command lines.
22. As a CI user, I want `cambrian doctor --json` to print a health check as JSON, so that I can gate a deploy.
23. As a CI user, I want `cambrian audit export --format json` to produce a compliance archive, so that I can attach it to a ticket.
24. As a CI user, I want `--reason` to be required for destructive operations, so that I can't accidentally approve-by-default.

### Uninstallation and cleanup

25. As an operator, I want `cambrian uninstall` to remove the CLI, orchestrator, config, and database (with confirmation), so that I can clean up after a test.
26. As an operator, I want `cambrian uninstall --yes` to skip confirmation for scripted cleanup, so that I can run it in a teardown script.

### Operator vs Viewer roles

27. As a Viewer, I want mutating subcommands hidden from `--help` and the TUI, so that I can't accidentally attempt them.
28. As a Viewer, I want a clear "PermissionDenied" error if I script a mutating command, so that I know it's a role issue, not a bug.

### Audit and compliance

29. As a security auditor, I want `cambrian audit list --actor <name>` to filter by user, so that I can review one operator's actions.
30. As a security auditor, I want `cambrian audit export --since ... --until ... --format csv` to produce a spreadsheet-friendly archive, so that I can share it with non-engineers.

---

## 4. The First-Run Experience (critical for the vision)

The first-run experience is the single most important surface in V1. The install script and the setup wizard together deliver the "zero to first plan in 5 minutes" promise.

### Install script (the `curl | sh` step)

The script is ~80 lines of bash. It does the minimum to put the Cambrian binaries on the machine and hand off:

1. Welcome banner.
2. Platform detection (macOS / Linux × arm64 / x64). Refuse Windows.
3. Latest version lookup.
4. Download CLI + orchestrator binaries.
5. Verify SHA256 checksums.
6. Install to `~/.cambrian/bin/`.
7. Update `PATH` in `~/.zshrc` / `~/.bashrc` (idempotent).
8. Telemetry opt-in prompt.
9. Hand off to `cambrian init` (auto-triggered on first `cambrian` invocation).

Total wall time: ~10–20 seconds on a typical connection.

### Setup wizard (the `cambrian init` step, auto-triggered)

The wizard runs as an Ink TUI. It is 8 steps, each skippable, each idempotent, each with a spinner and a plain-English status line:

1. **Welcome** — explain what the wizard will do (3–5 min), `Enter` to continue.
2. **Dependency detection + install** — check for `psql`, `pg_config`, `python3`, `ollama`. Install missing via `brew` / `apt` / `dnf`. Show progress.
3. **Database setup** — create the `cambrian` role + DB. Run `db/migrations/*.sql` in order.
4. **LLM provider choice** — Ollama (default, auto-install + pull `llama3.2:3b`), OpenAI (API key), Anthropic (API key), or "configure later."
5. **Config generation** — write `~/.cambrian/configs/config.json` with safe defaults (generated `secret_key`, db url, llm provider).
6. **Service registration** — generate systemd user unit (Linux) or launchd plist (macOS). Auto-start off. Start the service.
7. **First start + verify** — wait for `OperatorConsole.Snapshot` to return. Show "Cambrian is running."
8. **First operator account + login** — prompt for username + password. Call `OperatorConsole.Login`. Store token in OS keychain. Print the success card.

### Success card (the moment of truth)

```
┌──────────────────────────────────────────────────────────────┐
│  ✓ Cambrian is ready                                          │
│  ───────────────────                                          │
│  Server:    localhost:50051                                   │
│  Database:  postgresql://cambrian@localhost:5432/cambrian      │
│  LLM:       ollama (llama3.2:3b)                              │
│  Operator:  admin                                             │
│  Time:      3m 42s                                            │
│                                                              │
│  Try:                                                         │
│    cambrian                    # launch the TUI                │
│    cambrian chat "summarize"   # run your first plan          │
│    cambrian doctor             # verify everything is healthy  │
│    cambrian help               # see all commands              │
└──────────────────────────────────────────────────────────────┘
```

The user sees this and knows: "I have a working Cambrian." The "Try:" lines are the first taste of the product.

### Failure modes

Every failure shows an actionable message. No stack traces. Always `cambrian doctor` as the next step.

| Failure | Message |
|---|---|
| Unsupported OS | "Cambrian V1 supports macOS and Linux. Windows is coming in V1.1." |
| GitHub unreachable | "Could not reach GitHub. Check your network or install manually: https://cambrian.dev/manual-install" |
| Checksum mismatch | "Binary integrity check failed. Refusing to install. Try again or report at https://github.com/cambrian/cambrian-runtime/issues" |
| Postgres install fails | "Could not install Postgres automatically. Install it manually, then run `cambrian init` again. Docs: https://cambrian.dev/install-postgres" |
| Migrations fail | "Migration 004_hnsw_cosine_and_stored_procedure.sql failed. Run `cambrian doctor` to diagnose. The DB is in a partial state." |
| Ollama pull fails | "Could not pull llama3.2:3b. Check your network or run `ollama pull llama3.2:3b` manually, then `cambrian config set llm.ready true`." |
| Orchestrator doesn't start in 30s | "Orchestrator did not become ready in 30s. Check `cambrian logs` and `cambrian doctor`." |

---

## 5. The 10-Second Demo

A marketing-ready recording of:

1. `curl -fsSL https://cambrian.dev/install.sh | sh` — 12 seconds.
2. Welcome banner + wizard runs through 8 steps — 3–4 minutes.
3. Success card appears.
4. User types `cambrian` — TUI opens.
5. User types a one-line prompt in a chat input — plan executes.
6. User approves a HITL — approval appears in `cambrian audit list`.

This is the asset that goes on the website, in the README, and in the launch announcement.

---

## 6. Operator vs Viewer

The kernel enforces the role server-side (ADR-0047 D13). The CLI reflects it by hiding mutating subcommands from Viewer users:

| Subcommand | Operator | Viewer |
|---|---|---|
| `cambrian approve <id>` | ✓ | hidden |
| `cambrian deny <id>` | ✓ | hidden |
| `cambrian memory write` | ✓ | hidden |
| `cambrian tool grant/revoke` | ✓ | hidden |
| `cambrian audit export` | ✓ | hidden |
| `cambrian status` / `doctor` | ✓ | ✓ |
| `cambrian audit list` / `audit show` | ✓ | ✓ |
| `cambrian tools list` / `skills list` | ✓ | ✓ |
| `cambrian memory query` | ✓ | ✓ |

If a Viewer scripts a mutating command (e.g., `cambrian approve <id>`), the kernel returns `PermissionDenied` and the CLI surfaces a friendly error: "Your role is 'viewer'. This command requires 'operator'."

---

## 7. Out of Scope (V1)

The CLI explicitly does NOT include these in V1. They are listed so the team does not accidentally scope-creep into them.

- **Windows** — V1.1. The install script and service files are macOS + Linux only.
- **Package managers (Homebrew, scoop, chocolatey, winget)** — V1.1. V1 is GitHub Releases only.
- **Linux musl (Alpine)** — V1.1. V1 is glibc-based distros (Debian, Fedora, Ubuntu, macOS).
- **Mobile / iPad / web terminal** — out of scope permanently (the Tauri UI is the cross-platform answer).
- **A marketplace or community plugin loader** — out of scope permanently.
- **Auto-update** — V1 has explicit `cambrian update` only. No background checks.
- **Telemetry beyond install ping** — V1 sends only the install event. No usage metrics, no error reporting.
- **A web-based setup wizard** — the wizard is an Ink TUI. The Tauri UI is the web-based answer for power users.
- **Shell completions** — V1.1.
- **A graphical installer (.dmg, .deb, .rpm)** — V1.1. The install script is the answer.
- **End-user chat** — the CLI is for operators. End-user chat is a separate product concern.

---

## 8. The CLI vs the Tauri UI

The CLI and the Tauri UI are **companions, not competitors**. The split:

| Concern | CLI | Tauri UI |
|---|---|---|
| Install + setup | ✓ | — |
| Daily interactive use | — | ✓ |
| Real-time observation | TUI (terminal panes) | Native desktop app |
| Approval workflow | `cambrian approve <id>` | Click in the chat |
| Memory exploration | `cambrian memory query` | Memory Explorer pane |
| SSH / remote | ✓ | — |
| CI / scripts | ✓ | — |
| Audit access | `cambrian audit list/export` | Audit pane |
| Tool/skill/watches discovery | ✓ | ✓ |
| Update | `cambrian update` | Auto-update (Tauri built-in) |

The CLI is **always** an admin companion. The UI is the canonical interactive surface. They use the same `OperatorConsole` gRPC service, the same auth model, the same event feed, the same audit log. A user can use both interchangeably: start a plan in the UI, approve a HITL from SSH with `cambrian approve <id>`, see the audit entry in the UI's Audit pane.

---

## 9. The Architecture in One Paragraph

The CLI is a TypeScript + Ink v7 single-binary application. It is distributed as a standalone binary built with `bun build --compile` for macOS (arm64, x64) and Linux (x64, arm64). The install is `curl | sh` (CLI-004); the binary installs to `~/.cambrian/bin/` and updates `PATH`. The first `cambrian` invocation auto-triggers the setup wizard (CLI-005) which detects and installs missing system dependencies, sets up the database, registers a service, and logs in the first operator.

The CLI talks to the kernel exclusively through the **`OperatorConsole` gRPC service** (ADR-0047, vendored at `cli/proto/operator.proto`). It does NOT call the agent-facing `Orchestrator` service — except for legitimate agent-plane admin reads (tool/skill/memory/watches listings, tool execution) where the CLI is acting as a privileged operator viewing agent-scope data. Operator concerns (auth, HITL, audit, steering) go through `OperatorConsole` with `authorization: Bearer <token>`; agent concerns go through `Orchestrator` with `x-agent-id`.

The TUI is a fold of the `OperatorConsole.StreamEvents` feed (CLI-008) plus periodic `Snapshot` for ephemeral runtime state (CLI-009). Reconnect is automatic with backoff+jitter. The `ResyncRequired` event triggers a clean re-snapshot. The audit log is read via `QueryAudit` (CLI-010).

The CLI does not bundle the orchestrator binary; the install script downloads both (CLI-003, D11). They are versioned independently; `cambrian --version` reports the CLI, `cambrian status` reports the orchestrator. Updates are explicit (`cambrian update`, D12).

---

## 10. Success Metrics

V1 is successful when:

| Metric | Target | Measurement |
|---|---|---|
| Install time (clean machine → first plan) | < 5 min | Telemetry (D9, opt-in) |
| Install success rate | > 80% | Telemetry |
| 7-day retention | > 40% | Telemetry |
| Crash-free sessions | > 95% | Telemetry |
| `cambrian doctor` reports healthy | > 90% of calls | Telemetry |
| Audit trail completeness | 100% of mutating commands have an `operator_audit` row | Kernel metric |
| Time to first HITL approval from install | < 10 min (includes onboarding) | Telemetry |

The team reviews these weekly during V1 ramp.

---

## 11. Out of Scope (permanent)

- The CLI is not a replacement for the Tauri UI.
- The CLI is not a marketing site, pricing page, or community platform.
- The CLI is not a marketplace or plugin loader.
- The CLI does not implement agent logic; it is a controller over the kernel.
- The CLI does not store domain data (memory, plans, audit) — the kernel does. The CLI is a view + a controller.

---

## 12. Acceptance Criteria (V1 ship)

The CLI ships V1 when:

- [ ] `curl -fsSL https://cambrian.dev/install.sh | sh` works on macOS arm64, macOS x64, Linux x64 (glibc), Linux arm64 (glibc).
- [ ] Install completes in < 30s on a typical connection.
- [ ] Setup wizard completes in < 5 min on a clean machine.
- [ ] 42 existing smoke tests pass; new tests cover all 10 ADRs' acceptance criteria.
- [ ] `tsc --noEmit` clean.
- [ ] Telemetry opt-in works; `CAMBRIAN_TELEMETRY=0` overrides.
- [ ] All 30 user stories above are implemented and testable.
- [ ] README documents the install path, the wizard, the subcommand surface, and the troubleshooting flow.
- [ ] The 10-second demo is recorded and published.
- [ ] `cambrian update` works on all V1 platforms.
- [ ] `cambrian uninstall` cleans up the user-level install completely.
- [ ] No `sudo` is required for any V1 operation (service files are user-level).
- [ ] The CLI and the Tauri UI share the same `operator_audit` table; both can read it.
- [ ] A `cambrian doctor` call returns green on a healthy install.
