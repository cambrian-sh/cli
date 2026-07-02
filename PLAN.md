# Cambrian CLI/TUI — Implementation Plan

## Overview

A TypeScript + Ink terminal interface for the Cambrian orchestrator. Provides both an interactive multi-pane dashboard (TUI) and non-interactive subcommands for scripting. Connects to the Go gRPC server via `@grpc/grpc-js` with full streaming support.

**V1 scope**: Admin + Approvals plane — watch CRUD, live approval stream, tool registry.

---

## Architecture Decisions

| Decision | Choice | Rationale |
|:---|:---|:---|
| Language | TypeScript | User choice |
| UI framework | Ink (React for CLI) | Rich component model, familiar DX |
| gRPC client | `@grpc/grpc-js` | Native streaming (ChatStream, WatchApprovals) |
| Proto typing | `ts-proto` codegen | Typed TS interfaces from `.proto` at build time |
| Package manager | `bun` | Fast, matches `bun.lock` in `www/` |
| Operator identity | Static from env/config | `CAMBRIAN_OPERATOR_ID` env var or `cli/config.json` |
| Layout | Multi-pane dashboard | Matches README sketch, best for observability |
| Subcommands | TUI + non-interactive | `cambrian` → TUI, `cambrian <cmd>` → stdout |

---

## Project Structure

```
cli/
├── package.json
├── tsconfig.json
├── bunfig.toml
├── proto/                          # symlink or copy of api/proto/cambrian.proto
├── generated/                      # ts-proto output (gitignored)
│   └── cambrian.ts                 # typed message classes + service stubs
├── src/
│   ├── index.tsx                   # Entry: arg routing → TUI or subcommand
│   ├── config.ts                   # Load server addr + operator ID
│   │
│   ├── grpc/
│   │   ├── client.ts              # gRPC channel setup, metadata (x-agent-id)
│   │   ├── services.ts            # Typed service client factories
│   │   └── streams.ts             # Stream lifecycle (open, reconnect, close)
│   │
│   ├── hooks/
│   │   ├── useApprovals.ts        # WatchApprovals stream → React state
│   │   ├── useTools.ts            # ListTools → React state
│   │   ├── useWatches.ts          # Watch CRUD → React state
│   │   └── useConnection.ts       # Connection health polling
│   │
│   ├── components/
│   │   ├── App.tsx                # Root: layout + pane focus management
│   │   ├── StatusBar.tsx          # Bottom: connection, operator, mode
│   │   ├── ApprovalsPane.tsx      # Live approval stream + y/n actions
│   │   ├── ToolsPane.tsx          # Tool registry table
│   │   ├── WatchesPane.tsx        # Watch CRUD table + actions
│   │   └── ui/                    # Shared primitives
│   │       ├── Pane.tsx           # Bordered pane wrapper with title
│   │       ├── Table.tsx          # Sortable, selectable table
│   │       ├── Badge.tsx          # Status badges (● ON / ○ OFF, ⚠ dangerous)
│   │       └── KeyHint.tsx        # Keyboard shortcut hints
│   │
│   └── commands/                   # Non-interactive subcommands
│       ├── tools.ts               # cambrian tools list
│       ├── watches.ts             # cambrian watches list|create|delete|toggle
│       ├── approve.ts             # cambrian approve <id>
│       ├── deny.ts                # cambrian deny <id>
│       └── memory.ts              # cambrian memory query <text>
│
└── README.md
```

---

## Build Pipeline

```
cambrian.proto ──→ ts-proto ──→ generated/cambrian.ts
                                      │
                                      ▼
                              src/ imports typed
                              messages + service stubs
```

**Scripts in `package.json`:**

| Script | Command | Purpose |
|:---|:---|:---|
| `proto:gen` | `protoc --ts_proto_out=generated --plugin=protoc-gen-ts_proto=node_modules/ts-proto/protoc-gen-ts_proto proto/cambrian.proto` | Generate TS from proto |
| `dev` | `bun run --hot src/index.tsx` | Hot-reload during development |
| `build` | `bun build src/index.tsx --outdir dist --target node` | Production build |
| `start` | `bun dist/index.js` | Run production build |

---

## V1 Feature Breakdown

### 1. gRPC Client Layer (`src/grpc/`)

**`client.ts`** — Single function that creates a gRPC channel to the orchestrator:
- Reads server address from `CAMBRIAN_SERVER` env (default: `localhost:50051`)
- Attaches `x-agent-id` metadata from `CAMBRIAN_OPERATOR_ID` (default: hostname)
- Exports typed client instances for `Orchestrator` service
- Handles reconnection on channel state changes

**`streams.ts`** — Manages long-lived streaming RPCs:
- `openApprovalStream()` → calls `WatchApprovals()`, yields `ApprovalRequest` objects
- Auto-reconnect on stream error with exponential backoff (1s → 2s → 4s → 8s cap)
- Clean shutdown on SIGINT/SIGTERM

### 2. Approvals Pane (`ApprovalsPane.tsx`)

The headline feature. Streams pending dangerous-tool approval requests in real-time.

**Data flow:**
```
WatchApprovals() stream
    → useApprovals() hook (accumulates into state array)
        → ApprovalsPane renders each pending request:
            ┌──────────────────────────────────────┐
            │ ⚠ PENDING  req-a1b2c3                │
            │   Agent:  code-generator              │
            │   Tool:   shell-exec                  │
            │   Args:   rm -rf /tmp/build/*         │
            │   [y] approve   [n] deny              │
            └──────────────────────────────────────┘
```

**Actions:**
- `y` on selected approval → `SubmitApprovalDecision({ id, approve: true, approver_id })`
- `n` on selected approval → `SubmitApprovalDecision({ id, approve: false, approver_id })`
- `j/k` or arrow keys to navigate between pending approvals
- Approved/denied items slide out with a green/red flash, then remove after 2s

### 3. Tools Pane (`ToolsPane.tsx`)

Read-only registry of available system tools.

**Data flow:**
```
ListTools() → useTools() hook → ToolsPane renders table
```

**Display:**
```
┌──────────────────────────────────────────────────────┐
│  TOOLS REGISTRY                                      │
│                                                      │
│  Name            Dangerous   Description             │
│  ──────────────  ──────────  ─────────────────────── │
│  shell-exec      ⚠  YES      Execute shell commands  │
│  file-read       ✓  safe     Read file contents      │
│  file-write      ⚠  YES      Write to filesystem     │
│  web-fetch       ✓  safe     Fetch URL contents      │
│  db-query        ⚠  YES      Execute SQL query       │
│                                                      │
│  [r] refresh   [enter] view schema                   │
└──────────────────────────────────────────────────────┘
```

- Refreshes on `r` keypress
- `enter` on a tool expands to show its JSON Schema

### 4. Watches Pane (`WatchesPane.tsx`)

Full CRUD for reactive watch configurations (ADR-0032).

**Data flow:**
```
ListWatches() → useWatches() hook → WatchesPane renders table
User actions → RegisterWatch / DeleteWatch / SetWatchActive RPCs
```

**Display:**
```
┌──────────────────────────────────────────────────────────────────┐
│  WATCHES                                                         │
│                                                                  │
│  ID       Name           Source          Active   Action         │
│  ───────  ─────────────  ──────────────  ───────  ───────────── │
│  w-abc1   Error Alert    nats://logs     ● ON     dispatch_agent │
│  w-def2   Daily Digest   cron://03:00    ○ OFF    ingest         │
│  w-ghi3   Deploy Watch   nats://deploy   ● ON     start_plan     │
│                                                                  │
│  [n] new   [d] delete   [space] toggle   [e] edit               │
└──────────────────────────────────────────────────────────────────┘
```

**Actions:**
- `space` → `SetWatchActive({ id, active: !current })`
- `d` → `DeleteWatch({ id })` with confirmation prompt
- `n` → opens a form for `RegisterWatch` (name, source, condition, action)
- `e` → edit existing watch (same form, pre-filled)

### 5. Status Bar (`StatusBar.tsx`)

Persistent bottom bar across all panes:

```
● localhost:50051  ● Connected  ● Operator: doruk  ● Approvals: 2 pending
```

- Connection dot: green (connected), yellow (reconnecting), red (disconnected)
- Pending approval count badge (flashes on new approval)

### 6. App Shell (`App.tsx`)

Root component managing layout and pane focus:

```
┌─────────────────────────┬──────────────────────────────────┐
│                         │                                  │
│    APPROVALS LIVE       │         TOOLS REGISTRY           │
│    (focusable)          │         (focusable)              │
│                         │                                  │
├─────────────────────────┴──────────────────────────────────┤
│                       WATCHES                              │
│                     (focusable)                            │
├────────────────────────────────────────────────────────────┤
│  ● localhost:50051  ● Connected  ● Operator: doruk         │
└────────────────────────────────────────────────────────────┘
```

**Key bindings (global):**
| Key | Action |
|:---|:---|
| `Tab` | Cycle focus between panes |
| `1` / `2` / `3` | Jump to Approvals / Tools / Watches |
| `q` | Quit (with confirmation if approvals pending) |
| `?` | Toggle help overlay |

---

## Non-Interactive Subcommands

These bypass Ink entirely and print to stdout. Useful for scripting, CI, and quick lookups.

| Command | gRPC Call | Output |
|:---|:---|:---|
| `cambrian tools list` | `ListTools()` | Table: name, dangerous, description |
| `cambrian tools get <name>` | `ListTools()` + filter | JSON schema for one tool |
| `cambrian watches list` | `ListWatches()` | Table: id, name, source, active, action |
| `cambrian watches create` | `RegisterWatch()` | Interactive prompts → created ID |
| `cambrian watches delete <id>` | `DeleteWatch()` | Confirmation → deleted |
| `cambrian watches toggle <id>` | `SetWatchActive()` | Toggled state |
| `cambrian approve <id>` | `SubmitApprovalDecision()` | Approved |
| `cambrian deny <id>` | `SubmitApprovalDecision()` | Denied |
| `cambrian memory query <text>` | `QueryMemory()` | Table: score, text preview, metadata |

**Routing logic in `index.tsx`:**
```
if (args.length === 0) → launch TUI (Ink)
else → route to subcommand handler (plain stdout)
```

---

## Configuration

**`cli/config.json`** (optional, gitignored):
```json
{
  "server": "localhost:50051",
  "operator_id": "doruk"
}
```

**Environment overrides** (take priority):
| Variable | Default | Purpose |
|:---|:---|:---|
| `CAMBRIAN_SERVER` | `localhost:50051` | gRPC server address |
| `CAMBRIAN_OPERATOR_ID` | `os.hostname()` | Operator identity for approvals |

---

## Dependencies

| Package | Purpose |
|:---|:---|
| `ink` | React renderer for CLI |
| `react` | Component model |
| `@grpc/grpc-js` | gRPC client with streaming |
| `ts-proto` | Proto → TypeScript codegen |
| `ink-table` | Table rendering for Ink |
| `ink-text-input` | Text input for forms |
| `ink-select-input` | Selection menus |
| `yargs` | Subcommand routing (non-TUI mode) |

**Dev dependencies:**
| Package | Purpose |
|:---|:---|
| `typescript` | Type checking |
| `@types/react` | React types |
| `bun-types` | Bun runtime types |

---

## Implementation Order

### Phase 1 — Foundation (do first)
1. `cli/` project scaffold: `package.json`, `tsconfig.json`, proto symlink
2. `ts-proto` codegen pipeline: `proto:gen` script producing `generated/cambrian.ts`
3. `src/grpc/client.ts`: connection factory with metadata
4. `src/config.ts`: env + JSON config loading
5. `src/index.tsx`: entry point with TUI/subcommand routing

### Phase 2 — TUI Shell
6. `src/components/ui/`: Pane, Table, Badge, KeyHint primitives
7. `src/components/StatusBar.tsx`: connection + identity display
8. `src/components/App.tsx`: 3-pane layout with Tab focus cycling

### Phase 3 — Approvals (headline feature)
9. `src/hooks/useApprovals.ts`: WatchApprovals stream hook
10. `src/components/ApprovalsPane.tsx`: live list + y/n actions
11. `src/commands/approve.ts` + `deny.ts`: non-interactive approval commands

### Phase 4 — Tools
12. `src/hooks/useTools.ts`: ListTools hook
13. `src/components/ToolsPane.tsx`: registry table + schema viewer
14. `src/commands/tools.ts`: `tools list` and `tools get` subcommands

### Phase 5 — Watches
15. `src/hooks/useWatches.ts`: Watch CRUD hook
16. `src/components/WatchesPane.tsx`: table + toggle/delete/new actions
17. `src/commands/watches.ts`: `watches list|create|delete|toggle` subcommands

### Phase 6 — Polish
18. `src/commands/memory.ts`: `memory query` subcommand
19. Help overlay (`?` key)
20. Reconnection UX in StatusBar
21. README with usage examples

---

## Open Questions (for future phases)

- **V2 scope**: Chat + Execution plane — ChatStream-based task submission, live plan topology rendering, HITL intervention overlays
- **Session management**: Should the CLI support `cambrian session list` / `cambrian session resume`?
- **Artifact browsing**: `cambrian artifacts list --session <id>` with content preview?
- **Watch form UX**: The `RegisterWatch` message has 12+ fields. How much should the interactive form expose vs. a JSON file import?
