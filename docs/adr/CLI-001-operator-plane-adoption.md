# CLI-001 — Operator Plane Adoption

**Date:** 2026-06-25
**Status:** Accepted (D2 locked in `docs/plans/cli-initiative.md` Part 0)
**Author:** CLI initiative
**Depends on:** ADR-0047 (Operator Transport Plane), `ui/AGENTS.md` "Only OperatorConsole" rule
**Relates to:** CLI-002 (auth), CLI-007 (idempotent commands), CLI-008 (event feed), CLI-009 (snapshot/resync), CLI-010 (audit)

---

## Context

The Cambrian runtime exposes two gRPC planes (`api/proto/cambrian.proto`, `api/proto/operator.proto`):

| Plane | Service | Audience | Auth |
|---|---|---|---|
| Agent | `Orchestrator` + `AgentService` | AI agents | `x-agent-id` principal |
| Operator | `OperatorConsole` | Human Operator/Viewer | `authorization: Bearer <token>` (login-derived) |

The Tauri UI is bound by `ui/AGENTS.md` to **only `OperatorConsole`**: "Never call the agent-facing `Orchestrator`/`AgentService`. Never bypass the kernel." The UI is a controller over the kernel's boundary, not a back door.

The current CLI (`cli/src/grpc/client.ts`) violates this. It calls **11 RPCs on `Orchestrator`** with `x-agent-id` metadata (line 94: `baseMetadata.set("x-agent-id", cfg.operatorId)`). The 11 calls split as:

| Plane-appropriate | CLI RPCs | Status |
|---|---|---|
| **Agent-plane (correct)** | `ListTools`, `ListSkills`, `ExecuteTool`, `ListWatches`, `RegisterWatch`, `DeleteWatch`, `SetWatchActive`, `QueryMemory`, `IngestMemory` | Stay on `Orchestrator` (agent-plane by design) |
| **Operator-plane (wrong plane today)** | `WatchApprovals`, `SubmitApprovalDecision` | **Migrate** to `OperatorConsole.StreamEvents` + `OperatorConsole.ResolveHITL` |

The HITL path is the architectural drift. `WatchApprovals` and `SubmitApprovalDecision` are proto-commented as operator-plane (lines 123–126 of `cambrian.proto`), but they live on the `Orchestrator` service. ADR-0047 D11 says `ResolveHITL` (on `OperatorConsole`) is the canonical path and reuses the same backing `ApprovalHub`. The CLI uses the legacy path.

This matters because:
1. **Auth model.** The CLI today authenticates as an agent (`x-agent-id`). An operator CLI should authenticate as a human (`Bearer` token). The current model is architecturally incoherent.
2. **Idempotency + audit.** Operator-plane commands carry `command_id` (UUID) + mandatory `reason` and dedup via `operator_audit.command_id` UNIQUE (ADR-0047 D15). The agent-plane path has neither.
3. **Role enforcement.** `OperatorConsole` enforces `Operator` vs `Viewer` server-side (ADR-0047 D13). The agent-plane path has no role concept.
4. **Future operator features.** `Snapshot` (plans in flight, sessions, agents, capabilities), `StreamEvents` (23 event types including auction, plan-state, audit, LLM-health), and `QueryAudit` are all `OperatorConsole`-only. The CLI cannot reach them today.

---

## Decision

The CLI must use `OperatorConsole` (operator-plane) for all operator concerns. The migration is **full and phased** (D2), not partial.

### What migrates to `OperatorConsole`

| Today (agent-plane) | Tomorrow (operator-plane) |
|---|---|
| `WatchApprovals` (stream) | `OperatorConsole.StreamEvents` (filtered for `hitl_raised`) |
| `SubmitApprovalDecision` | `OperatorConsole.ResolveHITL` (with `command_id` + `reason`) |
| _none_ | `OperatorConsole.Login` (CLI-002) |
| _none_ | `OperatorConsole.Snapshot` (CLI-009) |
| _none_ | `OperatorConsole.QueryAudit` (CLI-010) |

### What stays on `Orchestrator`

These are agent-plane by design. The CLI's admin use of them is appropriate as direct RPC. No migration.

| RPC | Reason it stays on `Orchestrator` |
|---|---|
| `ListTools` / `ListSkills` | Tool/skill discovery is an agent concern; the CLI is a human-facing surface for the same data (ADR-0039 D, ADR-0046) |
| `ExecuteTool` | Tool execution is an agent concern; operator-initiated tool use is a dangerous capability that goes through HITL (ADR-0039 D10) |
| `ListWatches` / `RegisterWatch` / `DeleteWatch` / `SetWatchActive` | WatchConfig CRUD is agent-plane per ADR-0032 |
| `QueryMemory` / `IngestMemory` | LTM operations are agent-scope; the CLI's `memory query/write` is a human analog |
| `GetContextNode` / `PutContextNode` | ContentStore CAS is agent-plane (ADR-0022) |

These continue to use `x-agent-id` auth (the CLI is acting as an "operator agent" for these reads, which the kernel permits — the agent-plane's `x-agent-id` is not a security boundary in the same way the operator-plane's `Bearer` token is).

### The migration is phased, not big-bang

1. **Phase 1:** Add the operator client. Vendor `operator.proto`. New `src/grpc/operator-client.ts`. No existing subcommand changes.
2. **Phase 2:** Migrate the HITL path. `cambrian approve <id>` → `ResolveHITL`. `cambrian approve list` → `StreamEvents` subscription.
3. **Phase 3:** Add Login + Bearer auth (CLI-002). `x-agent-id` stays only on agent-plane calls.
4. **Phase 4:** Add `StreamEvents` subscription to the TUI (CLI-008).
5. **Phase 5:** Add `QueryAudit` (CLI-010).
6. **Phase 6:** Document the split. The two clients coexist permanently; the rule is "operator concerns → OperatorConsole, agent concerns → Orchestrator."

---

## Options considered

| Option | What | Why rejected |
|---|---|---|
| **A. Full migration (chosen)** | All operator concerns → `OperatorConsole`; agent concerns stay on `Orchestrator`. 6-phase rollout. | Matches `ui/AGENTS.md` rule. Clean architectural split. Future-proof for new `OperatorConsole` features. |
| **B. HITL-only migration** | Only `ResolveHITL` replaces `WatchApprovals`/`SubmitApprovalDecision`. Everything else stays on `Orchestrator` forever. | Ongoing ambiguity about which path to use. No Login flow. No event feed. No audit. |
| **C. Wrap the kernel's existing HTTP admin API** | The kernel has a "small operator HTTP API for a handful of administrative actions" (per `docs/prd/0047-operator-transport-plane-prd.md`). | Not the canonical path. `OperatorConsole` is. HTTP API is a legacy surface. |
| **D. Custom glue code / tricks** | Bypass the proto, talk to the kernel's internals directly. | Explicitly forbidden by your instruction: "never touch runtime part, instead rely on universal interfaces that only the runtime provides." |

---

## Consequences

### Positive

- **Architectural coherence.** The CLI and the UI both use `OperatorConsole`. Same auth model, same event feed, same audit log.
- **Future-proof.** New `OperatorConsole` features (new event types, new commands, new role capabilities) become available to the CLI automatically.
- **Security.** The CLI gets proper per-user auth with role enforcement. The `operatorId` config field is replaced by a login identity.
- **Observability.** The TUI gains `StreamEvents` (23 event types) — live auction, plan state, HITL raised, audit, LLM health, agent ready. Replaces the current polling-based state.
- **Audit.** Every mutating command hits the durable `operator_audit` table with `command_id` + `reason`. Compliant with the kernel's audit story.

### Negative

- **Migration work.** ~3 weeks of focused work for one engineer (per `docs/plans/cli-initiative.md` Part 8). Mostly the keychain integration (CLI-002) and the TUI event-feed rewrite (CLI-008).
- **Two clients in the binary.** The CLI bundles both `cambrian.proto` and `operator.proto`. The runtime proto surface grows. Negligible bundle-size impact (~50 KB).
- **Conceptual split.** Engineers working on the CLI must understand which plane each concern lives on. Mitigated by the `cli/CONTEXT.md` rule "operator concerns → OperatorConsole, agent concerns → Orchestrator."
- **Breaking change for existing CLI users.** Anyone scripting against the current `x-agent-id` auth on HITL needs to update. Mitigation: ship a deprecation warning, not a hard break, in the first release that adds `Login`.

### Neutral

- The agent-plane calls stay as-is. The CLI remains a valid consumer of `Orchestrator` for admin use of agent-plane data.
- The proto vendoring pattern is the same as the UI's (header says "VENDORED — DO NOT EDIT BY HAND", pinned to contract `0047`).

---

## Acceptance criteria

- [ ] `cli/proto/operator.proto` exists, vendored from `api/proto/operator.proto`, with a header matching `ui/proto/operator.proto`'s pinning comment.
- [ ] `src/grpc/operator-client.ts` exists with typed wrappers for `Login`, `Snapshot`, `StreamEvents`, `ResolveHITL`, `QueryAudit`, and the command RPCs.
- [ ] `cambrian approve <id>` and `cambrian deny <id>` call `OperatorConsole.ResolveHITL`.
- [ ] `cambrian approve list` subscribes to `OperatorConsole.StreamEvents`.
- [ ] `cambrian login` / `cambrian logout` / `cambrian whoami` exist and round-trip through `OperatorConsole.Login`.
- [ ] `x-agent-id` is removed from operator-plane calls; `authorization: Bearer <token>` is used instead.
- [ ] `cli/CONTEXT.md` documents the "operator concerns → OperatorConsole, agent concerns → Orchestrator" rule.
- [ ] 42 existing smoke tests pass; new tests cover the operator-plane path.
- [ ] `tsc --noEmit` clean.

---

## Follow-on ADRs

- **CLI-002** — Auth Model (Login + Bearer + Roles): how the CLI stores and sends the token.
- **CLI-007** — Idempotent Command Protocol: `command_id` + `reason` on every mutation.
- **CLI-008** — Event Feed Integration: how the TUI subscribes to `StreamEvents`.
- **CLI-009** — Snapshot + Resync Protocol: bootstrap + reconnect logic.
- **CLI-010** — Audit Log Access: `QueryAudit`-backed subcommands.
