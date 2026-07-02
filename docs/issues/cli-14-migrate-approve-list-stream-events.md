# cli-14 — Migrate `cambrian approve list` to `StreamEvents`

**Status:** TODO
**Parent ADR:** CLI-001, CLI-008
**Depends on:** cli-12
**Blocks:** (Phase 1 exit)
**Estimated effort:** 3 days

## Description

Replace the agent-plane `WatchApprovals` server-stream in `src/grpc/streams.ts` with an operator-plane `OperatorConsole.StreamEvents` subscription filtered for `hitl_raised` events. Same reconnect logic (backoff+jitter), same `--timeout` flag semantics.

## Steps

1. Read `src/grpc/streams.ts` to understand the current `openApprovalStream` (server-stream with reconnect).
2. Add `openOperatorEventStream(operatorClient, lastSeq, onEvent)` to `src/grpc/streams.ts` (or a new file `src/grpc/operator-streams.ts`).
3. The new stream:
   - Calls `operatorClient.streamEvents({last_seq: 0})` initially
   - Filters events for `event.payload.hitl_raised`
   - Reconnects with backoff+jitter on stream error (1s base, 2×, cap 30s, ±10%)
   - Resumes from the last received `seq` after reconnect
4. Update `handleApprove list` in `src/index.tsx` to use the new stream.
5. Add unit tests for: event filtering, reconnect with resume, timeout, malformed events.
6. Add smoke tests in `scripts/test-cli.sh`.

## Acceptance criteria

- [ ] `cambrian approve list` subscribes to `OperatorConsole.StreamEvents`.
- [ ] Only `hitl_raised` events are shown.
- [ ] Reconnect resumes from the last `seq` (not from 0).
- [ ] Backoff+jitter on stream errors (1s → 2s → 4s → ... → 30s, ±10%).
- [ ] `--timeout` flag still works (default 5s).
- [ ] After `--timeout`, the stream is closed cleanly and the CLI exits 0.
- [ ] Unauthenticated token produces a clear error.
- [ ] 42 existing smoke tests pass; new tests cover the event stream path.
- [ ] `tsc --noEmit` clean.

## Notes

- `WatchApprovals` (agent-plane) is deprecated for the CLI after this ticket. The agent-plane RPC is still served by the kernel for any non-CLI clients.
- The event filtering happens client-side. A V1.1 optimization could add server-side filtering via the `StreamEvents` request (if the proto supports it).
