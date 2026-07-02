# CLI-008 — Event Feed Integration

**Date:** 2026-06-25
**Status:** Accepted
**Author:** CLI initiative
**Depends on:** CLI-001 (operator plane), CLI-002 (auth), ADR-0047 D4–D9 (feed architecture)
**Relates to:** CLI-009 (snapshot/resync), the TUI components

---

## Context

The current TUI polls the agent-plane `Orchestrator` RPCs to refresh its four panes (Approvals, Tools, Watches, Skills). This is wasteful and stale. The kernel already has a real-time event feed — `OperatorConsole.StreamEvents` — that the CLI does not use.

`StreamEvents` carries **23 event types** (from `api/proto/operator.proto` `OperatorEvent` oneof):

- `resync` — server is telling the client to resnapshot
- `auction` — auction lifecycle (open, bid, close, winner)
- `agent_ready` — agent became available
- `session_dormant` / `session_completed` — session lifecycle
- `memory_pressure` — LTM pressure warning
- `daemon_crashed` — daemon agent crashed
- `watch_triggered` — a watch rule fired
- `memory_written` — new memory doc written
- `hitl_raised` — a HITL intervention needs an operator
- `verifier_round` — verifier scoring
- `llm_health` — LLM provider health change
- `plan_state` — plan execution state change
- `audit` — a mutation was audited
- `token` — live-only token stream (`seq=0`, never replayed)

The events have a **global monotonic `seq`** (ADR-0047 D4). Events are **absolute-state**, not deltas (D6) — re-applying an event is idempotent. Token events are the sole exception: live-only, never replayed (D7).

This means the TUI can become a **feed-folding projection** (D7) — the canonical pattern for the UI. The TUI subscribes once, folds events into local state, and the UI is always live.

---

## Decision

The CLI TUI subscribes to `OperatorConsole.StreamEvents`. The TUI's local state is a **fold of the feed** plus a periodic `Snapshot` for ephemeral runtime state (plans in flight, sessions).

### Lifecycle

```
┌──────────┐   1. Login → token        ┌──────────┐
│  CLI TUI │ ─────────────────────────▶│ Operator │
│          │                            │  Kernel  │
│          │   2. Snapshot              │          │
│          │ ◀─────────────────────────│          │
│          │                            │          │
│          │   3. StreamEvents(seq=as_of)            │
│          │ ◀═══════ events ════════▶│          │
│          │                            │          │
│          │   4. ResyncRequired        │          │
│          │ ◀─────────────────────────│          │
│          │                            │          │
│          │   5. Snapshot + resubscribe            │
│          │ ◀═══════ events ════════▶│          │
└──────────┘                            └──────────┘
```

### Snapshot bootstrap (one-time on connect)

1. TUI calls `OperatorConsole.Snapshot`.
2. Receives `as_of_seq` and the initial state (plans in flight, sessions, agents, capabilities, kernel/contract version).
3. Hydrates the local state from the snapshot.
4. Subscribes to `StreamEvents` with `last_seq = as_of_seq`.

### Event folding (continuous)

For each event from `StreamEvents`:

1. Check `event.seq`. If `event.seq <= last_seq` (gap or duplicate), apply idempotently (D6 — events are absolute-state). No harm.
2. Update `last_seq = event.seq`.
3. Dispatch by `event.payload` oneof type:

| Event | TUI action |
|---|---|
| `resync` | Trigger Step 5 (re-snapshot). |
| `auction` | Update Auctions pane (if visible) or TUI status bar. |
| `agent_ready` | Update Agents list. |
| `session_dormant` / `session_completed` | Update Sessions list. |
| `memory_pressure` | Warn in status bar. |
| `daemon_crashed` | Surface an alert. |
| `watch_triggered` | Log to Activity feed. |
| `memory_written` | No TUI action (read-side surfaces update on next snapshot/poll). |
| `hitl_raised` | **Critical:** surface in the Approvals pane immediately. Beep / flash if enabled. |
| `verifier_round` | No TUI action (read-side). |
| `llm_health` | Update status bar (LLM: healthy / degraded / down). |
| `plan_state` | Update Plans in Flight pane. |
| `audit` | Update Activity feed. |
| `token` (`seq=0`) | Live token stream for the active plan. Append to the chat surface if visible. |

### Reconnect logic (backoff + jitter)

Matches ADR-0047 D10 and `ui/AGENTS.md`:

- Base delay: 1s. Factor: 2. Cap: 30s. Jitter: ±10%.
- Pattern: `delay = min(30, 1 * 2^attempt) * (0.9 + 0.2 * random())`.
- Max attempts: 5 (then surface "kernel unreachable" — a first-class state, not an error).
- Reset on successful reconnect.
- The TUI shows the reconnect state in the status bar: `Reconnecting (attempt 2/5, 4s)` → `Connected`.

### `ResyncRequired` handling

If the server sends a `resync` event (cursor aged out of the 120s spool per D9):

1. TUI clears the event-fold state.
2. Calls `OperatorConsole.Snapshot` again.
3. Resubscribes with the new `as_of_seq`.
4. The kernel resends events from `as_of_seq + 1`. The TUI re-folds them. Idempotent — duplicates are harmless.

### What the TUI shows (live)

The 4 panes get these event-driven updates:

| Pane | Event source | Update |
|---|---|---|
| Approvals (left, default focus) | `hitl_raised`, `audit` (filtered) | New HITL requests appear at the top. Resolved requests disappear. `y` / `n` calls `ResolveHITL` (CLI-007). |
| Tools (right top) | `agent_ready` (filtered) | Tools list updates as new tools are registered. (Rare in V1; mainly visible during `RegisterMCP` / `RegisterSkill`.) |
| Watches (right middle) | `watch_triggered`, `agent_ready` | Watch status updates. Triggered watches highlight. |
| Skills (right bottom) | `agent_ready` | Skills list updates. |
| Status bar | `llm_health`, `plan_state`, daemon state | Live health, current plan, uptime. |

### Activity feed (new pane)

A 5th pane (bottom, collapsible with `[` / `]`) shows a rolling log of the last 100 events. Useful for "what just happened?" when the user is not actively watching.

### Token events (special case)

`token` events have `seq=0` and are **live-only** (ADR-0047 D7). They never replay. The TUI accumulates them as they arrive, displays them in the active plan's output area, and discards them on disconnect. On reconnect, the active plan's full text is re-read from the snapshot's plan state (D7: snapshot has the plan's accumulated output).

### `command_id` in the fold

`audit` events carry a `command_id` (from CLI-007). The TUI uses this to deduplicate: if a `command_id` is already in the local "my recent commands" list, don't re-add it. This is how the TUI knows "this was my action" vs "this was someone else's action."

### Performance

The 120s spool (D9) + idempotent fold + absolute-state events means the TUI's memory footprint is bounded by the spool window, not by total history. Per-event application is O(1) lookup in a hash map. The TUI can fold thousands of events per second on a laptop.

### Failure modes

| Failure | TUI response |
|---|---|
| `Snapshot` returns `Unavailable` | Show "Cannot reach server at <host:port>. Press `r` to retry, `c` to change config, `q` to quit." |
| `StreamEvents` stream errors | Backoff + jitter reconnect. Show "Reconnecting (attempt N/5, Xs)..." in status bar. |
| `ResyncRequired` mid-fold | Clear state, re-snapshot, resubscribe. Show brief "Syncing..." indicator. |
| Token rejected (expired) | Show "Session expired. Press `l` to log in again." (CLI-002 logout + re-login flow.) |

---

## Options considered

| Option | What | Why rejected |
|---|---|---|
| **A. Subscribe to StreamEvents, fold into local state (chosen)** | Standard feed-fold pattern. Matches the UI. Live + idempotent. | This is what the architecture is designed for. |
| **B. Keep polling** | Continue calling `ListTools` / `ListWatches` / `WatchApprovals` on a timer. | Stale. Wasteful. The kernel already has a feed. |
| **C. WebSocket / SSE feed** | Add a separate streaming protocol. | ADR-0047 already chose gRPC streaming. Adding WebSocket is complexity for no gain. |
| **D. Subscribe only to a subset of events** | e.g., only `hitl_raised` and `plan_state`. | The TUI wants live state for all four panes. Subscribing to all is cheap (one stream). |

---

## Consequences

### Positive

- **Live by default.** No "click to refresh" anywhere. Every state change is reflected within the event delivery latency (typically <100ms).
- **Cheap.** One stream. O(1) per event. No polling. No N parallel RPCs on a timer.
- **Aligned with the UI.** Same pattern, same resilience, same vocabulary.
- **Bounded memory.** The 120s spool is the upper bound on TUI memory. Tokens are ephemeral.
- **First-class "kernel unreachable" state.** The TUI shows it honestly, recovers automatically, never hides failures.

### Negative

- **TUI rewrite.** All four panes move from "poll on interval" to "fold on event." The `useEffect` / `useState` logic in each pane changes. ~2 weeks of work.
- **ResyncRequired handling is subtle.** The TUI must clear state cleanly, re-snapshot, and resubscribe. Mistakes here cause stale state or duplicate events (harmless but ugly).
- **Token events need special handling.** `seq=0` means the fold ignores them. Accumulated tokens must be in the snapshot's plan state, not in the fold.
- **Backoff caps need tuning.** 5 attempts × 30s = 2.5 min before "kernel unreachable." The UI uses the same; we're following the same.

### Neutral

- The Activity feed (5th pane) is new. It's not strictly necessary; it's a debugging convenience. Could be deferred to V1.1.
- The TUI's local state shape is now driven by events, not by RPCs. This is a cleaner architecture but requires unlearning the "call RPC, render result" pattern.

---

## Acceptance criteria

- [ ] TUI subscribes to `StreamEvents` on connect, after `Snapshot` completes.
- [ ] TUI folds events into local state idempotently.
- [ ] `hitl_raised` events surface in the Approvals pane within 200ms.
- [ ] `plan_state` events update the Status bar.
- [ ] `llm_health` events update the LLM indicator.
- [ ] `token` events append to the active plan's output area, `seq=0`, never replayed.
- [ ] `ResyncRequired` triggers a clean re-snapshot + resubscribe.
- [ ] Stream errors trigger backoff+jitter reconnect (1s base, 2×, cap 30s, ±10%, max 5 attempts).
- [ ] `Snapshot` returning `Unavailable` shows a clear "cannot reach server" state with `r` / `c` / `q` actions.
- [ ] Token expiration shows a "session expired" state with re-login prompt.
- [ ] Activity feed shows the last 100 events (collapsible).
- [ ] 42 existing smoke tests pass; new tests cover: event dispatch by type, idempotent fold, resync, reconnect, token-event accumulation.
- [ ] `tsc --noEmit` clean.

---

## Follow-on ADRs

- **CLI-009** — Snapshot + Resync Protocol: details of the bootstrap and re-snapshot flow.
