# CLI-006 — Orchestrator Lifecycle Management

**Date:** 2026-06-25
**Status:** Accepted (D6 locked in `docs/plans/cli-initiative.md` Part 0)
**Author:** CLI initiative
**Depends on:** CLI-004 (install script installs the orchestrator binary), CLI-005 (wizard registers the service)
**Relates to:** CLI-009 (orchestrator status is read via `OperatorConsole.Snapshot`)

---

## Context

The CLI is the only surface that knows the orchestrator binary exists. The user doesn't manage `cambrian-orchestrator` directly; they manage the service through the CLI. The install script places the binary in `~/.cambrian/bin/cambrian-orchestrator`; the wizard (CLI-005 Step 5) registers a service; now the CLI needs the subcommands to operate that service.

Today there is no such subcommand. If the orchestrator is running, the CLI connects to it. If it isn't, the CLI prints "server unreachable" and the user has to figure out how to start it (today: `go run cmd/orchestrator/main.go` from a checkout of the repo).

D6 locks: **service-managed, auto-start disabled by default**. The service exists; it just doesn't start on boot unless the user opts in. The user always has the option to start it on demand.

---

## Decision

The CLI gets five lifecycle subcommands. All operate on the user-level service registered by the wizard.

### `cambrian start`

- Starts the orchestrator service.
- On macOS: `launchctl kickstart -k gui/$(id -u)/com.cambrian.runtime`.
- On Linux: `systemctl --user start cambrian.service`.
- Waits up to 30s for the orchestrator to be reachable (`OperatorConsole.Snapshot`).
- On success: prints `✓ Orchestrator started (PID 12345, uptime 2s)`.
- On failure: prints the journal log (last 20 lines) and a hint.

### `cambrian stop`

- Stops the orchestrator service.
- On macOS: `launchctl kill TERM gui/$(id -u)/com.cambrian.runtime`.
- On Linux: `systemctl --user stop cambrian.service`.
- On success: prints `✓ Orchestrator stopped`.
- Idempotent — if already stopped, exits 0 with a message.

### `cambrian restart`

- `stop` + `start`. Returns the start status.

### `cambrian status`

Reports the current state. Output:

```
$ cambrian status
Cambrian Runtime
─────────────────
Service:        ● running (PID 12345, uptime 2h 14m)
Server:         localhost:50051
CLI version:    0.2.0
Orchestrator:   0.6.9-alpha (contract 0047)
Operator:       admin (role: operator, token expires in 27d)
Plans in flight: 1
Sessions:       3 active, 7 total
LLM:            ollama (llama3.2:3b, healthy)
Database:       postgresql://cambrian@localhost:5432/cambrian (ok)
Disk:           1.2 GB / 10 GB used
Last plan:      "summarize errors" (2m ago, succeeded)
```

- `--json` outputs the same data as JSON for scripting.
- Reads `OperatorConsole.Snapshot` for the orchestrator-side state.
- Reads the service manager for the PID / uptime.

### `cambrian logs`

Streams the orchestrator's journal.

- On macOS: `log show --predicate 'process == "cambrian-orchestrator"' --last 1h --style compact`. Streams as new lines arrive.
- On Linux: `journalctl --user -u cambrian.service -f` (follow mode).
- `--tail 100` shows the last 100 lines without following.
- `--since 1h` filters to the last hour.
- Pipe-friendly: `cambrian logs --tail 100 | grep ERROR`.

### Service registration (D6)

The wizard (CLI-005 Step 5) generates the service file. The CLI also provides `cambrian service install` / `cambrian service uninstall` for manual control:

- `cambrian service install` — registers the service. Idempotent. On macOS: writes the plist + `launchctl load`. On Linux: writes the unit + `systemctl --user daemon-reload`. Does **not** start the service.
- `cambrian service uninstall` — removes the service. Stops it first if running. Does **not** delete the orchestrator binary or config.
- `cambrian service enable-autostart` — sets auto-start on user login. Off by default.
- `cambrian service disable-autostart` — turns auto-start off.

These are also accessible via `cambrian config set service.autostart true` (preferred for scripting) — the subcommand is a friendly wrapper.

### Service file templates (user-level, no `sudo` required)

**macOS** (`~/Library/LaunchAgents/com.cambrian.runtime.plist`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.cambrian.runtime</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/USERNAME/.cambrian/bin/cambrian-orchestrator</string>
        <string>--config</string>
        <string>/Users/USERNAME/.cambrian/configs/config.json</string>
    </array>
    <key>RunAtLoad</key>
    <false/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/USERNAME/.cambrian/logs/orchestrator.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/USERNAME/.cambrian/logs/orchestrator.err</string>
</dict>
</plist>
```

`RunAtLoad` is `false` (D6: auto-start off). `KeepAlive` is `true` (the orchestrator restarts on crash).

**Linux** (`~/.config/systemd/user/cambrian.service`):

```ini
[Unit]
Description=Cambrian Runtime Orchestrator
After=network.target

[Service]
Type=simple
ExecStart=%h/.cambrian/bin/cambrian-orchestrator --config %h/.cambrian/configs/config.json
Restart=on-failure
RestartSec=5
StandardOutput=append:%h/.cambrian/logs/orchestrator.log
StandardError=append:%h/.cambrian/logs/orchestrator.err

[Install]
WantedBy=default.target
```

`WantedBy=default.target` is set, but the service is not enabled by default (D6). `Restart=on-failure` restarts on crash.

### Subcommand surface (added to `cambrian --help`)

```
cambrian start              Start the orchestrator service
cambrian stop               Stop the orchestrator service
cambrian restart            Restart the orchestrator service
cambrian status             Show orchestrator status (use --json for scripts)
cambrian logs               Stream orchestrator logs (Ctrl-C to exit)
cambrian logs --tail 100    Show last 100 lines, don't follow
cambrian service install    Register the service (idempotent)
cambrian service uninstall  Remove the service
cambrian service enable-autostart
                            Enable auto-start on user login
cambrian service disable-autostart
                            Disable auto-start
```

---

## Options considered

| Option | What | Why rejected |
|---|---|---|
| **A. User-level service (systemd / launchd), auto-start off (chosen)** | CLI manages the service via the OS service manager. User-level (no `sudo`). Auto-start is opt-in. | Standard pattern on both platforms. Survives logout/login (auto-start) or runs on demand (default). Matches D6. |
| **B. Run the orchestrator as a child process of the CLI** | `cambrian start` spawns the orchestrator, tracks its PID, kills it on `cambrian stop`. | Doesn't survive CLI exit. If the user closes the terminal, the orchestrator dies. Bad UX. |
| **C. Always auto-start, no opt-out** | Service is enabled at install. Always running. | Aggressive. Power users will hate it. Conflicts with D6. |
| **D. Use a process manager (overmind, foreman, honcho)** | Cross-platform process management. | Adds a dependency. Doesn't integrate with the OS service manager. |

---

## Consequences

### Positive

- **One CLI to manage everything.** `cambrian start` is the only command the user needs to know.
- **Survives logout/login.** When the user opts into auto-start, the orchestrator is there on next login.
- **Survives crashes.** `KeepAlive` / `Restart=on-failure` restarts the orchestrator on crash.
- **Logs are first-class.** `cambrian logs` is the user's debugging entry point.
- **No `sudo`.** User-level service. No privilege escalation.
- **`status --json` for scripts.** CI / monitoring can poll `cambrian status --json` and parse the result.

### Negative

- **Two service file templates to maintain.** macOS plist + Linux systemd unit. Mitigated by the wizard generating them from a single source of truth (a TypeScript function).
- **Linux systemd requirement.** If the user is on a non-systemd Linux (Alpine, Devuan), the service install fails with a clear message. V1.1 will support OpenRC for Alpine.
- **`KeepAlive` / `Restart=on-failure` masks bugs.** If the orchestrator crashes in a loop, the service keeps restarting. Mitigated by `cambrian logs` showing the crash, and by `cambrian status` showing the restart count.
- **`logs` command behavior differs by platform.** macOS uses `log show`, Linux uses `journalctl`. The CLI abstracts this, but the output formats are slightly different. Mitigated by `--json` for scripts.

### Neutral

- The service name is `com.cambrian.runtime` (macOS) / `cambrian.service` (Linux). Both match the convention for user-level services.
- The log directory is `~/.cambrian/logs/`. Created by the wizard on first start.
- `cambrian service` subcommands could be merged into a `systemctl`-like interface (`cambrian service start`). Current shape follows the principle of least surprise — the same verbs as the top-level.

---

## Acceptance criteria

- [ ] `cambrian start` starts the service via launchd (macOS) or systemd (Linux).
- [ ] `cambrian stop` stops the service.
- [ ] `cambrian restart` stops then starts.
- [ ] `cambrian status` shows service state + `OperatorConsole.Snapshot` data.
- [ ] `cambrian status --json` outputs the same data as JSON.
- [ ] `cambrian logs` streams logs (Ctrl-C to exit).
- [ ] `cambrian logs --tail 100` shows the last 100 lines.
- [ ] `cambrian service install` registers the service (idempotent).
- [ ] `cambrian service uninstall` removes the service.
- [ ] `cambrian service enable-autostart` / `disable-autostart` toggle auto-start.
- [ ] Auto-start is **off** by default after install.
- [ ] Service files are user-level (no `sudo`).
- [ ] 42 existing smoke tests pass; new tests cover each lifecycle subcommand.
- [ ] `tsc --noEmit` clean.

---

## Follow-on ADRs

- **CLI-009** — Snapshot + Resync Protocol: `cambrian status` reads `OperatorConsole.Snapshot`.
- **CLI-005** — Onboarding Wizard: the wizard calls `cambrian service install` in Step 5.
