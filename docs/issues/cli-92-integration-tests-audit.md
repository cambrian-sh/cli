# cli-92 — Integration tests for audit

**Status:** TODO
**Parent ADR:** CLI-010 (audit log access)
**Depends on:** cli-90 (mock gRPC server)
**Blocks:** cli-94
**Estimated effort:** 2 days

## Description

Integration tests for `cambrian audit list`, `cambrian audit show`, and `cambrian audit export`. These prove the audit read surface correctly parses the kernel's `QueryAudit` response and formats it as a table, JSON, CSV, or NDJSON.

## Steps

1. Read `src/audit.ts` to enumerate the audit-related code paths.
2. Read `src/index.tsx` to find the audit dispatch (the `case "audit":` branch with `list`, `show`, `export` subcommands).
3. Create `src/audit.integration.test.ts` that:
   - Spins up a mock server.
   - For each scenario, scripts the `QueryAudit` response with 2-3 sample `AuditOp` entries, runs the CLI, asserts the output.
4. Scenarios:
   - **`audit list` default** — script returns 2 entries. Assert: stdout contains both `actor`s, both `action_type`s, the header row, AND a row for each entry.
   - **`audit list --json`** — same scripted response. Assert: stdout is valid JSON with `entries: [...]` containing both entries with all fields.
   - **`audit list --actor alice`** — script returns 2 entries, one with `actor: "alice"`, one with `actor: "bob"`. Assert: stdout contains "alice" but NOT "bob".
   - **`audit list --action approve`** — script returns 2 entries with different `action_type`. Assert: stdout shows only the `approve` one.
   - **`audit list --limit 1`** — script returns 3 entries. Assert: stdout shows only 1.
   - **`audit show <id>`** — script returns 1 entry. Assert: stdout contains the entry's `id`, `command_id`, `actor`, `role`, `action_type`, `target_type`, `target_id`, `reason`.
   - **`audit show <nonexistent-id>`** — script returns 0 entries. Assert: exit 1, stderr contains "not found".
   - **`audit export --format json`** — script returns 2 entries. Assert: stdout is valid JSON with 2 entries.
   - **`audit export --format csv`** — same. Assert: stdout has the header row + 2 data rows; the CSV is parseable.
   - **`audit export --format ndjson`** — same. Assert: stdout is 2 lines, each parseable as JSON.
   - **`audit export --output /tmp/audit.json`** — same. Assert: file is written, mode is `0600`.
   - **`audit export --output /tmp/audit.json` (file exists)** — first run writes the file; second run without `--force` fails with "Refusing to overwrite"; with `--force` succeeds.
   - **`audit export` without `--reason`** — assert: exit 1, stderr contains "--reason".
   - **`audit export` with `--reason`** — assert: the `ResolveHITL`-style audit entry on the server-side records the reason. (The mock can record this for assertion.)

## Acceptance criteria

- [ ] `src/audit.integration.test.ts` exists with ≥ 12 test cases covering the scenarios above.
- [ ] Every test uses the mock server.
- [ ] Tests assert on stdout/stderr from a child-process invocation of the CLI.
- [ ] Tests assert on the gRPC `authorization` header sent to the mock.
- [ ] File-write tests use a `mkdtempSync` temp directory and clean up after themselves.
- [ ] CSV-mode test asserts that a row containing `,` and `"` is properly quoted per RFC 4180.
- [ ] Overwrite-refusal test verifies the file's mtime has not changed after the refused write.
- [ ] `tsc --noEmit` clean.

## Notes

- The `AuditOp` type in `src/cambrian-types.ts` is the contract. Use a factory like `makeAuditOp(overrides)` in the test to avoid repeating 11 fields per entry.
- For the `audit show <id>` test, the mock should return a `QueryAudit` response where the entry's `id` matches the requested `<id>`. The `findAuditById` function does a client-side `entries.find((e) => e.id === id || e.command_id === id)`.
- For the `audit show <nonexistent-id>` test, the mock returns an empty `entries` array, and the CLI should print "not found" and exit 1.
- For CSV escaping, the test must include an entry with `reason: 'invalid input, contains "quote"'` and assert the output is properly quoted.
- For the file-mode test, use `statSync(path).mode & 0o777` to assert `0o600` (not `0o644` or `0o664`).
