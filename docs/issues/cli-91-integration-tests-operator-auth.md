# cli-91 — Integration tests for operator auth

**Status:** TODO
**Parent ADR:** CLI-002 (auth model)
**Depends on:** cli-90 (mock gRPC server)
**Blocks:** cli-94 (CI must pass for this to be useful)
**Estimated effort:** 2 days

## Description

Integration tests for `cambrian login`, `cambrian logout`, `cambrian whoami`, and the role-gating logic. These exercise the full client → mock server → response pipeline. The goal is to prove the auth flow works end-to-end without a live kernel.

## Steps

1. Read `src/auth.ts` and `src/grpc/operator-client.ts` to enumerate the auth-related code paths.
2. Read `src/index.tsx` to find the `login`, `logout`, `whoami` dispatch (around line 90-128) and the role-gate for `approve`/`deny` (around line 160-170).
3. Create `src/auth.integration.test.ts` that:
   - Spins up a mock server (via `startMockServer` from cli-90).
   - For each scenario below, sets the scripted response, runs the CLI subcommand, asserts the output.
4. Scenarios:
   - **Login success** — mock returns `{ token: "jwt-1", role: "operator" }`. Assert: stdout contains "Logged in as alice (role: operator)", keychain (in-memory via `CAMBRIAN_KEYCHAIN_BACKEND=memory`) has `{ token: "jwt-1", role: "operator", username: "alice" }`.
   - **Login with `--username` and `--password`** — non-interactive path. Same scripted response. Assert: no TTY prompt is triggered.
   - **Login rejection** — mock returns `Unauthenticated`. Assert: exit code 1, stderr contains "auth:" + "Unauthenticated" (or the friendly mapped message).
   - **Whoami after login** — script: login success, then `whoami`. Assert: stdout contains "User: alice" + "Role: operator" + "Source: keychain".
   - **Whoami with `--token`** — script: `whoami` with `--token jwt-2`. Assert: stdout contains "Source: flag".
   - **Whoami with `CAMBRIAN_TOKEN`** — script: same. Assert: "Source: env".
   - **Logout** — script: login success, then `logout`. Assert: keychain entry is gone; subsequent `whoami` shows "Not logged in".
   - **Role-gating: viewer** — script: login as viewer. Then `cambrian approve <id>` should exit 1 with stderr "Permission denied: \`approve\` requires the \"operator\" role; current role is \"viewer\"."
   - **Role-gating: operator** — same as above but role is operator. The mock for `ResolveHITL` returns `{ command_id: "...", success: true }`. Assert: exit 0, stdout contains "Approved".
   - **Token expiry warning** — script: login success with `expiresAt` 3 days from now. Then run any subcommand. Assert: stderr contains "expires in 3 day".
   - **Token already expired** — `expiresAt` 1 hour ago. Assert: stderr contains "expired on".

## Acceptance criteria

- [ ] `src/auth.integration.test.ts` exists with ≥ 10 test cases covering the scenarios above.
- [ ] Every test uses the mock server (no live kernel, no env-var shortcuts for the kernel).
- [ ] Every test uses `CAMBRIAN_KEYCHAIN_BACKEND=memory` for the keychain.
- [ ] Tests assert on stdout AND stderr (use `child_process.spawn` to invoke the CLI; don't import the handler directly — the point is to exercise the dispatch).
- [ ] Tests assert on the gRPC `authorization` header sent to the mock (proves Bearer is being sent, not `x-agent-id`).
- [ ] Tests are deterministic (no time-based flakiness; freeze `Date.now()` via a test helper or use long expiry windows).
- [ ] `bun test` runs the integration tests in ≤ 5s total.
- [ ] `tsc --noEmit` clean.

## Notes

- These tests should invoke the CLI as a child process (`bun src/index.tsx ...`), not import the handler. The point is to exercise the dispatch + keychain + gRPC together, not just the auth module.
- Use a deterministic token like `"test-jwt-1"` — don't depend on a real JWT structure.
- For the role-gating tests, the role is determined by the mock's `Login` response. Don't try to set it via env var.
- The `cambrian approve <id>` test needs a `ResolveHITL` mock response. The test should set BOTH the `Login` response (for setup) and the `ResolveHITL` response (for the action) — the mock's "per-RPC script" semantics from cli-90 handles this.
- For time-based tests (expiry), inject the `nowSec` parameter into `warnIfExpiringSoon` directly if possible, or use a fixed `now` constant in the test setup.
