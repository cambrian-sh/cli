# cli-15 — Idempotent command protocol (`command_id` + `reason`)

**Status:** TODO
**Parent ADR:** CLI-007
**Depends on:** (none)
**Blocks:** cli-13, all mutating subcommands
**Estimated effort:** 3 days

## Description

Implement the `command_id` (UUID v4) and `reason` (free-form text) generation per CLI-007. Apply to every mutating subcommand: approve, deny, tool grant/revoke, memory write, memory tag, config set, service install/uninstall, audit export, uninstall.

## Steps

1. Create `src/util/command-id.ts`:
   - `newCommandId()` returns a fresh UUID v4
   - `commandIdForRetry(subcommand, args)` returns a deterministic UUID v5 from a CLI-specific namespace + canonical subcommand+args (for safe retries)
2. Create `src/util/reason.ts`:
   - `resolveReason(args, {required, prompted})` returns the `--reason` value or prompts in TTY or errors in non-TTY
3. Create `src/util/client-tag.ts`:
   - `clientTag()` returns `"cambrian-cli/<version>"` (read from `package.json` at build time)
4. Update every mutating subcommand in `src/index.tsx` to:
   - Generate a `command_id` (or use the deterministic retry ID if `CAMBRIAN_RETRY_COMMAND_ID` is set)
   - Resolve `--reason` (required for destructive, prompted in TTY for non-destructive)
   - Send `command_id`, `reason`, `client` on every operator-plane call
   - Print the `command_id` on success
5. Add the `--command-id <uuid>` flag for explicit override.
6. Add the `--force` flag support (regenerates `command_id`, requires `--reason`).
7. Add unit tests for: UUID generation, UUID v5 determinism, reason resolution, client tag.
8. Add smoke tests for: approve/deny with --reason, audit export with --reason, --force regeneration.

## Acceptance criteria

- [ ] `src/util/command-id.ts`, `src/util/reason.ts`, `src/util/client-tag.ts` exist.
- [ ] Every mutating subcommand generates and sends a `command_id`.
- [ ] `--reason` is accepted on every mutating subcommand.
- [ ] `--reason` is **required** for: `cambrian tool grant/revoke`, `cambrian audit export`, anything with `--force`.
- [ ] Missing `--reason` in non-TTY exits with a clear error.
- [ ] Missing `--reason` in TTY prompts (with a clear prompt message).
- [ ] `command_id` is printed on success: `✓ <verb> (id: 7c4e8a3f-...)`.
- [ ] `deduped: true` from server is reflected in the output.
- [ ] `--command-id <uuid>` overrides the auto-generated ID.
- [ ] `--force` regenerates a new `command_id` and requires `--reason`.
- [ ] `client` field is `"cambrian-cli/<version>"`.
- [ ] 42 existing smoke tests pass; new tests cover the idempotency path.
- [ ] `tsc --noEmit` clean.

## Notes

- This ticket is **foundational** for cli-13 (HITL migration). The HITL path needs `command_id` + `reason` from day one.
- Deterministic retry (UUID v5) means a CI script that fails partway can be safely re-run.
