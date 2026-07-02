# cli-93 — Integration tests for HITL

**Status:** TODO
**Parent ADR:** CLI-001 (operator plane), CLI-007 (idempotent commands)
**Depends on:** cli-90 (mock gRPC server)
**Blocks:** cli-94
**Estimated effort:** 2 days

## Description

Integration tests for `cambrian approve`, `cambrian deny`, and `cambrian approve list`. These prove the HITL migration to operator plane works end-to-end: the CLI sends `ResolveHITL` with the right `command_id` (UUID v4 for fresh, UUID v5 deterministic for retries) and `reason`, and subscribes to `StreamEvents` for the live approval list.

## Steps

1. Read `src/index.tsx` to find `handleApprove` and `handleDeny` (around line 600-735).
2. Read `src/grpc/operator-streams.ts` to understand `openOperatorEventStream`.
3. Read `src/util/command-id.ts` to understand the UUID v4 + v5 generation.
4. Create `src/hitl.integration.test.ts` that:
   - Spins up a mock server.
   - For each scenario, scripts the relevant RPC responses and runs the CLI.
5. Scenarios:
   - **`approve <id>` success** — script `Login` (for setup) + `ResolveHITL` returns `{ command_id: "cmd-1", success: true }`. Assert: stdout contains "Approved (id: cmd-1)".
   - **`approve <id> --reason "ship it"`** — same. Assert: the mock received the `ResolveHITLRequest` with `reason: "ship it"`.
   - **`deny <id>` success** — script `Login` + `ResolveHITL` returns `{ command_id: "cmd-2", success: true }`. Assert: stdout contains "Denied".
   - **Idempotent retry (`--force`)** — first call succeeds. Second call with `--force` generates a fresh UUID v4 (not the deterministic v5 from cli-15). Assert: the second `command_id` is different from the first.
   - **Idempotent retry (no `--force`, same args)** — first call succeeds. Second call with identical args generates the same UUID v5. Assert: the second `command_id` is the same as the first.
   - **`approve <id> --command-id <explicit-uuid>`** — assert: the mock received exactly that `command_id` (no regeneration).
   - **`approve list` (live stream)** — script: `Login` + `StreamEvents` pushes 2 `hitl_raised` events, then completes. Run `cambrian approve list --timeout 5`. Assert: stdout contains both event `intervention_id`s.
   - **`approve list` filtered to `hitl_raised` only** — script: pushes 1 `hitl_raised` + 1 `agent_ready` event. Assert: stdout contains only the `hitl_raised` one (the `agent_ready` is filtered out by the CLI).
   - **Stream reconnect** — script: first `StreamEvents` call errors with `UNAVAILABLE`, second call succeeds. Assert: the CLI reconnects (verifiable via mock's `getCalls('StreamEvents')` returning 2).
   - **Role-gating: viewer denied** — script: `Login` returns role: "viewer". Run `approve <id>`. Assert: exit 1, stderr contains "Permission denied".
   - **`approve` with no `<id>`** — assert: exit 1, stderr contains "Usage: cambrian approve".

## Acceptance criteria

- [ ] `src/hitl.integration.test.ts` exists with ≥ 10 test cases.
- [ ] Every test uses the mock server.
- [ ] Tests assert on the `command_id` and `reason` fields in the `ResolveHITLRequest` received by the mock.
- [ ] Idempotency tests verify the deterministic v5 hashing (same args → same `command_id`; different args → different `command_id`).
- [ ] Stream tests assert on the number of `hitl_raised` events received (not `agent_ready`, not `auction` — the filter is correct).
- [ ] Reconnect test asserts the mock received 2 `StreamEvents` calls.
- [ ] `tsc --noEmit` clean.

## Notes

- The `command_id` semantics are in `src/util/command-id.ts` and documented in cli-15. Fresh = UUID v4. Retry = UUID v5 (SHA-1 of `CLINAMESPACE + canonical-JSON(args)`). Same args → same v5. Different args → different v5.
- The `command_id` in the request is sent via the `command_id` field on `ResolveHITLRequest`, not via a header.
- For the stream reconnect test, the mock's first call should `callback(new Error('UNAVAILABLE'), null)` and the second should return the scripted events. The CLI's `openOperatorEventStream` uses backoff+jitter (1s base, 2×, cap 30s) — for test speed, the test should wait at least 1s for the reconnect, or use a test-only knob to disable backoff.
- For the `--force` test, the CLI explicitly generates a new UUID v4 instead of the deterministic v5. Verify by passing `--force` and asserting the mock received a different `command_id` from the first call.
- The `approve list` filter is at `src/index.tsx:559` — the `onEvent` callback only emits when `event.payload === "hitl_raised"`. Test this by pushing a mix of events.
