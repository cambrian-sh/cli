# CLI-009 — Snapshot + Resync Protocol

**Date:** 2026-06-25
**Status:** Accepted
**Author:** CLI initiative
**Depends on:** CLI-001 (operator plane), CLI-008 (event feed)
**Relates to:** CLI-006 (`cambrian status` reads `Snapshot`)

---

## Context

`OperatorConsole.Snapshot` is the kernel's one-shot read of bounded live operational state. It returns:

- `as_of_seq` — the lower-bound cursor for resuming the event feed
- `plans[]` — plans currently in flight
- `sessions[]` — sessions (active, paused, dormant, completed)
- `agents[]` — registered agents with live state + TrustScore
- `kernel_version`, `contract_version` — version handshake
- `capabilities[]` — what the kernel advertises it supports

The snapshot is **not atomic** (ADR-0047 D6) — it fans in over the in-memory projection, BBolt, and Postgres, which takes real time. Locking the sequencer across those reads would stall publishers (forbidden by D2). Instead, `as_of_seq` is captured **at the start of the snapshot read** as a lower bound. The client resumes `StreamEvents` from `as_of_seq + 1`.

Re-delivering events the snapshot already absorbed is **harmless** because every event is an absolute-state assignment, not a delta. Re-applying is idempotent. **Gaps are impossible (lower bound); duplicates are harmless (idempotent fold).**

This ADR defines the exact bootstrap + resync + reconnect protocol for the CLI.

---

## Decision

The CLI follows a strict **snapshot → subscribe → resync on demand** protocol. The same protocol is used for the initial connect, the post-error reconnect, and the `ResyncRequired` event.

### Phase 1 — Initial connect

```
1. CLI calls OperatorConsole.Snapshot() with no args.
2. Server captures as_of_seq = current sequencer value.
3. Server reads in-memory projection, BBolt, Postgres (in parallel, no lock).
4. Server returns SnapshotResponse{as_of_seq, plans[], sessions[], agents[], kernel_version, contract_version, capabilities[]}.
5. CLI hydrates local state from the response.
6. CLI calls OperatorConsole.StreamEvents({last_seq: as_of_seq}).
7. Server starts sending events from as_of_seq + 1.
8. CLI folds events into local state (idempotent with snapshot).
```

The total wall time for steps 1–4 is bounded (typically <500ms). If `Snapshot` times out (>5s), the CLI shows a "server slow" state and retries.

### Phase 2 — Continuous operation

The stream is open. Events arrive. The TUI folds them. See CLI-008 for the event dispatch.

### Phase 3 — Reconnect (stream error)

If the stream errors (network blip, server restart, gRPC `Unavailable`):

1. CLI closes the stream.
2. CLI starts backoff timer: `delay = min(30, 1 * 2^attempt) * (0.9 + 0.2 * random())`.
3. On timer expiry: call `Snapshot` again (Phase 1 from step 1).
4. On success: open the stream again with the new `as_of_seq`.
5. On failure: increment `attempt`, schedule next retry.
6. After 5 failed attempts: show "kernel unreachable" state. The user can press `r` to retry from scratch.

The `attempt` counter resets to 0 on any successful stream event.

### Phase 4 — ResyncRequired

The server can send a `resync` event on the stream (per ADR-0047 D9 — when the client's cursor ages out of the 120s spool):

1. CLI receives `resync` event.
2. CLI closes the stream.
3. CLI calls `Snapshot` again (Phase 1 from step 1).
4. CLI reopens the stream with the new `as_of_seq`.
5. The server replays events from the new `as_of_seq + 1`. Duplicates are harmless.

**No special logic for duplicates** — the fold is idempotent. The TUI may briefly show a "syncing..." indicator, then return to normal.

### Phase 5 — Version skew

`Snapshot` returns `kernel_version` and `contract_version`. The CLI compares against its own embedded version:

- If `contract_version` matches what the CLI was built against: normal operation.
- If `contract_version` is **newer** than the CLI: warn "Your CLI is older than the kernel. Some features may not work. Run `cambrian update`." (The CLI may not understand all event types in the new contract.)
- If `contract_version` is **older** than the CLI: warn "Your CLI is newer than the kernel. Some features may not work. Update the kernel." (The CLI expects event types the kernel can't send.)

The CLI uses its embedded `capabilities[]` to gate subcommands. If a subcommand requires a capability the kernel doesn't advertise, the CLI shows "Kernel does not support this feature" instead of failing with an unknown RPC error.

### State machine

```
            ┌──────────────┐
            │  DISCONNECTED │
            └──────┬───────┘
                   │ cambrian / login / first run
                   ▼
            ┌──────────────┐  Snapshot error    ┌──────────────┐
            │  SNAPSHOTTING │ ────────────────▶ │  RETRYING    │
            └──────┬───────┘                   └──────┬───────┘
                   │ Snapshot ok                       │ 5 fails
                   ▼                                    ▼
            ┌──────────────┐  Stream error    ┌──────────────┐
            │  STREAMING    │ ───────────────▶ │  RETRYING    │
            └──────┬───────┘                   └──────┬───────┘
                   │ ResyncRequired                     │ ok
                   ▼                                    ▼
            ┌──────────────┐                   (back to STREAMING)
            │  RESYNCING   │
            └──────┬───────┘
                   │ ok
                   ▼
            (back to STREAMING)
```

The TUI status bar shows the current state with a small icon:
- `●` green = streaming
- `↻` yellow = retrying (with attempt count)
- `…` blue = snapshotting / resyncing
- `○` gray = disconnected

### Timeout and deadline values

| Phase | Timeout |
|---|---|
| `Snapshot` RPC | 5s (matches existing CLI convention) |
| `StreamEvents` initial response | 5s |
| Individual event arrival (between events) | 60s — if no event arrives in 60s, assume the stream is dead and reconnect |
| `ResolveHITL` / command RPCs | 15s (matches existing CLI convention) |

The 60s inter-event timeout is a safety net. The feed is supposed to be quiet when nothing is happening, but a truly dead stream shows up as "no events" — the timeout catches it.

### Concurrency

- The TUI has a **single subscription** to `StreamEvents`. Multiple panes read from the same folded state.
- `Snapshot` is called serially (only one in flight at a time). A re-snapshot during a re-snapshot is queued, not parallel.
- Mutating RPCs (`ResolveHITL`, `SetToolGrant`, etc.) are called on demand from user input. They do not share the event stream.

### Storage of `as_of_seq`

- The CLI does **not** persist `as_of_seq` across CLI restarts. Each new `cambrian` invocation starts with `last_seq = 0` (snapshot) and replays the spool.
- Persistence could be a V1.1 feature (re-open the CLI and resume from where you left off without a re-snapshot). For V1, snapshot on every connect is the right trade-off (simpler, no stale state).

---

## Options considered

| Option | What | Why rejected |
|---|---|---|
| **A. Snapshot → subscribe → resync on demand (chosen)** | Standard pattern from ADR-0047 D6/D9/D10. Matches the UI. Idempotent. | This is what the architecture is designed for. |
| **B. Persist `as_of_seq` across restarts** | Re-open the CLI and resume from where you left off. | Edge case. V1 users will tolerate a brief re-snapshot on every launch. V1.1 follow-up. |
| **C. Long-lived bidirectional stream** | One stream for everything: events + commands. | The architecture uses a unidirectional server-stream for events and unary RPCs for commands. Cleaner separation. |
| **D. Poll `Snapshot` on a timer** | Skip the event feed entirely. | Stale. Wasteful. Loses realtime. |

---

## Consequences

### Positive

- **Recovery is automatic.** Stream errors trigger reconnect with backoff. The user sees a clear state, not a crash.
- **No data loss.** The fold is idempotent. The snapshot is a lower bound. Re-resync handles the spool age-out.
- **Bounded latency.** Events arrive within 100ms of the kernel emitting them. Status bar updates feel instant.
- **Kernel version skew is visible.** The user knows when their CLI is out of date.

### Negative

- **Snapshot on every CLI launch.** ~500ms cold start penalty. Acceptable for a CLI.
- **State machine complexity.** 5 states (DISCONNECTED, SNAPSHOTTING, STREAMING, RETRYING, RESYNCING). Mitigated by the status bar icon.
- **60s inter-event timeout may trigger false reconnects.** If the kernel is idle for 60s (no plans, no activity), the CLI may think the stream is dead. Mitigated by the kernel's `heartbeat` event (if present) or by accepting that idle systems reconnect occasionally.

### Neutral

- The CLI does not implement a `heartbeat` event subscription. If the kernel doesn't send a heartbeat, the 60s timeout is the only liveness check. This is fine for V1.

---

## Acceptance criteria

- [ ] Initial connect: `Snapshot` then `StreamEvents(as_of_seq)`.
- [ ] Snapshot bootstrap latency: <500ms on a typical connection.
- [ ] Stream error triggers backoff: 1s, 2s, 4s, 8s, 16s, 30s (cap), ±10% jitter.
- [ ] After 5 failed reconnect attempts, show "kernel unreachable" state.
- [ ] `ResyncRequired` event triggers a clean re-snapshot + resubscribe.
- [ ] 60s inter-event timeout triggers a reconnect.
- [ ] `kernel_version` and `contract_version` from snapshot are compared to the CLI's embedded versions; skew is reported.
- [ ] `capabilities[]` is used to gate subcommands.
- [ ] Status bar shows the current state with a colored icon.
- [ ] 42 existing smoke tests pass; new tests cover: bootstrap, reconnect with backoff, resync, timeout, version skew, capabilities gating.
- [ ] `tsc --noEmit` clean.

---

## Follow-on ADRs

None — this is the leaf protocol.
