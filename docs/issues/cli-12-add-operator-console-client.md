# cli-12 — Add `src/grpc/operator-client.ts` typed wrappers

**Status:** TODO
**Parent ADR:** CLI-001
**Depends on:** cli-11
**Blocks:** cli-13, cli-14
**Estimated effort:** 1 week

## Description

Create a new TypeScript client that wraps `OperatorConsole` RPCs. Mirrors the existing `src/grpc/client.ts` style (typed wrappers, timeouts, error handling). Uses `authorization: Bearer <token>` metadata (no `x-agent-id`).

## Steps

1. Read `src/grpc/client.ts` to understand the existing client pattern (typed wrappers, 5s connect, 15s unary deadline, metadata cloning).
2. Read `api/proto/operator.proto` to enumerate the RPCs and messages.
3. Create `src/grpc/operator-client.ts` with:
   - `OperatorClient` interface exposing: `login`, `snapshot`, `streamEvents`, `resolveHITL`, `queryAudit`, `setToolGrant`, `tagMemory`, `setScope`, `registerSkill`, `registerMCP`, `triggerConsolidation`, `createSession`, `sendMessage`, `injectCorrection`, `pauseSession`, `resumeSession`
   - A factory `createOperatorClient(server, token)` that returns an `OperatorClient`
   - Internal proto-loader that reads from the embedded `EMBEDDED_OPERATOR_PROTO` (or the temp file written at startup)
   - Bearer token sent on every call
4. Add hand-written TS interfaces to `src/cambrian-types.ts` for the operator proto messages (`LoginRequest`, `LoginResponse`, `SnapshotResponse`, `SubscribeRequest`, `OperatorEvent`, `ResolveHITLRequest`, `QueryAuditRequest`, etc.) — following the same pattern as the existing `ListToolsRequest` etc.
5. Export the new client from `src/grpc/index.ts` (if such a barrel exists) or from `src/grpc/operator-client.ts` directly.
6. Update `src/grpc/client.ts` to load both protos (one temp file per proto, or a combined loadDefinition call).

## Acceptance criteria

- [ ] `src/grpc/operator-client.ts` exists with `OperatorClient` interface and `createOperatorClient` factory.
- [ ] All 15+ `OperatorConsole` RPCs have typed wrappers.
- [ ] Bearer token sent on every call via metadata.
- [ ] No `x-agent-id` on operator-plane calls.
- [ ] `src/cambrian-types.ts` has the operator proto message interfaces.
- [ ] `tsc --noEmit` clean.
- [ ] Unit tests for: client creation, login round-trip, snapshot response shape, stream-events subscription, error mapping (e.g., `Unauthenticated` → "Token rejected. Run `cambrian login` to refresh.").

## Notes

- The existing `src/grpc/client.ts` is for `Orchestrator` (agent-plane). This is a new file, not a modification.
- The new client is **additive** — no existing subcommand changes in this ticket. The migration happens in cli-13, cli-14.
- `command_id` (UUID v4) generation lives in `src/util/command-id.ts` (used by cli-15).
