# Phase 9 — Test infrastructure & CI

**Parent ADRs:** CLI-008 (event feed), CLI-009 (snapshot/resync), CLI-010 (audit)
**Depends on:** Phase 1 (operator-client.ts), Phase 6 (audit.ts), Phase 8 (auth.ts)
**Estimated effort:** 2 weeks
**Exit criteria:** Every CLI subcommand has at least one integration test against a mock gRPC server. CI runs on every PR and blocks merge on failure. Coverage is reported per commit.

## Why this phase exists

Phases 1, 6, and 8 produced code that compiles, routes correctly, formats output, and is unit-tested for parsing/formatting/error-display. The **success paths** of every gRPC call are not tested:

- No `OperatorConsole.Login` round-trip verified.
- No `ResolveHITL` round-trip verified.
- No `QueryAudit` round-trip verified.
- No `StreamEvents` reconnect verified against an actual streaming server.
- No real OS keychain round-trip on Windows (only path-encoding is tested on Linux).

The smoke tests verify routing and error display by matching on `gRPC error` / `UNAVAILABLE` because no kernel is running. That's necessary but not sufficient — it tells you the CLI correctly reports "server is down" but it doesn't tell you the CLI correctly sends a Bearer token, computes a deterministic `command_id`, formats an audit row, or refuses to overwrite an export file when the kernel returns the expected payload.

A mock gRPC server that replays scripted responses per RPC is the standard fix. It exercises the full client → stub → handler → response pipeline without requiring a kernel, and it can be run in CI on every PR.

## Tickets (6)

| ID | Title | Effort | Depends on |
|---|---|---|---|
| `cli-90` | [x] Mock gRPC server harness | 3 days | — |
| `cli-91` | [x] Integration tests for operator auth | 2 days | cli-90 |
| `cli-92` | Integration tests for audit | 2 days | cli-90 |
| `cli-93` | Integration tests for HITL | 2 days | cli-90 |
| `cli-94` | GitHub Actions CI workflow | 1 day | cli-91..93 |
| `cli-95` | Coverage reporting | 1 day | cli-94 |

## Exit criteria (verifiable)

- [ ] `bun test` includes ≥ 30 new integration tests across cli-91, cli-92, cli-93.
- [ ] `bun test` runs in ≤ 30s on a cold cache.
- [ ] `.github/workflows/ci.yml` exists, runs on PR + push to main, and passes.
- [ ] Coverage report is uploaded as a CI artifact.
- [ ] Total test count: ≥ 111 unit + 59 smoke (was 81 + 59 before Phase 9).
- [ ] `tsc --noEmit` clean.
- [ ] No new "untested path" remains in any handler in `src/index.tsx` (every `case` in the dispatch has a corresponding test).

## Out of scope for this phase

- **Distribution / install script** — Phase 2.
- **Runtime install** (Postgres, migrations, Ollama) — Phase 3.
- **Service management** (systemd, launchd) — Phase 4.
- **Onboarding wizard rewrite** — Phase 5.
- **Polish** (uninstall, update, completions) — Phase 7.

## See also

- `docs/adr/CLI-008-event-feed-integration.md` — event feed design (Phase 1 + 9 share the test harness for `StreamEvents`).
- `docs/adr/CLI-009-snapshot-resync.md` — snapshot/resync state machine (cli-91 should test the `ResyncRequired` path).
- `docs/adr/CLI-010-audit-log-access.md` — audit log access (cli-92 covers the read path).
