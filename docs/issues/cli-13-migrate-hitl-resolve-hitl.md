# cli-13 — Migrate HITL path (approve/deny → `ResolveHITL`)

**Status:** TODO
**Parent ADR:** CLI-001, CLI-007
**Depends on:** cli-12, cli-15
**Blocks:** (Phase 1 exit)
**Estimated effort:** 3 days

## Description

Replace the agent-plane `WatchApprovals` / `SubmitApprovalDecision` calls in `handleApprove` and `handleDeny` with the operator-plane `OperatorConsole.ResolveHITL`. Auto-generate `command_id` per call. Add `--reason` flag (required for destructive HITL).

## Steps

1. Read `src/index.tsx` `handleApprove` (around line 350) and `handleDeny` to understand the current flow.
2. Update `handleApprove` to:
   - Generate a `command_id` (UUID v4) — see cli-15
   - Read `--reason` from args (optional for approve; prompt if missing in TTY)
   - Call `operatorClient.resolveHITL({intervention_id, approved: true, command_id, reason, client: "cambrian-cli/<version>"})`
   - Print the `command_id` on success: `✓ Approved <id> (id: 7c4e8a3f-...)`
   - On `deduped: true`, print `✓ Already approved (deduped, id: 7c4e8a3f-...)`
3. Update `handleDeny` similarly (approved: false).
4. Update help text to show the new `--reason` flag.
5. Add unit tests for: approve happy path, deny happy path, deduped response, missing-token error, PermissionDenied for Viewer.
6. Add smoke tests in `scripts/test-cli.sh`.

## Acceptance criteria

- [ ] `cambrian approve <id>` calls `OperatorConsole.ResolveHITL` (not `SubmitApprovalDecision`).
- [ ] `cambrian deny <id>` calls `OperatorConsole.ResolveHITL` with `approved: false`.
- [ ] `command_id` is auto-generated as UUID v4.
- [ ] `--reason` flag accepted (optional for approve/deny, prompted in TTY if missing).
- [ ] `command_id` printed on success.
- [ ] `deduped: true` from the server is reflected in the output.
- [ ] Unauthenticated token produces a clear error.
- [ ] Viewer role produces a clear `PermissionDenied` error.
- [ ] `x-agent-id` is no longer sent on these calls.
- [ ] 42 existing smoke tests pass; new tests cover the operator-plane path.
- [ ] `tsc --noEmit` clean.

## Notes

- This is the first user-visible migration. The CLI's HITL path was the only operator-plane concern in the original code; this is where the architectural drift is fixed.
- After this ticket, the CLI is consistent with the UI's HITL path (both use `ResolveHITL`).
