# HANDOFF — Cambrian CLI

> Read this first if you are a fresh agent (or future-me) picking up this repo cold. It tells you where the work is, what's done, what's pending, and what to be careful about.

## What this repo is

The standalone CLI/TUI for the **Cambrian orchestrator**. It has migrated out of `cambrian-runtime` (the kernel repo) into its own repository. The kernel stays in `cambrian-runtime`; this repo is the user-facing admin companion + installer.

**Stack:** TypeScript 6 + Ink v7 + React 19 + Bun. gRPC via `@grpc/grpc-js` with embedded proto.

**Audience:** three use cases the Tauri desktop UI does not cover:
1. SSH / remote server admin (no GUI)
2. Scripts and CI pipelines (cron, automation, headless)
3. Emergency inspection on a production box (no deployable UI)

## Source history

The full **47-commit** history of the `cli/` subtree lives on `cambrian-runtime`'s `feature/ui` branch. The 9 most recent commits are this agent's work; the other 38 are from previous agents.

**The 9 most recent (this agent's work):**

| SHA | Phase | What |
|---|---|---|
| `23baf9c3` | Phase 6 | Audit subcommands: list / show / export |
| `341faa76` | Phase 8 fix | Windows keychain (DPAPI), viewer help filter, expiry warning |
| `7043dc15` | Phase 1+8 | Operator-plane dispatch wiring (HITL via `ResolveHITL`, list via `StreamEvents`, login/logout/whoami, role-gate) |
| `0b5ad9c4` | Phase 8 core | OS keychain abstraction (macOS/Linux/Windows-DPAPI/in-memory) + auth orchestration |
| `2a931818` | Phase 1 prep | `openOperatorEventStream` (backoff+jitter reconnect) |
| `b3c39f15` | Phase 1 / cli-15 | Idempotent command protocol: UUID v4 + deterministic v5 for retries, `--reason` resolution, `client-tag` |
| `6e03bb6a` | Phase 1 / cli-12 | `OperatorConsole` client wrapper (16 typed RPCs, Bearer auth, 5s connect / 15s unary) |
| `bc2af51f` | Phase 1 / cli-11 | `embed-proto.ts` to embed both protos (agent + operator) |
| `37b42d4f` | Phase 1 / cli-10 | Vendored `operator.proto` (358 lines, pinned to contract 0047) |

To read the older 38 commits: `cd /home/doruk/Code/cambrian-runtime && git log -- cli/`

## Locked decisions (D1–D12, see `docs/plans/cli-initiative.md`)

The 12 decisions that frame all implementation:

- **D1** Operator-plane adoption (CLI uses `OperatorConsole` for operator concerns; `Orchestrator` for agent-plane reads).
- **D2** Auth model: `cambrian login` (interactive) + `--token` (one-shot) + `CAMBRIAN_TOKEN` (env) + OS keychain (persisted). Precedence: `--token` > env > keychain.
- **D3** Distribution: GitHub Releases only for V1.
- **D4** Install script: `curl -fsSL https://cambrian.dev/install.sh | sh` is the very first impression — design it very well.
- **D5** Onboarding wizard rewrite: 5 steps → 8 steps.
- **D6** Service management: auto-start OFF by default.
- **D7** `cambrian init` does runtime setup; `install.sh` only fetches the CLI binary.
- **D8** First `cambrian` invocation auto-triggers the wizard if no config.
- **D9** Opt-in telemetry.
- **D10** Local Ollama default; API key override.
- **D11** Separate orchestrator binary (kernel ≠ CLI).
- **D12** Explicit `cambrian update`.

## What's done

**Phase 1 (operator-plane adoption, cli-10–15):**
- `OperatorConsole` client wrapper at `src/grpc/operator-client.ts` — 16 typed RPCs, Bearer auth, 5s connect / 15s unary deadlines.
- `openOperatorEventStream` at `src/grpc/operator-streams.ts` — backoff+jitter reconnect, 60s inter-event timeout.
- Idempotent commands: `src/util/command-id.ts` (UUID v4 + deterministic v5 via SHA-1 namespace + canonical-JSON), `src/util/reason.ts` (TTY-aware `--reason`), `src/util/client-tag.ts`.
- `Config.token?: string` from `CAMBRIAN_TOKEN` env; never persisted to `config.json`.
- HITL migrated from `WatchApprovals`/`SubmitApprovalDecision` to `StreamEvents`+`ResolveHITL`.
- Help text updated with new subcommands and global flags.

**Phase 6 (audit):**
- `cambrian audit list [--json] [--actor N] [--action V] [--target-type T] [--target-id ID] [--limit N]`
- `cambrian audit show <command_id>`
- `cambrian audit export [--format json|csv|ndjson] [--output PATH] [--reason TEXT] [--force]`
- 18 unit tests, 7 smoke tests.
- 0600 file mode for export; refuses to overwrite without `--force`.
- `cambrian audit export` requires `--reason` (data exfiltration guard).

**Phase 8 (auth model):**
- `cambrian login [--username U --password P]` — stores `{token, role, username, expiresAt}` in OS keychain per server.
- `cambrian logout` — clears keychain entry.
- `cambrian whoami` — shows server, source, user, role, expiry (never echoes the token).
- `src/util/keychain.ts` — macOS `security`, Linux `secret-tool`, Windows DPAPI (encrypted file at `%LOCALAPPDATA%\cambrian\keychain\`), in-memory for tests.
- Role-gating: `approve` / `deny` are denied at dispatch when role is `viewer`. Viewer help filters mutating subcommands.
- `warnIfExpiringSoon(auth)` — warns to stderr when token expires within 7 days, once per process.

## What's pending (in plan order)

| Phase | Description | Why it's next |
|---|---|---|
| **2** | Distribution: `bun build --compile`, GitHub Actions, `install.sh` | Unblocks sharing the CLI. The install script is the first impression. |
| **3** | Runtime install: Postgres, pgvector, DB migrations, config gen, Ollama auto-install | What the install script does. Depends on Phase 2 binary. |
| **4** | Service management: systemd user unit + launchd plist; `cambrian start|stop|restart|status|logs` | Post-install lifecycle. |
| **5** | Onboarding wizard rewrite (5 → 8 steps) | First-run UX. |
| **7** | Polish: `cambrian uninstall`, `cambrian update`, shell completions (zsh/bash/fish) | Small scope, ships with V1. |

**My pick when asked "what next":** **Phase 2 (Distribution).** It's bounded infrastructure, gates the rest, and the user flagged `install.sh` as a priority.

## Architectural rules (non-negotiable)

1. **Zero-Hardcode Rule.** Routing logic must never appear as Go-style `if-else`/`switch`. The CLI does the same: never branch on tool name, agent ID, or command verb. The LLM (Awareness layer) and the kernel decide; the CLI is a thin surface.
2. **Operator plane ≠ agent plane.** Operator concerns (`OperatorConsole` RPCs) use `authorization: Bearer <token>`. Agent-plane reads (`Orchestrator` RPCs for tools/skills/memory/watches) use `x-agent-id`. Never mix.
3. **Hexagonal separation preserved.** `cli/proto/` is a vendored boundary; `cli/scripts/embed-proto.ts` is the only generator; `cli/src/cambrian-types.ts` is the only hand-written proto interface surface.
4. **No token on disk.** `config.json` never stores the token. Keychain only. `saveConfig` only writes `server` + `operator_id`.

## Known gaps (be careful)

These are honest limitations, not bugs:

1. **Windows keychain (DPAPI)** is implemented but **only path-encoding is unit-tested on Linux**. The actual PowerShell + DPAPI round-trip only runs on Windows. Smoke-test on a Windows box before claiming V1.
2. **`QueryAudit` filter gap.** The ADR-CLI-010's aspirational `--since`/`--until`/`--session` filters do not exist in the actual `QueryAuditRequest` shape (`actor, target_type, target_id, action_type, limit`). Time-range and session-id filtering would need a kernel-side change. Documented in commit `23baf9c3`.
3. **TUI dashboard is unverified.** Ink v7 requires raw mode; no headless test exists in the project. The 4-pane layout (`Approvals | Tools/Watches/Skills`) is a UI guess; test it in a real terminal before shipping.
4. **No live kernel testing in this session.** The smoke tests verify routing, error display, and flag parsing — they match on `gRPC error` / `UNAVAILABLE` since no kernel is running. The end-to-end success paths (login → audit list → resolveHITL) need a real orchestrator.
5. **The 13 noise files in `cambrian-runtime/cli/` from other sessions** (`errors.ts`, `tui/App.tsx`, etc.) are uncommitted and untouched. They are not part of this migration; whoever modified them owns them.

## Verification (run after every change)

```bash
cd ~/Code/cambrian/cli
node_modules/.bin/tsc --noEmit       # must be clean
bun test                              # 81/81 (last verified)
./scripts/test-cli.sh                 # 59/59 (last verified)
bun run build                         # must produce dist/
```

Last verified: 2026-07-02, branch `main` (this repo, fresh init).
Historical verification (cambrian-runtime `feature/ui`, `23baf9c3`): tsc 0 errors, 81/81 unit, 59/59 smoke.

## File map (where things live in this repo)

```
cli/                           <- this repo's root
├── src/
│   ├── index.tsx              # arg routing, subcommand dispatch, all handle*() fns
│   ├── cambrian-types.ts      # hand-written TS interfaces matching both protos
│   ├── proto-embed.ts         # GENERATED, gitignored (proto-embed.ts is regenerated)
│   ├── config.ts              # Config load/save (XDG + local), env-var precedence
│   ├── errors.ts              # gRPC status code → human-readable mapping
│   ├── auth.ts                # login/logout/whoami/resolveToken/resolveAuth/isMutatingRole/warnIfExpiringSoon
│   ├── audit.ts               # queryAudit/findAuditById/formatAuditTable/formatAuditDetail/parseListFlags/parseExportFormat/formatAuditExport/writeExportFile/runExport
│   ├── config.test.ts         # 14 unit tests
│   ├── errors.test.ts         # 12 unit tests
│   ├── auth.test.ts           # 16 unit tests (Phase 8)
│   ├── audit.test.ts          # 18 unit tests (Phase 6)
│   ├── grpc/
│   │   ├── client.ts          # CambrianClient: agent-plane typed wrappers, x-agent-id auth
│   │   ├── operator-client.ts # OperatorClient: operator-plane typed wrappers, Bearer auth
│   │   ├── streams.ts         # openApprovalStream (legacy agent-plane, not used post-cli-14)
│   │   └── operator-streams.ts # openOperatorEventStream (operator-plane, backoff+jitter)
│   ├── tui/                   # Ink v7 components (ApprovalsPane, ToolsPane, etc.)
│   └── util/
│       ├── command-id.ts      # UUID v4 (newCommandId) + v5 (commandIdForRetry)
│       ├── command-id.test.ts
│       ├── reason.ts          # TTY-aware --reason resolution
│       ├── reason.test.ts
│       ├── client-tag.ts      # "cambrian-cli/<version>" x-client-tag header
│       └── keychain.ts        # OS keychain abstraction (darwin/linux/win32/memory)
├── proto/
│   ├── cambrian.proto         # agent-plane (existing)
│   └── operator.proto         # VENDORED from cambrian-runtime/api/proto/operator.proto @ contract 0047
├── scripts/
│   ├── embed-proto.ts         # regenerates src/proto-embed.ts (embeds BOTH protos)
│   └── test-cli.sh            # 59 smoke tests
├── docs/                      # architecture + product + plan (was gitignored in cambrian-runtime)
│   ├── adr/CLI-001..CLI-010.md
│   ├── requirements/cli-prd.md
│   ├── issues/INDEX.md + cli-10..cli-15
│   └── plans/cli-initiative.md
├── package.json
├── tsconfig.json
├── bunfig.toml
├── bun.lock
├── .gitignore
├── README.md
├── CONTEXT.md                 # pre-migration CLI context (will need refresh)
├── PLAN.md                    # original brainstorm
└── HANDOFF.md                 # this file
```

## Open question for the next session

> The `cli/CONTEXT.md` at the repo root is the **pre-Phase-1** context — it describes the CLI as "lightweight admin companion," not the installable full-stack CLI per the locked plan. It needs a rewrite to reflect the new scope: operator-plane adoption, install script, service management, etc.

If you pick up Phase 2 next, you should also rewrite `CONTEXT.md` as part of the work. Do not let the old description mislead a new agent.

## Commit discipline

- One logical change per commit, clear imperative-mood message.
- Body explains *why*, not *what*.
- Do not commit without explicit user request.
- Do not push without explicit user request.
- If a commit fails or hooks reject it, fix and make a new commit — do not amend.
- `AGENTS.md` and `CONTEXT.md` should be updated to reflect reality after each refactor.

## Stop conditions

- Never leave code in a broken state.
- Never claim a file was created/modified unless it actually is on disk (verify with `ls`, `git status`, or `git diff --stat`).
- If the user asks you to do something and you discover a half-baked state, **stop and report it** — do not silently paper over.
- If tsc / unit / smoke / build fails after a change, fix the root cause before claiming done.
