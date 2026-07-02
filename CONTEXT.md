# Cambrian CLI — Context

> **Scope:** This document is the authoritative context for the `cli/` TypeScript + Ink v7 admin companion. It is **not** the canonical Cambrian context — see `../CONTEXT.md` for the orchestrator. For a usage walkthrough, see `README.md`. For the original brainstorm, see `PLAN.md`.

## 1. Purpose

The CLI is a **lightweight admin companion** for the Cambrian orchestrator, complementary to the Tauri desktop UI in `../ui/`. It targets three use cases the Tauri UI does not:

1. **SSH / remote servers** — no GUI available, need a terminal client.
2. **Scripts & automation** — cron jobs, CI pipelines, shell hooks that need to read state or trigger actions.
3. **Headless ops** — emergency inspection on a production box where the Tauri UI cannot be deployed.

The CLI is **not** an operator console clone. The Tauri UI is canonical for interactive operator work; the CLI is a thin surface for everything else.

## 2. Architecture

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript 6.0+ | First-class React/Ink support, matches Tauri UI stack |
| TUI | Ink v7 + React 19 | Composable, themeable, easy to test |
| Transport | `@grpc/grpc-js` + `@grpc/proto-loader` | No codegen step; proto loaded at build time |
| Runtime | Bun (preferred) / Node 20+ | Fast install, native TS, no transpile step |
| Build | `bun build --target node` | Single-file bundle, ~2 MB |
| Tests | `bun test` (unit) + bash smoke tests (integration) | No test framework lock-in |

**Zero-hardcode for transports:** the CLI never hardcodes gRPC method paths in React components. All RPCs go through `src/grpc/client.ts` which wraps `@grpc/grpc-js`.

**No system protoc:** the proto file is embedded as a TypeScript string constant at build time via `scripts/embed-proto.ts`. The CLI writes it to a temp file at runtime and loads it via `proto-loader`. This keeps the CLI a single artifact with no native build chain.

## 3. Module Structure

```
cli/
├── src/
│   ├── index.tsx              # Entry: arg routing, subcommand dispatch, all handle*() fns
│   ├── cambrian-types.ts      # Hand-written TS interfaces matching the proto (compile-time safety)
│   ├── proto-embed.ts         # Generated: proto as a TS string constant (gitignored)
│   ├── config.ts              # Config load/save (XDG + local), env-var precedence
│   ├── errors.ts              # gRPC status code → human-readable error mapping
│   ├── config.test.ts         # 14 unit tests (config load/save, env precedence, --config flag)
│   ├── errors.test.ts         # 12 unit tests (gRPC codes 0-16, Node socket errors)
│   ├── grpc/
│   │   ├── client.ts          # CambrianClient: typed wrappers, 5s connect / 15s unary deadlines
│   │   └── streams.ts         # openApprovalStream: server-streaming w/ reconnect
│   └── tui/
│       ├── index.tsx          # TUI shell: routes to Onboarding or App
│       ├── App.tsx            # 4-pane layout, global keybindings
│       ├── Onboarding.tsx     # 5-step first-run wizard
│       ├── ApprovalsPane.tsx  # Left pane: pending HITL requests (live)
│       ├── ToolsPane.tsx      # Right pane 1: registered system tools
│       ├── WatchesPane.tsx    # Right pane 2: reactive watch configs
│       ├── SkillsPane.tsx     # Right pane 3: registered system skills
│       └── StatusBar.tsx      # Bottom: server status, operator, focus
├── scripts/
│   ├── embed-proto.ts         # Reads ../proto/cambrian.proto → src/proto-embed.ts
│   └── test-cli.sh            # 42 smoke tests (no server needed)
├── proto/cambrian.proto       # Symlink → ../proto/cambrian.proto
├── generated/                 # pbjs/pbts output (gitignored)
├── dist/                      # bun build output (gitignored)
├── package.json
├── tsconfig.json              # Excludes src/**/*.test.ts from main build
├── bunfig.toml                # No test preload (broke bun test)
├── README.md                  # Usage: commands, TUI controls, testing
├── PLAN.md                    # Original brainstorm
└── CONTEXT.md                 # This file
```

**Note:** `src/commands/`, `src/components/`, `src/hooks/` are empty placeholder directories reserved for a future refactor (split `index.tsx` into per-command modules + extract reusable TUI components + add React hooks). Current code lives in `index.tsx` for simplicity.

## 4. Subcommand Surface

| Subcommand | Purpose | Key flags |
|---|---|---|
| `tools list` | List registered tools | `--query` (semantic), `--k` (limit), `--json`, `--dangerous`/`--safe` |
| `tools get <name>` | Show tool schema | `--summary` (description only) |
| `tools describe <name>` | Human-readable tool details | — |
| `tools exec <name>` | Execute a tool | `--args <json>`, `--file <path>`, `--session`, `--step`, `--dry-run` |
| `skills list` | List registered skills | `--query`, `--k`, `--json` |
| `skills get <name>` | Show skill JSON | `--summary` |
| `skills describe <name>` | Human-readable skill details | — |
| `watches list` | List reactive watches | `--json`, `--active`/`--inactive` |
| `watches create` | Create a watch | `--from-file <path>` (or positional JSON) |
| `watches describe <id>` | Human-readable watch details | — |
| `watches delete <id>` | Delete a watch | — |
| `watches toggle <id>` | Toggle watch active state | — |
| `approve <id>` | Approve a pending request | — |
| `approve list` | Watch approval stream | `--timeout <s>` (default 5) |
| `deny <id>` | Deny a pending request | — |
| `memory query <text>` | Semantic memory search | `--top-k`, `--json`, `--importance`, `--source`, `--session` |
| `memory write <text>` | Write to long-term memory | `--tags`, `--importance` |
| `status` | One-line server summary | `--json` |
| `doctor` | Diagnose config + connectivity | `--json` |
| `config` | Show resolved configuration | — |
| `config get <key>` | Print a single config value | — |
| `config path` | Print resolved config file path | — |
| `config set <k> <v>` | Set a config key | — |
| `config edit` | Open config in `$EDITOR` | — |

**No-arg `cambrian` launches the TUI.** With no config, the onboarding wizard runs first.

## 5. TUI Layout

```
┌──────────────────────────┬──────────────────────────┐
│                          │  TOOLS (1)               │
│  APPROVALS               │  ────────                │
│  ─────────               │  > shell-exec    ⚠ YES  │
│  > [pending HITL...]     │    read_file     ✓ safe  │
│  y approve  n deny       │    write_file    ⚠ YES  │
│                          ├──────────────────────────┤
│                          │  WATCHES (2)             │
│                          │  ────────                │
│                          │  > git-push      ● ON    │
│                          │    log-rotate    ○ OFF   │
│                          │  Space toggle  d delete │
├──────────────────────────┼──────────────────────────┤
│                          │  SKILLS (3)              │
│  (focus)                 │  ────────                │
│                          │  > daily-summary         │
│                          │    code-review           │
│                          │                          │
├──────────────────────────┴──────────────────────────┤
│  ● server:reachable  op:admin  focus:Approvals  ? help  q quit │
└─────────────────────────────────────────────────────┘
```

**Keybindings:** `Tab` cycle focus, `1/2/3/4` jump to pane, `↑/↓` navigate, `y/n` approve/deny, `Space` toggle watch, `d` delete watch, `r` refresh, `Enter` expand, `?` help overlay, `q` quit confirm.

**Onboarding (first run):** 5-step wizard — welcome → server → operator → test → save. Enter on welcome step instead of arrow key (UX fix).

## 6. Configuration

**Priority:** env vars > `--config <path>` > `~/.config/cambrian/config.json` > `./config.json` > defaults

**Keys:**
- `server` — gRPC server address (default: `localhost:50051`)
- `operator_id` — identity for HITL approvals (default: `$USER`)

**Env vars (override config file):**
- `CAMBRIAN_SERVER`
- `CAMBRIAN_OPERATOR_ID`
- `CAMBRIAN_PROTO_PATH` — override proto file location (rare; only for development)

The CLI never writes to a config file silently — `config set` and `config edit` are the only write paths. `mkdir -p` is done on save if the parent directory doesn't exist.

## 7. gRPC Client

`src/grpc/client.ts` exposes a `CambrianClient` interface with typed wrappers for every RPC. Key design choices:

- **5s connect timeout** — fast failure when the server is down.
- **15s unary deadline** — prevents hung RPCs from blocking the CLI.
- **Metadata cloning** — safe for concurrent streams; prevents cross-request pollution.
- **Embedded proto** — the proto is read from `src/proto-embed.ts` (generated) and written to `os.tmpdir()` at runtime; `proto-loader` reads from the temp file.
- **Hand-written TS interfaces** (`cambrian-types.ts`) — `proto-loader` is untyped by default; hand-written interfaces give compile-time safety. Proto field names must match exactly: `x-tool-query`, `x-tool-k`, `Operator ID` (proto) vs `operator_id` (config JSON).

**Streaming:** `src/grpc/streams.ts` handles the `WatchApprovals` server stream with exponential backoff reconnect. `ChatStream` / `SignalStream` are bidi streams and are **not** used by the CLI (Tauri UI handles those).

## 8. Error Display

`src/errors.ts` maps gRPC status codes (0-16) and Node socket errors to human-readable strings. No stack traces in CLI output. Exit codes:
- `0` — success
- `1` — generic failure (server unreachable, gRPC error, bad args)
- `2` — reserved (config-not-found shows hint, not exit)

## 9. Testing

| Layer | Tool | Count | Notes |
|---|---|---|---|
| Unit | `bun test` | 26 | config (14) + errors (12); no server needed |
| Smoke | `scripts/test-cli.sh` | 42 | bash; no server needed; verifies CLI behavior end-to-end |
| Type | `tsc --noEmit` | — | must be clean |
| Build | `bun run build` | — | must produce `dist/index.js` |

**Smoke tests assume server is down** — they match on strings like `gRPC error`, `UNAVAILABLE`, `Tool not found`, `Watch not found`, `Memory written`, `config edit`. This lets CI verify the CLI's error handling without spinning up a mock gRPC server.

**What the tests don't cover:**
- gRPC server responses (no mock server in this codebase)
- TUI rendering (no headless Ink test setup — Ink requires raw mode)
- Streaming RPCs (WatchApprovals reconnect logic)

These need a running orchestrator or a purpose-built test harness.

## 10. Known Limitations

- **No TUI test coverage** — Ink requires raw mode; CI smoke tests skip TUI paths.
- **No mock gRPC server** — smoke tests verify error paths but not success paths.
- **`src/commands/`, `src/components/`, `src/hooks/` empty** — `index.tsx` is ~800 lines and growing; a refactor to split per-command modules is planned but not done.
- **No streaming for `ChatStream` / `SignalStream`** — Tauri UI owns those surfaces.
- **No interactive approval flow** — `cambrian approve` requires an ID; TUI's ApprovalsPane is the interactive path.
- **English-only** — no i18n.

## 11. Development Workflow

```bash
cd cli
bun install
bun run proto:gen   # regenerate src/proto-embed.ts from proto/cambrian.proto
bun run build       # bundle to dist/index.js
bun run test        # 26 unit tests
./scripts/test-cli.sh   # 42 smoke tests
```

**After changing the proto:** run `bun run proto:gen`, then update `src/cambrian-types.ts` to match new field names.

**After changing a subcommand:** update the help text in `src/index.tsx`, add a smoke test in `scripts/test-cli.sh`, update `README.md`.

**After a refactor:** update this file and the main `../CONTEXT.md` / `../CURRENT_CODEBASE_STATE.md` (brief mention only — keep main docs clean).

**Commit discipline:** one logical change per commit, clear message. Branch: `feature/ui`. Currently 33 commits ahead of `origin/feature/ui`.

## 12. Style

- **Tone:** terse, no fluff (`caveman` mode).
- **Commits:** imperative mood, body explains *why* not *what*.
- **Error messages:** human-readable, no stack traces.
- **Code:** match existing patterns; no type suppression (`as any` / `@ts-ignore` forbidden).
- **No emojis** unless the user asks.

## 13. Pointers

- **Usage walkthrough:** `README.md`
- **Original brainstorm:** `PLAN.md`
- **Main Cambrian context:** `../CONTEXT.md`
- **Main Cambrian state:** `../CURRENT_CODEBASE_STATE.md`
- **Canonical operator UI:** `../ui/` (Tauri + Rust + TS)
- **Proto source:** `../proto/cambrian.proto`
