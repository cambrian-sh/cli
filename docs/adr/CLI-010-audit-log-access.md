# CLI-010 — Audit Log Access

**Date:** 2026-06-25
**Status:** Accepted
**Author:** CLI initiative
**Depends on:** CLI-001 (operator plane), CLI-007 (idempotent commands — populates the audit log)
**Relates to:** Compliance / SOC2 / operator accountability

---

## Context

`OperatorConsole` writes every mutating command to a durable `operator_audit` table (Postgres, per ADR-0047 D15). Each row records:

- `command_id` (UUID, UNIQUE — for idempotency dedup)
- `actor` (username from JWT)
- `role` (`operator` or `viewer`)
- `command` (the verb: `approve`, `deny`, `tool_grant`, etc.)
- `args` (JSON-serialized arguments)
- `reason` (the `--reason` text, or `null`)
- `result` (the `CommandAck` result, or `deduped: true`)
- `created_at` (timestamp)
- `client` (e.g., `"cambrian-cli/0.2.0"`, `"tauri-ui/0.5.0"`)

This audit log is the kernel's source of truth for "who did what when." The current CLI has no way to read it. CLI-007 populates it; this ADR exposes it.

The query RPC is `OperatorConsole.QueryAudit(QueryAuditRequest)` returning `{entries[]}` with paged results. The request supports filters by actor, command, time range, session, and pagination.

---

## Decision

The CLI gets three audit subcommands backed by `QueryAudit`:

### `cambrian audit list`

Lists recent audit entries. Defaults to the last 24 hours, the most recent 50 entries.

```
$ cambrian audit list
ID                                   ACTOR    COMMAND         REASON                    WHEN
7c4e8a3f-...                        admin    approve         (none)                    2m ago
4a7c2e1d-...                        admin    tool_grant      for prod investigation     15m ago
9d2f1b8a-...                        alice    deny            invalid input             1h ago
3f9b1c2e-...                        admin    audit_export    compliance Q3            2h ago
```

Flags:

| Flag | Effect |
|---|---|
| `--since 1h` / `--since 2026-06-25T00:00:00Z` | Time range start (default: 24h ago) |
| `--until 1h` / `--until 2026-06-25T00:00:00Z` | Time range end (default: now) |
| `--actor <username>` | Filter by actor |
| `--command <verb>` | Filter by command verb (e.g., `approve`, `tool_grant`) |
| `--session <id>` | Filter by session ID (if the command operated on a session) |
| `--limit <n>` | Max entries (default: 50, max: 1000) |
| `--json` | Output as JSON for scripting |

`--json` shape:
```json
{
  "entries": [
    {
      "command_id": "7c4e8a3f-...",
      "actor": "admin",
      "role": "operator",
      "command": "approve",
      "args": {"intervention_id": "abc-123"},
      "reason": null,
      "result": {"approved": true},
      "created_at": "2026-06-25T14:32:11Z",
      "client": "cambrian-cli/0.2.0"
    }
  ],
  "next_page_token": "..."
}
```

### `cambrian audit show <command_id>`

Shows a single entry in full detail.

```
$ cambrian audit show 7c4e8a3f-...
ID:          7c4e8a3f-1234-5678-90ab-cdef01234567
Actor:       admin (operator)
Command:     approve
Args:        {"intervention_id": "abc-123"}
Reason:      (none)
Result:      {"approved": true}
Client:      cambrian-cli/0.2.0
Created:     2026-06-25T14:32:11Z
Deduped:     no
```

If the `command_id` is not found, exit 1 with a clear message: `Audit entry 7c4e8a3f-... not found. It may have been pruned (default retention: 90 days).`

### `cambrian audit export`

Exports audit entries to a file (or stdout) for compliance / archival.

```
$ cambrian audit export --since 2026-06-01 --until 2026-07-01 --format json --output audit-june.json
✓ Exported 1247 entries to audit-june.json

$ cambrian audit export --since 2026-06-01 --until 2026-07-01 --format csv | head
command_id,actor,role,command,reason,created_at,client
7c4e8a3f-...,admin,operator,approve,,2026-06-25T14:32:11Z,cambrian-cli/0.2.0
...
```

Flags:

| Flag | Effect |
|---|---|
| `--since <time>` | Required. Time range start. |
| `--until <time>` | Required. Time range end. |
| `--format json\|csv\|ndjson` | Output format (default: `ndjson` for stdout piping) |
| `--output <path>` | Output file (default: stdout) |
| `--actor <username>` | Filter |
| `--command <verb>` | Filter |

`--reason` is **required** for `cambrian audit export` (data exfiltration; CLI-007).

`--output` writes to a file. The CLI creates the file with mode `0600` (owner read/write only). If the file already exists, the CLI refuses and asks for `--force`.

Streaming for large exports: `QueryAudit` returns paged results; the CLI walks pages and writes incrementally. No memory blowup on multi-month exports.

### Retention

The kernel's `operator_audit` table has a default retention of 90 days (configurable via kernel config). The CLI surfaces this:

```
$ cambrian audit list --since 6m
⚠ Showing entries from 6 months ago. Retention is 90 days; older entries are pruned.
```

### Subcommand surface (added to `cambrian --help`)

```
cambrian audit list                  List recent audit entries
cambrian audit list --json           Output as JSON
cambrian audit list --actor <name>   Filter by actor
cambrian audit list --command <verb> Filter by command verb
cambrian audit list --since <time>   Time range start
cambrian audit list --until <time>   Time range end
cambrian audit list --limit <n>      Max entries (default 50, max 1000)
cambrian audit show <command_id>     Show a single entry
cambrian audit export                Export entries to file or stdout
cambrian audit export --format json  JSON output
cambrian audit export --format csv   CSV output
cambrian audit export --output <path>
                                     Write to file (mode 0600)
cambrian audit export --reason <text>
                                     Required for export
```

### What the CLI does NOT do

- **Modify the audit log.** The CLI only reads. The kernel owns writes.
- **Stream live audit events.** The `audit` event type on `StreamEvents` (CLI-008) gives the TUI a live view. `cambrian audit list` is the historical view.
- **Cross-kernel audit queries.** Each kernel has its own `operator_audit`. The CLI is scoped to the currently-logged-in server.

---

## Options considered

| Option | What | Why rejected |
|---|---|---|
| **A. list / show / export backed by QueryAudit (chosen)** | Standard read surface. Paged. Filterable. JSON/CSV export. | Matches the kernel's RPC. The user gets the same data the UI would show. |
| **B. Just `list` (no `show` or `export`)** | Minimal V1. | Power users want `show` for incident response. Compliance wants `export`. Both are cheap. |
| **C. Stream live audit events in the TUI** | Add a live audit pane. | The TUI's Activity feed (CLI-008) already shows the live feed. `audit list` is the historical view. |

---

## Consequences

### Positive

- **Operator accountability.** Every action is visible: who did what, when, why. The `reason` field is required for sensitive actions (CLI-007).
- **Compliance-ready.** `cambrian audit export` produces a structured archive for SOC2 / ISO 27001 / GDPR audits. The `--format csv` option works in any spreadsheet.
- **Incident response.** `cambrian audit show <command_id>` is the starting point for "why did X happen?"
- **Paged, bounded.** The CLI never loads the whole audit log into memory. Streams pages.

### Negative

- **Retention is a kernel concern.** If the user needs longer retention, they configure the kernel. The CLI surfaces a warning when querying near the retention boundary.
- **`--reason` is required for export.** Slight friction. Mitigated by the prompt-on-missing behavior in TTY.
- **No live audit feed in the TUI pane.** Live audit events are in the Activity feed (CLI-008). A dedicated "Audit" pane could be V1.1.

### Neutral

- `QueryAudit` is a kernel RPC. The CLI is a thin client. New filter dimensions added to the kernel automatically become available via flags.

---

## Acceptance criteria

- [ ] `cambrian audit list` shows the last 50 entries from the last 24h by default.
- [ ] `cambrian audit list --json` outputs JSON.
- [ ] `cambrian audit list --actor <name>`, `--command <verb>`, `--since <time>`, `--until <time>`, `--limit <n>` filters work.
- [ ] `cambrian audit show <command_id>` shows full entry detail.
- [ ] `cambrian audit export` streams entries to stdout (default: NDJSON) or to a file.
- [ ] `cambrian audit export --format json|csv|ndjson` works.
- [ ] `cambrian audit export --reason <text>` is required.
- [ ] `--output <path>` writes to a file with mode `0600`. Refuses to overwrite without `--force`.
- [ ] Retention boundary shows a warning when querying near the edge.
- [ ] 42 existing smoke tests pass; new tests cover: list defaults, filters, show, export formats, --reason required, retention warning.
- [ ] `tsc --noEmit` clean.

---

## Follow-on ADRs

None — this is the leaf read surface.
