# CLI-007 — Idempotent Command Protocol

**Date:** 2026-06-25
**Status:** Accepted
**Author:** CLI initiative
**Depends on:** CLI-001 (operator plane adoption — `OperatorConsole` commands), ADR-0047 D15 (`operator_audit.command_id` UNIQUE)
**Relates to:** CLI-002 (auth — actor comes from token, never body), CLI-010 (audit)

---

## Context

`OperatorConsole` commands are designed to be **idempotent at the protocol level** (ADR-0047 D15). Every mutating RPC carries a client-generated `command_id` (UUID) and a `reason` (free-form string). The kernel:

1. Looks up `command_id` in `operator_audit` (UNIQUE constraint).
2. If found: returns `CommandAck{deduped: true}` with the prior result. No second execution.
3. If not found: executes the command, writes the audit row, returns `CommandAck{result}`.

This means **a retried command is safe by construction**. A flaky network, a Ctrl-C between send and ack, a CI script that re-runs on failure — none of these cause double-execution. The protocol handles it.

The current CLI does not participate in this protocol. It calls the agent-plane `Orchestrator` RPCs which have no `command_id` or `reason`. After CLI-001 migrates to `OperatorConsole`, the CLI must generate and send these on every mutating call.

This ADR defines the generation rules, the UX, and the subcommand surface.

---

## Decision

The CLI auto-generates a `command_id` (UUID v4) for every mutating subcommand invocation and prompts for (or accepts via flag) a `reason` for destructive operations.

### `command_id` generation

- Auto-generated as UUID v4 per subcommand invocation.
- The CLI prints the `command_id` on success: `✓ Approved (id: 7c4e8a3f-...)`.
- For retries: if the user runs the same subcommand twice with the **same arguments**, the CLI reuses the prior `command_id` (computed deterministically as a hash of the subcommand + arguments). This is what makes "re-run after failure" safe.
- For `--force` re-runs: the CLI generates a fresh `command_id` and explicitly tells the user "This will execute again as a new command."

The deterministic `command_id` for retries is the same logic the UI uses (`ui/AGENTS.md`: "reuse the same `command_id` across retries (the kernel dedups → `CommandAck{deduped}`)").

### `reason` handling

`reason` is the human-readable justification for the action. The kernel stores it in `operator_audit.reason`. The CLI handles it as follows:

| Subcommand | `--reason` required? | Prompted if missing? |
|---|---|---|
| `cambrian approve <id>` | No (it's an approval, not a destructive op) | No |
| `cambrian deny <id>` | No | No |
| `cambrian memory write <text>` | No (the text itself is the reason) | No |
| `cambrian memory tag <doc_id>` | No | No |
| `cambrian config set <k> <v>` | No | No |
| `cambrian service install/uninstall` | No | No |
| `cambrian uninstall` | **Yes** (destructive) | **Yes** (interactive prompt if TTY) |
| `cambrian tool grant/revoke` | **Yes** (security-sensitive) | **Yes** |
| `cambrian audit export` | **Yes** (data exfiltration) | **Yes** |
| Anything `--force` | **Yes** (overrides safety checks) | **Yes** |

For non-interactive contexts (CI, `--token` flag, `CAMBRIAN_TOKEN` env var, no TTY), `--reason` is **always required** for the destructive operations above. The CLI exits with a clear error if missing.

For interactive contexts, missing `--reason` triggers a single-line prompt: `Reason: `. The prompt is skipped on subsequent invocations within the same shell session if the user sets `CAMBRIAN_REASON_DEFAULT` (escape hatch for power users who always want the same reason).

### Subcommand surface (what the user sees)

```
$ cambrian approve abc-123
✓ Approved abc-123 (command_id: 7c4e8a3f-...)

$ cambrian approve abc-123    # re-run
✓ Already approved (deduped, command_id: 7c4e8a3f-...)

$ cambrian approve abc-123 --force
? This will execute again as a new command. Reason: production hotfix
✓ Approved abc-123 (command_id: 9d2f1b8a-...)

$ cambrian tool grant --agent daemon-1 --tool shell-exec --grant
? Reason: enabling for prod investigation
✓ Granted shell-exec to daemon-1 (command_id: 4a7c2e1d-...)

$ cambrian tool grant --agent daemon-1 --tool shell-exec --grant --reason "for prod"
✓ Granted shell-exec to daemon-1 (command_id: 4a7c2e1d-...)

$ cambrian tool grant --agent daemon-1 --tool shell-exec --grant    # in CI, no TTY
✗ Error: --reason is required for tool grant/revoke (security-sensitive).
  Use --reason "your justification".

$ cambrian approve abc-123    # in CI
✓ Approved abc-123 (command_id: 7c4e8a3f-...)
```

### Audit trail shape

Every mutating subcommand writes a row to `operator_audit` with:

| Column | Value |
|---|---|
| `command_id` | UUID v4 (auto-generated, deterministic on retry) |
| `actor` | Username from the JWT (CLI-002) |
| `role` | `operator` or `viewer` (from the JWT) |
| `command` | The full subcommand verb (`approve`, `deny`, `tool_grant`, etc.) |
| `args` | JSON-serialized arguments |
| `reason` | The `--reason` text (or `null`) |
| `result` | The `CommandAck` result (or `deduped: true`) |
| `created_at` | Timestamp |
| `client` | `"cambrian-cli/<version>"` (for distinguishing from UI / SDK) |

The CLI surfaces this audit via `cambrian audit list|show|export` (CLI-010).

### Deterministic retry

The deterministic `command_id` for retries is computed as:

```typescript
function commandId(subcommand: string, args: Record<string, unknown>): string {
  const canonical = JSON.stringify({ subcommand, args }, Object.keys(args).sort());
  return uuidv5(canonical, NAMESPACE);  // uuidv5 = SHA-1 hash
}
```

The namespace is a CLI-specific UUID (generated once, embedded in the binary). Same subcommand + same args = same `command_id`. Different args = different `command_id`. The user can override with `--command-id <uuid>` for explicit control.

### What does NOT carry `command_id` / `reason`

- **Read RPCs** (`Snapshot`, `QueryAudit`, `StreamEvents` subscription) — these are not mutating.
- **Agent-plane RPCs** (`ListTools`, `QueryMemory`, etc.) — these stay on `Orchestrator` per CLI-001 and have no protocol-level audit.
- **Service management subcommands** (`cambrian start|stop|restart|status|logs`) — these are local to the user's machine; they don't go through gRPC.
- **`cambrian login` / `cambrian logout`** — auth itself, not a mutation on a domain object.

---

## Options considered

| Option | What | Why rejected |
|---|---|---|
| **A. Auto-UUID + deterministic retry + --reason for destructive (chosen)** | Matches the UI's model. Idempotent by construction. UX is clear. | Standard pattern. Aligns with `ui/AGENTS.md` and ADR-0047 D15. |
| **B. No `command_id`, no idempotency** | Just call the RPC. | Unsafe on retries. Violates ADR-0047 D15. |
| **C. Always require `--reason`** | Every mutation requires explicit justification. | Annoying for harmless mutations like `cambrian memory write`. The `destructive vs non-destructive` split is the right granularity. |
| **D. CLI generates `command_id`, doesn't display it** | Silent. | The user can't verify "this was deduped" without looking at the audit log. Printing the ID builds trust. |

---

## Consequences

### Positive

- **Idempotent by construction.** Every mutation can be safely retried. The kernel dedups via `operator_audit.command_id` UNIQUE.
- **Auditable.** Every mutation has a `reason` for security-sensitive operations. The audit log is queryable via `cambrian audit` (CLI-010).
- **CI-friendly.** The deterministic retry means a failed CI run can be re-run without double-execution. The `--force` flag exists for cases where double-execution is actually wanted.
- **Aligned with the UI.** The UI uses the same protocol. The audit log is shared.
- **Discoverable.** The user sees the `command_id` on every success: "this is your proof of action."

### Negative

- **Extra typing for security-sensitive ops.** `cambrian tool grant --reason "..."` is more verbose than `cambrian tool grant`. Mitigated by the prompt-on-missing behavior in interactive mode.
- **Deterministic retry can be surprising.** Re-running with slightly different args (e.g., adding `--verbose`) generates a new `command_id`. Mitigated by printing the `command_id` so the user can see when it's different.
- **`--force` is dangerous.** It's literally "execute again as a new command, even if the prior one succeeded." Documented clearly. Not allowed in CI without an explicit `--force --reason "..."`.

### Neutral

- The audit table (`operator_audit`) is a kernel concern, not a CLI concern. The CLI just populates the fields.
- The `client` field (`"cambrian-cli/<version>"`) is new — it lets the audit log distinguish CLI actions from UI actions. The kernel accepts any string here; the UI sends `"tauri-ui/<version>"`.

---

## Acceptance criteria

- [ ] Every mutating subcommand sends a `command_id` (UUID v4 on first run, deterministic on retry).
- [ ] The `command_id` is printed on success: `✓ <verb> (id: 7c4e8a3f-...)`.
- [ ] Re-running a subcommand with the same args returns `deduped: true` and prints "Already <verbed>".
- [ ] `--reason` is **required** for: `cambrian uninstall`, `cambrian tool grant/revoke`, `cambrian audit export`, anything with `--force`.
- [ ] `--reason` is **optional** (but prompted if missing in TTY) for: `cambrian approve/deny`, `cambrian memory write`, etc.
- [ ] In non-interactive contexts (CI, `--token`, no TTY), missing `--reason` exits with a clear error.
- [ ] `--force` regenerates a new `command_id` (does not dedup).
- [ ] `--command-id <uuid>` allows explicit override.
- [ ] The audit row's `client` field is `"cambrian-cli/<version>"`.
- [ ] 42 existing smoke tests pass; new tests cover: dedup-on-retry, --reason required paths, --force regeneration, --command-id override.
- [ ] `tsc --noEmit` clean.

---

## Follow-on ADRs

- **CLI-010** — Audit Log Access: `cambrian audit list|show|export` reads `operator_audit`.
