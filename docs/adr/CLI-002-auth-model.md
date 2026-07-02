# CLI-002 — Auth Model (Login + Bearer + Roles)

**Date:** 2026-06-25
**Status:** Accepted (D3 locked in `docs/plans/cli-initiative.md` Part 0)
**Author:** CLI initiative
**Depends on:** CLI-001 (operator plane adoption), ADR-0047 D13 (operator auth is the data-security boundary)
**Relates to:** CLI-007 (idempotent commands), all subcommands that hit `OperatorConsole`

---

## Context

The current CLI authenticates as an agent: `x-agent-id: <operatorId>` on every gRPC call (`cli/src/grpc/client.ts:94`). This is the wrong principal for an operator CLI — a human operator authenticating as a machine-identity is architecturally incoherent and bypasses the operator-plane's role enforcement.

`OperatorConsole` (ADR-0047 D13) uses a different model:

- **`Login(username, password) → {token, role}`** — returns a Bearer token and a role (`Operator` or `Viewer`).
- **`authorization: Bearer <token>`** — sent on every call. No `x-agent-id` on the operator plane.
- **Server-enforced role.** `Viewer` mutations → `PermissionDenied`. The kernel decides; the client only reflects.

The UI stores the token in the **OS keychain** (macOS Keychain, Windows Credential Manager, Linux Secret Service via libsecret) and sends it on every gRPC call from the Rust core (`ui/AGENTS.md` "Auth: `Login(username,password) → {token, role}`; send `authorization: Bearer <token>` on every call. Store the token in the OS keychain.").

The CLI must do the same. But the CLI also runs in non-interactive contexts (CI, scripts, cron) where a `Login` prompt is not possible. D3 locked the answer: **Login for interactive use, `--token` flag for CI/scripts**.

---

## Decision

The CLI gets a proper operator auth flow with two entry points:

### 1. Interactive: `cambrian login`

```
$ cambrian login
Server: localhost:50051
Username: admin
Password: ********
✓ Logged in as admin (role: operator)
  Token stored in OS keychain.
  Expires: 2026-07-25 (30 days)
```

- Reads `CAMBRIAN_SERVER` (or `--server`) for the target.
- Prompts for username + password (password read from TTY, not echoed).
- Calls `OperatorConsole.Login`. On success, stores `{token, role, expires_at, server}` in the OS keychain under a per-server account (one keychain entry per server the user has logged into).
- On failure, shows the gRPC error code and a hint (e.g., "Check username/password" for `Unauthenticated`).
- Token expiry is read from the `LoginResponse` if present; the CLI warns 7 days before expiry.

### 2. Non-interactive: `--token <jwt>`

```
$ cambrian --token eyJhbGciOi... approve <id> --reason "ship it"
```

- The token is used for this one invocation only. Nothing is stored.
- The role is read from the token's claims (the `OperatorConsole.Login` response includes the role in the JWT or alongside it; the CLI trusts the kernel's authority).
- No keychain access. Safe for CI.
- Errors: if the token is expired or rejected, the CLI exits with a clear message ("Token rejected. Run `cambrian login` to refresh.").

### Token storage: OS keychain

Per-platform:

| Platform | Backend | Library |
|---|---|---|
| macOS | Keychain | `security` CLI (no extra dep) |
| Linux | Secret Service (libsecret) | `secret-tool` CLI or `libsecret` bindings |
| Windows | Credential Manager | `wincred` via PowerShell (`cmdkey`) |

**No tokens on disk in plaintext.** The current `config.json` may contain non-secret config (server address, default profile) but never the token.

The CLI also supports `CAMBRIAN_TOKEN` env var as a one-shot override (same semantics as `--token`). `CAMBRIAN_TOKEN` takes precedence over the keychain; `--token` takes precedence over `CAMBRIAN_TOKEN`.

### Role enforcement

The kernel is the source of truth (ADR-0047 D13). The CLI **reflects** the role by hiding mutating subcommands from `Viewer` users:

- `cambrian approve <id>` — hidden for Viewer
- `cambrian deny <id>` — hidden for Viewer
- `cambrian memory write` — hidden for Viewer
- `cambrian watches create` — hidden for Viewer
- `cambrian config set` — hidden for Viewer
- `cambrian audit export` — hidden for Viewer

If a Viewer runs a hidden command (e.g., via an old script), the kernel returns `PermissionDenied` and the CLI surfaces a friendly error.

The `cambrian whoami` subcommand shows the current role and token expiry.

---

## Options considered

| Option | What | Why rejected |
|---|---|---|
| **A. Login + --token + keychain (chosen)** | Interactive Login stores token in OS keychain. CI/scripts use `--token` or `CAMBRIAN_TOKEN`. Viewer role hides mutating subcommands. | Matches the UI's model (`ui/AGENTS.md`). Secure by default. Works for all three audiences (interactive, CI, scripts). |
| **B. Pre-shared token in config.json** | User pastes a token from the orchestrator admin; stored in `~/.cambrian/config.json`. | Token on disk in plaintext. Defeats the keychain. No role enforcement at login. |
| **C. Login only, no CI override** | All invocations require `cambrian login` first. | Blocks CI/scripts (they can't run an interactive prompt). |

---

## Consequences

### Positive

- **Security.** Tokens never touch plaintext disk. OS keychain is the standard for this.
- **Multi-user.** Multiple users can log in to the same machine under different keychain entries; the CLI picks the one matching the current server.
- **Multi-server.** Logging in to `localhost:50051` and `prod.cambrian.dev:50051` produces two keychain entries; the CLI picks based on `CAMBRIAN_SERVER` or the current profile.
- **Role-aware UI.** Viewers see only the read surface. Operators see everything. The TUI mirrors this.
- **CI-friendly.** `--token` and `CAMBRIAN_TOKEN` make automation first-class. No "run `cambrian login` first" friction.

### Negative

- **Keychain permissions.** First-time `cambrian login` triggers a keychain permission prompt (macOS: "Always Allow" / "Deny"; Linux: `secret-tool` may need a session unlock). Users may be confused. Mitigated by a one-line explanation in the wizard.
- **Linux Secret Service availability.** Not all Linux desktops ship with `libsecret` running. Headless servers (no D-Bus session) will fail. Mitigated by: if keychain is unavailable, fall back to a clear error message pointing the user to `--token`.
- **Token rotation.** The kernel's `LoginResponse` may include an expiry; the CLI must re-prompt before expiry. Adds a small piece of state management.
- **Logout clears the keychain entry, not the server session.** A stolen keychain entry is valid until the token expires. Out of scope for V1; documented as a known limitation.

### Neutral

- The agent-plane `x-agent-id` stays on agent-plane calls (CLI-001 "what stays on `Orchestrator`"). Only operator-plane calls use Bearer.

---

## Acceptance criteria

- [ ] `cambrian login` prompts for server, username, password; calls `OperatorConsole.Login`; stores the result in the OS keychain.
- [ ] `cambrian logout` clears the keychain entry for the current server.
- [ ] `cambrian whoami` shows the username, role, and token expiry.
- [ ] `--token <jwt>` works for one-shot CI use; not stored.
- [ ] `CAMBRIAN_TOKEN` env var works; precedence is `--token` > `CAMBRIAN_TOKEN` > keychain.
- [ ] `Viewer` role hides mutating subcommands from `--help` and the TUI.
- [ ] macOS uses Keychain; Linux uses Secret Service; Windows uses Credential Manager.
- [ ] If keychain is unavailable, the CLI prints a clear error and points to `--token`.
- [ ] Token expiry is checked; CLI warns 7 days before expiry.
- [ ] No token is ever written to `config.json` or any plaintext file.
- [ ] 42 existing smoke tests pass; new tests cover login, logout, whoami, role-gated subcommands.
- [ ] `tsc --noEmit` clean.

---

## Follow-on ADRs

- **CLI-007** — Idempotent Command Protocol: `command_id` + `reason` on every mutation (auth-adjacent).
