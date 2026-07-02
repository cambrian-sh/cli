# Cambrian CLI

> TypeScript + Ink v7 admin companion and installer for the [Cambrian orchestrator](https://github.com/your-org/cambrian-runtime).

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
![Status: V1 mid-development](https://img.shields.io/badge/Status-V1%20Mid--Development-yellow)

`cambrian` is the terminal client for the Cambrian orchestrator. It is built for three audiences the Tauri desktop UI does not cover:

1. **SSH / remote server admin** — no GUI available, need a terminal client.
2. **Scripts and CI pipelines** — cron jobs, automation, headless boxes.
3. **Emergency inspection** — production debugging where shipping a UI is overkill.

It also doubles as the installer: `cambrian init` bootstraps the runtime (Postgres, pgvector, DB migrations, config generation) once a binary is available on the host.

## Status

**V1 mid-development.** Phases complete: operator-plane adoption (Phase 1), operator auth model (Phase 8), audit read surface (Phase 6). Phases pending: distribution + install script (Phase 2), runtime install (Phase 3), service management (Phase 4), onboarding wizard (Phase 5), polish (Phase 7).

| Surface | State |
|---|---|
| Operator auth (`login`, `logout`, `whoami`, OS keychain) | Stable on macOS/Linux. Windows uses DPAPI-encrypted files at `%LOCALAPPDATA%\cambrian\keychain\` — path-encoding unit-tested on Linux; the actual PowerShell + DPAPI round-trip only runs on Windows. |
| Audit (`list`, `show`, `export`) | Stable. The `QueryAudit` RPC's filter shape does **not** include `--since` / `--until` / `--session` (those are kernel-side gaps). |
| HITL (`approve`, `deny`, `approve list`) | Stable. `command_id` + `--reason` wired; backoff+jitter reconnect on the event stream. |
| TUI dashboard (Ink v7) | Compiles and starts. Unverified against a real kernel — Ink requires raw mode and is not covered by the smoke tests. |
| Standalone binary (`bun build --compile`) | Build script present in `package.json`; not yet built or distributed. |
| Install script (`curl \| sh`) | Not written. Planned for Phase 2. |

For a deeper status (what's done, what's pending, known gaps, commit SHAs), see [HANDOFF.md](./HANDOFF.md). For the locked plan and 12 architectural decisions, see `docs/plans/cli-initiative.md`.

## What it looks like

```
$ cambrian --help
Cambrian CLI — admin interface for the Cambrian orchestrator

Usage: cambrian [command] [args]

Commands:
  cambrian                       Launch interactive TUI dashboard
  cambrian login                 Authenticate to server (stores token in OS keychain)
  cambrian logout                Clear keychain entry for the current server
  cambrian whoami                Show current user, role, and token expiry
  cambrian config                Show resolved configuration
  cambrian status                One-line summary of server state
  cambrian doctor                Diagnose config and server connectivity
  cambrian tools list            List registered system tools
  cambrian skills list           List registered system skills
  cambrian watches list          List reactive watch configs
  cambrian approve <id>          Approve a pending tool request (--reason <text>)
  cambrian deny <id>             Deny a pending tool request (--reason <text>)
  cambrian memory query <text>   Semantic memory search
  cambrian memory write <text>   Write text to long-term memory
  cambrian audit list            List recent audit entries
  cambrian audit show <id>       Show full detail for one entry
  cambrian audit export          Export entries (--format json|csv|ndjson, --reason)

Global flags (must come before the subcommand):
  --config <path>                Use a custom config file
  --server <host:port>           Override the target server
  --token <jwt>                  One-shot operator token (never stored)
```

## Quick start

### From source (today)

```bash
git clone https://github.com/your-org/cambrian-cli.git
cd cambrian-cli
bun install
bun run proto:gen   # regenerate src/proto-embed.ts from proto/
./scripts/test-cli.sh # 59 smoke tests
```

Then either run directly (`bun src/index.tsx --help`) or build a bundle (`bun run build`).

### Standalone binary (Phase 2, not yet released)

```bash
bun run build:bin   # produces dist/cambrian (~10 MB)
./dist/cambrian --help
```

### `curl | sh` install (Phase 2, not yet written)

```bash
curl -fsSL https://cambrian.dev/install.sh | sh
cambrian login
```

This will fetch the right binary for the host's OS/arch, then `cambrian init` will bootstrap the runtime.

## Commands

### Auth (operator plane, Bearer-token auth)

| Command | Description |
|---|---|
| `cambrian login` | Interactive. Prompts for username + password. Stores token in the OS keychain per server. |
| `cambrian login --username <u> --password <p>` | Non-interactive. For scripts that want to log in but can't run a TTY. |
| `cambrian logout` | Clear the keychain entry for the current server. |
| `cambrian whoami` | Show server, source (flag/env/keychain), user, role, token expiry. Never echoes the token. |

### Server (operator plane)

| Command | Description |
|---|---|
| `cambrian approve <id>` | Approve a pending tool request. `--reason <text>` required for destructive actions. |
| `cambrian approve list` | Watch the live HITL stream. `--timeout <s>`, `--json`. |
| `cambrian deny <id>` | Deny a pending tool request. `--reason <text>`. |
| `cambrian audit list` | List recent audit entries. `--json`, `--actor`, `--action`, `--target-type`, `--target-id`, `--limit`. |
| `cambrian audit show <id>` | Show full detail for one entry. |
| `cambrian audit export` | Export entries. `--format json\|csv\|ndjson`, `--output PATH` (mode 0600), `--reason TEXT` (required), `--force`. |

### Server (agent plane, `x-agent-id` auth)

| Command | Description |
|---|---|
| `cambrian tools list` | List registered tools. `--query`, `--k`, `--json`, `--dangerous`, `--safe`. |
| `cambrian tools get <name>` | Show tool schema. `--summary`. |
| `cambrian tools describe <name>` | Human-readable tool details. |
| `cambrian tools exec <name>` | Execute a tool. `--args <json>`, `--file <path>`, `--dry-run`. |
| `cambrian skills list` | List registered skills. `--query`, `--k`, `--json`. |
| `cambrian skills get <name>` | Show skill JSON. `--summary`. |
| `cambrian skills describe <name>` | Human-readable skill instructions. |
| `cambrian watches list` | List reactive watch configs. `--json`, `--active`, `--inactive`. |
| `cambrian watches create <json>` | Create a watch from JSON or `--from-file <path>`. |
| `cambrian watches describe <id>` | Human-readable watch details. |
| `cambrian watches delete <id>` | Delete a watch. |
| `cambrian watches toggle <id>` | Toggle watch active state. |
| `cambrian memory query <text>` | Semantic memory search. `--top-k`, `--json`, `--importance`, `--source`, `--session`. |
| `cambrian memory write <text>` | Write to long-term memory. `--tags`, `--importance`. |

### Config

| Command | Description |
|---|---|
| `cambrian config` | Show resolved configuration. |
| `cambrian config get <key>` | Print a single config value. |
| `cambrian config path` | Print resolved config file path. |
| `cambrian config set <k> <v>` | Set config key (`server`, `operator_id`). |
| `cambrian config edit` | Open config in `$EDITOR` (or vi). |

### Status

| Command | Description |
|---|---|
| `cambrian status` | One-line server summary. `--json`. |
| `cambrian doctor` | Diagnose config + server connectivity. `--json`. |

### TUI

| Command | Description |
|---|---|
| `cambrian` (no args) | Launch the interactive TUI dashboard (Approvals / Tools / Watches / Skills panes). |

## Auth in depth

The CLI uses three identity layers. Pick whichever fits the environment.

| Source | Syntax | Use case | Storage |
|---|---|---|---|
| `--token` flag | `cambrian --token <jwt> approve <id>` | One-shot CI/script invocations. Never stored. | none |
| `CAMBRIAN_TOKEN` env | `CAMBRIAN_TOKEN=eyJ... cambrian approve <id>` | One-shot CI/script invocations. Never stored. | none |
| OS keychain | `cambrian login` (interactive) | Interactive use. Stored per server, encrypted by the OS. | macOS Keychain / Linux Secret Service / Windows DPAPI |

**Precedence:** `--token` > `CAMBRIAN_TOKEN` > keychain. The first match wins.

### Roles

The kernel assigns a role at `Login`:

- **operator** — full access. All subcommands available.
- **viewer** — read-only. Mutating subcommands (`approve`, `deny`) are denied at dispatch and hidden from `--help`. The kernel is the real boundary and will still reject forbidden mutations on the agent plane.

### Token expiry

The CLI checks `expiresAt` on every authenticated invocation. If the token expires within **7 days** (or is already expired), a one-time warning is emitted to stderr:

```
Warning: token expires in 3 day(s) (2026-07-05). Run `cambrian login` to refresh.
Warning: token expired on 2026-07-02. Run `cambrian login` to refresh.
```

## Configuration

**Precedence:** env vars > `--config <path>` > `~/.config/cambrian/config.json` > `./config.json` > defaults.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `CAMBRIAN_SERVER` | `localhost:50051` | gRPC server address. |
| `CAMBRIAN_OPERATOR_ID` | `$USER` | Identity for HITL approvals. |
| `CAMBRIAN_TOKEN` | — | One-shot operator token. Overrides keychain. |
| `CAMBRIAN_PROTO_PATH` | — | Override proto file location (rare; only for development). |

### Config file

`~/.config/cambrian/config.json`:

```json
{ "server": "localhost:50051", "operator_id": "admin" }
```

**The token is never written to `config.json`.** It lives in the OS keychain.

## Architecture

The CLI talks to the kernel over two distinct gRPC surfaces. **Never mix them.**

### Operator plane — `OperatorConsole`

For human operators. Uses `authorization: Bearer <token>`. Used for:

- `Login`, `Snapshot`, `StreamEvents`, `QueryAudit`
- `ResolveHITL`, `SetToolGrant`, `PauseSession`, `ResumeSession`
- `TagMemory`, `SetScope`, `RegisterSkill`, `RegisterMCP`
- `TriggerConsolidation`, `CreateSession`, `SendMessage`, `InjectCorrection`

### Agent plane — `Orchestrator`

For agent identities. Uses `x-agent-id: <operatorId>`. Used for:

- `ListTools`, `GetTool`, `ExecuteTool`
- `ListSkills`, `GetSkill`
- `ListWatches`, `CreateWatch`, `DeleteWatch`, `ToggleWatch`
- `QueryMemory`, `WriteMemory`

The two planes have different authentication, different authorization, and different observability (only operator-plane actions are written to the `operator_audit` table).

### Zero-Hardcode Rule

The CLI never branches on tool name, agent ID, or command verb. The kernel decides what gets done; the CLI is a thin surface that translates user intent into gRPC calls.

## Building

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.3
- TypeScript 6 (installed via devDependencies)
- Network access to the kernel's gRPC port (default `localhost:50051`) for runtime testing

### Commands

| Script | Purpose |
|---|---|
| `bun run dev` | Hot-reload dev mode. |
| `bun run build` | Bundle to `dist/index.js` (Node.js target). |
| `bun run build:bin` | Compile to standalone `dist/cambrian` binary. |
| `bun run proto:gen` | Regenerate `src/proto-embed.ts` from `proto/`. |
| `bun test` | Run unit tests (81 tests, no server needed). |
| `bun run test:smoke` | Run smoke tests (59 tests, no server needed). |
| `node_modules/.bin/tsc --noEmit` | Type-check. Must be clean. |

## Testing

### Unit tests (`bun test`)

81 tests. No server needed. Covers:

- Config load/save, env-var precedence (14 tests)
- gRPC error → human-readable mapping (12 tests)
- Command-ID generation, UUID v4 + deterministic v5 for retries (10 tests)
- `--reason` resolution (4 tests)
- OS keychain path encoding (2 tests)
- Operator auth: token precedence, role mapping, whoami, expiry warning, formatWhoami (22 tests)
- Audit: flag parsing, format parsing, table/detail/export, CSV escaping, mode 0600 file write (18 tests)

### Smoke tests (`./scripts/test-cli.sh`)

59 tests. No server needed. Verifies CLI behavior end-to-end (routing, error display, flag parsing, help text, config detection). Matches on `gRPC error` / `UNAVAILABLE` since the server is not running.

### What the tests don't cover

- gRPC server responses (no mock server in this codebase)
- TUI rendering (Ink v7 requires raw mode; no headless test setup)
- Live operator auth against a real kernel (the auth flow is unit-tested but the round-trip needs a running `OperatorConsole.Login`)
- The actual PowerShell + DPAPI round-trip on Windows (only path-encoding is tested on Linux)

These need a real orchestrator or a purpose-built test harness.

## Project layout

```
cambrian-cli/
├── src/
│   ├── index.tsx              # arg routing, subcommand dispatch
│   ├── cambrian-types.ts      # hand-written TS interfaces for both protos
│   ├── config.ts              # config load/save, env-var precedence
│   ├── errors.ts              # gRPC status code → human-readable mapping
│   ├── auth.ts                # login/logout/whoami/role/expiry warning
│   ├── audit.ts               # audit list/show/export
│   ├── grpc/
│   │   ├── client.ts          # agent-plane CambrianClient (x-agent-id)
│   │   ├── operator-client.ts # operator-plane OperatorClient (Bearer)
│   │   ├── streams.ts         # legacy agent-plane (unused post-cli-14)
│   │   └── operator-streams.ts # operator-plane event stream (backoff+jitter)
│   ├── tui/                   # Ink v7 dashboard components
│   └── util/
│       ├── command-id.ts      # UUID v4 (newCommandId) + v5 (commandIdForRetry)
│       ├── reason.ts          # TTY-aware --reason resolution
│       ├── client-tag.ts      # x-client-tag metadata
│       └── keychain.ts        # OS keychain (macOS/Linux/Windows-DPAPI/memory)
├── proto/
│   ├── cambrian.proto         # agent-plane (vendored)
│   └── operator.proto         # operator-plane (vendored, contract 0047)
├── scripts/
│   ├── embed-proto.ts         # embeds both protos into src/proto-embed.ts
│   └── test-cli.sh            # 59 smoke tests
├── docs/                      # architecture + product + plan
│   ├── adr/                   # 10 ADRs (CLI-001..CLI-010)
│   ├── requirements/cli-prd.md
│   ├── issues/                # INDEX + Phase 1 tickets
│   └── plans/cli-initiative.md
├── package.json
├── tsconfig.json
├── bunfig.toml
├── .gitignore
├── README.md
├── HANDOFF.md                 # authoritative "where we are" for fresh agents
├── PLAN.md                    # original brainstorm
└── LICENSE                    # Apache 2.0
```

## Contributing

This is an early-phase project. The locked plan in `docs/plans/cli-initiative.md` lists all 12 architectural decisions and the 8 implementation phases. The freshest "what's done / what's pending" is in [HANDOFF.md](./HANDOFF.md).

Before opening a PR:

- `node_modules/.bin/tsc --noEmit` must be clean.
- `bun test` must pass (81/81).
- `./scripts/test-cli.sh` must pass (59/59).
- One logical change per commit, imperative-mood message, body explains *why*.
- Do not push without an explicit maintainer request.
- Do not amend a commit that was rejected by hooks — fix and make a new commit.

## License

[Apache License 2.0](./LICENSE) — Copyright 2026 Cambrian Authors.

## See also

- [Cambrian kernel](https://github.com/your-org/cambrian-runtime) — the orchestrator this CLI talks to.
- [HANDOFF.md](./HANDOFF.md) — fresh-agent context, commit SHAs, known gaps, pending phases.
- [docs/plans/cli-initiative.md](./docs/plans/cli-initiative.md) — the locked 12 decisions and 8 implementation phases.
- [docs/adr/](./docs/adr/) — 10 architecture decision records.
- [docs/requirements/cli-prd.md](./docs/requirements/cli-prd.md) — product requirements.
