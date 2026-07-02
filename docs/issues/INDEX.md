# CLI Initiative — Tickets Index

**Source plan:** `docs/plans/cli-initiative.md` (frozen 2026-06-25)
**ADRs:** `docs/adr/CLI-001` through `CLI-010`

---

## Phase 0 — Architecture (lock decisions)

| ID | Title | Status | Blocks |
|---|---|---|---|
| `cli-01` | Naming convention (CLI-NNN) | **DONE** (locked in plan) | — |
| `cli-02` | Distribution channels (GitHub Releases V1) | **DONE** (locked) | CLI-003 |
| `cli-03` | Auth flow (Login + --token) | **DONE** (locked) | CLI-002 |
| `cli-04` | Platform support (macOS + Linux V1) | **DONE** (locked) | CLI-003/004 |
| `cli-05` | Service manager scope (managed, auto-start off) | **DONE** (locked) | CLI-006 |

---

## Phase 1 — Operator plane migration (foundation)

**Parent ADR:** CLI-001, CLI-007, CLI-009
**Estimated effort:** 3 weeks
**Exit criteria:** HITL path goes through `OperatorConsole` end-to-end.

| ID | Title | Parent ADR | Status |
|---|---|---|---|
| `cli-10` | Vendor `operator.proto` to `cli/proto/` | CLI-001 | **TODO** |
| `cli-11` | Update `embed-proto.ts` for `operator.proto` | CLI-001 | **TODO** |
| `cli-12` | Add `src/grpc/operator-client.ts` typed wrappers | CLI-001 | **TODO** |
| `cli-13` | Migrate HITL path (approve/deny → `ResolveHITL`) | CLI-001, CLI-007 | **TODO** |
| `cli-14` | Migrate `cambrian approve list` to `StreamEvents` | CLI-001, CLI-008 | **TODO** |
| `cli-15` | Add `command_id` + `reason` to all mutating subcommands | CLI-007 | **TODO** |

Detailed ticket files:
- `cli-10-vendor-operator-proto.md`
- `cli-11-update-proto-embed.md`
- `cli-12-add-operator-console-client.md`
- `cli-13-migrate-hitl-resolve-hitl.md`
- `cli-14-migrate-approve-list-stream-events.md`
- `cli-15-idempotent-command-protocol.md`

---

## Phase 2 — Distribution

**Parent ADR:** CLI-003, CLI-004
**Estimated effort:** 2 weeks
**Exit criteria:** `curl | sh` installs the CLI and orchestrator on a clean machine.

| ID | Title | Parent ADR | Status |
|---|---|---|---|
| `cli-20` | `bun build --compile` per platform | CLI-003 | TODO |
| `cli-21` | GitHub Actions tag-driven release | CLI-003 | TODO |
| `cli-22` | `install.sh` + `cambrian.dev/install.sh` hosting | CLI-004 | TODO |

---

## Phase 3 — Runtime install + setup

**Parent ADR:** CLI-004, CLI-005
**Estimated effort:** 2 weeks
**Exit criteria:** `cambrian init` installs Postgres, runs migrations, generates config.

| ID | Title | Parent ADR | Status |
|---|---|---|---|
| `cli-30` | Platform detection (macOS brew / Linux apt-dnf) | CLI-005 | TODO |
| `cli-31` | Postgres + pgvector install | CLI-005 | TODO |
| `cli-32` | DB + role creation | CLI-005 | TODO |
| `cli-33` | Migration runner | CLI-005 | TODO |
| `cli-34` | Config generation (with secret_key, LLM provider) | CLI-005, CLI-007 | TODO |
| `cli-35` | LLM provider install (Ollama default, pull model) | CLI-005 | TODO |
| `cli-36` | Manual install docs (cambrian.dev/manual-install) | CLI-003 | TODO |

---

## Phase 4 — Service management

**Parent ADR:** CLI-006
**Estimated effort:** 1 week
**Exit criteria:** `cambrian start|stop|restart|status|logs` work on macOS + Linux.

| ID | Title | Parent ADR | Status |
|---|---|---|---|
| `cli-40` | systemd user unit template | CLI-006 | TODO |
| `cli-41` | launchd plist template | CLI-006 | TODO |
| `cli-42` | `cambrian start|stop|restart` | CLI-006 | TODO |
| `cli-43` | `cambrian status` + `cambrian logs` | CLI-006, CLI-009 | TODO |

---

## Phase 5 — First-run experience

**Parent ADR:** CLI-004, CLI-005
**Estimated effort:** 1 week
**Exit criteria:** First `cambrian` invocation runs the full wizard to success.

| ID | Title | Parent ADR | Status |
|---|---|---|---|
| `cli-50` | Onboarding wizard rewrite (5-step → 8-step) | CLI-005 | TODO |
| `cli-51` | Telemetry opt-in (D9) + endpoint | CLI-004 | TODO |
| `cli-52` | Success card + time-to-green telemetry | CLI-005 | TODO |

---

## Phase 6 — Audit + observability

**Parent ADR:** CLI-008, CLI-009, CLI-010
**Estimated effort:** 1 week
**Exit criteria:** TUI is event-driven; `cambrian audit` works.

| ID | Title | Parent ADR | Status |
|---|---|---|---|
| `cli-60` | TUI subscribes to `StreamEvents` (feed fold) | CLI-008 | TODO |
| `cli-61` | Snapshot + resync + reconnect state machine | CLI-009 | TODO |
| `cli-62` | `cambrian audit list|show|export` | CLI-010 | TODO |

---

## Phase 7 — Polish

**Parent ADR:** (cross-cutting)
**Estimated effort:** 1 week
**Exit criteria:** `cambrian uninstall` + `cambrian update` + completions.

| ID | Title | Parent ADR | Status |
|---|---|---|---|
| `cli-70` | `cambrian login` + OS keychain integration | CLI-002 | TODO |
| `cli-71` | `cambrian update` + version check | CLI-003 | TODO |
| `cli-72` | `cambrian uninstall` clean removal | (cross-cutting) | TODO |

---

## Phase 8 — Auth model

**Parent ADR:** CLI-002
**Estimated effort:** 1 week
**Exit criteria:** Login flow works, role-gated subcommands hidden from Viewers.

| ID | Title | Parent ADR | Status |
|---|---|---|---|
| `cli-80` | `cambrian login` + keychain store | CLI-002 | TODO |
| `cli-81` | `cambrian whoami` + role reflection | CLI-002 | TODO |
| `cli-82` | `--token` / `CAMBRIAN_TOKEN` one-shot | CLI-002 | TODO |
| `cli-83` | Hide mutating subcommands from Viewer role | CLI-002 | TODO |

---

## V1 Ship Definition

The CLI ships V1 when all tickets above are **DONE** AND:

- [ ] `curl -fsSL https://cambrian.dev/install.sh | sh` works on macOS arm64, macOS x64, Linux x64 (glibc), Linux arm64 (glibc).
- [ ] Install + setup completes in < 5 min on a clean machine.
- [ ] 42 existing smoke tests pass; new tests cover all 10 ADRs' acceptance criteria.
- [ ] `tsc --noEmit` clean.
- [ ] `cambrian doctor` returns green on a healthy install.
- [ ] `cambrian update` works on all V1 platforms.
- [ ] `cambrian uninstall` cleans up the user-level install completely.
- [ ] No `sudo` is required for any V1 operation.

---

## Implementation order (recommended)

1. **Phase 1** first — operator plane migration is the foundation for everything else.
2. **Phase 2** next — distribution is needed before users can try the CLI.
3. **Phase 3** + **Phase 4** together — the setup wizard and service management.
4. **Phase 5** — the first-run experience.
5. **Phase 6** + **Phase 8** in parallel — audit and auth.
6. **Phase 7** — polish, last.

Each phase is a release. Phases 1–2 are a working CLI; Phases 3–5 are a shippable V1; Phases 6–8 are the V1 feature-complete state.
