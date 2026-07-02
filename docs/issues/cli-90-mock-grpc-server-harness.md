# cli-90 — Mock gRPC server harness

**Status:** TODO
**Parent ADR:** CLI-008, CLI-009, CLI-010 (test infrastructure for all of them)
**Depends on:** Phase 1 (operator-client.ts), Phase 6 (audit.ts), Phase 8 (auth.ts)
**Blocks:** cli-91, cli-92, cli-93
**Estimated effort:** 3 days

## Description

A TypeScript test helper that spins up an in-process gRPC server using the same embedded protos (`CAMBRIAN_PROTO` + `OPERATOR_PROTO` from `src/proto-embed.ts`), with scripted responses per RPC. Used by the integration tests in cli-91, cli-92, cli-93.

The harness must support:

1. **Per-RPC response scripts** — the test sets the response the mock should return for each call. After the response is delivered, the next call (if any) gets the next scripted response.
2. **Bidirectional stream support** — `StreamEvents` is a server-streaming RPC. The mock must be able to push N events to the client, then complete the stream.
3. **Error injection** — the mock must be able to return any gRPC status code with a custom message for a given call (e.g., `Unauthenticated` for the second call after a successful login).
4. **Metadata inspection** — the mock must record the `authorization` and `x-agent-id` headers on every call so tests can assert that the right auth is being sent.
5. **Random free port binding** — the harness binds to `127.0.0.1:0` and exposes the chosen port so the test can pass it to the CLI as `--server 127.0.0.1:<port>`.

## Steps

1. Read `src/grpc/operator-client.ts` and `src/grpc/client.ts` to understand the existing client interface and how it loads protos.
2. Read `src/proto-embed.ts` to confirm both `CAMBRIAN_PROTO` and `OPERATOR_PROTO` are exported and the temp-file write pattern.
3. Create `src/grpc/test-harness.ts` exporting:
   - `startMockServer()` → returns `{ port, setResponse(rpc, response), pushEvent(event), injectError(rpc, code, message), getCalls(rpc), close() }`.
   - The mock server uses `@grpc/grpc-js` directly (no proto-loader magic — load both protos from the same temp file the production client uses, instantiate handlers, and bind).
4. The mock server is **not** part of the production bundle — it must be excluded from `bun run build` (add to a `BUILD_EXCLUDE` list or use a path-based check in the build script). The simplest approach: import the harness from test files only, and have the build use a barrel `src/grpc/index.ts` that does not re-export the harness.
5. Add a unit test (`src/grpc/test-harness.test.ts`) that:
   - Spins up the mock, makes a `Login` call, asserts the response is what was scripted.
   - Asserts the `authorization` header was forwarded to the server.
   - Asserts the mock can push 3 events over `StreamEvents` and the client receives all 3.
   - Asserts the mock can inject `Unauthenticated` and the client surfaces the right error.

## Acceptance criteria

- [ ] `src/grpc/test-harness.ts` exists with the documented interface.
- [ ] The harness loads both protos from the embedded strings (no duplicate temp-file logic).
- [ ] The harness binds to a free port and exposes the port number.
- [ ] The harness records every call (RPC name + request payload + metadata) for assertion.
- [ ] The harness supports server-streaming responses (`StreamEvents`-style).
- [ ] The harness supports error injection per RPC.
- [ ] The harness is **not** re-exported from `src/grpc/index.ts` (or whatever barrel exists).
- [ ] `bun run build` does not include the harness in the production bundle.
- [ ] `bun test` includes the harness's own self-tests (≥ 4 tests).
- [ ] `tsc --noEmit` clean.
- [ ] No new dependency added (uses only `@grpc/grpc-js` which is already a dep).

## Notes

- The harness is the **foundation** of cli-91, cli-92, cli-93. Get the streaming and error-injection paths right; the rest builds on top.
- The mock server is a TypeScript class, not a separate process. Avoid `child_process.spawn` of a binary — keep everything in-process for fast test cycles.
- For `StreamEvents` test, the script is `[Event, Event, Event, Status(OK)]`. The harness must complete the stream after the last event.
- For `Unauthenticated` injection, use `grpc.status.UNAUTHENTICATED` and a message like `"token rejected"`. The CLI's `handleConnectionError` should map this to the friendly message — assert that.
