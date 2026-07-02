# CLI-005 — Onboarding Wizard Expansion

**Date:** 2026-06-25
**Status:** Accepted (D7, D8, D10 locked in `docs/plans/cli-initiative.md` Part 0)
**Author:** CLI initiative
**Depends on:** CLI-004 (install script hands off here), CLI-006 (orchestrator lifecycle — `cambrian init` calls `cambrian start`)
**Relates to:** CLI-002 (auth — login happens at the end of init)

---

## Context

The current onboarding wizard (`cli/src/tui/Onboarding.tsx`, 193 lines) is a 5-step flow that only configures the **CLI's own connection** to the orchestrator:

1. Welcome
2. Server address (default `localhost:50051`)
3. Operator name
4. Test connection
5. Save

It assumes the orchestrator is already running, Postgres is set up, the DB is migrated, and the user just needs to point the CLI at it. This is wrong for the vision: the user has just run `curl | sh` and has **nothing** installed beyond the CLI binary and the orchestrator binary.

D8 locks the answer: the **first `cambrian` invocation auto-triggers the full stack setup wizard.** The install script ends by running `cambrian` (no args); the CLI detects "first run" and launches the wizard. There's no separate `cambrian init` command — the wizard IS init.

---

## Decision

Replace the 5-step connection-only wizard with a **full stack setup wizard**. Triggered when:
- No `~/.cambrian/config.json` exists (or it has no `telemetry_enabled` key — a signal of "first install").
- No `cambrian` database exists (psql probe).
- No orchestrator process is running (snapshot probe).

Any of these conditions = first run = launch the wizard.

### Wizard steps (the new sequence)

```
┌──────────────────────────────────────────────────────────────┐
│  Welcome to Cambrian                                          │
│  ───────────────────                                          │
│  This wizard will:                                            │
│    1. Detect and install missing dependencies                 │
│    2. Set up the database                                      │
│    3. Configure Cambrian                                       │
│    4. Register a service                                       │
│    5. Start the orchestrator                                   │
│    6. Verify everything works                                  │
│                                                              │
│  Estimated time: 3-5 minutes                                  │
│                                                              │
│  Press Enter to continue, Ctrl-C to abort                     │
└──────────────────────────────────────────────────────────────┘
```

**Step 1 — Dependency detection + install**
- Check for: `psql`, `pg_config`, `python3`, `ollama`.
- For each missing: detect platform → install via `brew install` (macOS), `apt install` (Debian), `dnf install` (Fedora). Show progress with a spinner.
- If install fails (unsupported platform, permission denied, package not in repo): show manual install instructions and offer "Skip" (degrades the setup — some features won't work).
- If the user has a custom Postgres: ask "Where is your Postgres? [default: localhost:5432]". Then probe connectivity.

**Step 2 — Database setup**
- Create the `cambrian` role + DB if missing.
- Run all `db/migrations/*.sql` in order. Track applied set in `schema_migrations` table.
- If migrations fail: print the failed migration, the error, the rollback command. Offer "Retry" or "Abort".

**Step 3 — LLM provider (D10)**
- Detect Ollama: `ollama --version`. If present, default to it.
- If no Ollama: "Cambrian uses an LLM to plan and execute. Options: [1] Install local Ollama (recommended, ~2 GB download), [2] Use OpenAI (needs API key), [3] Use Anthropic (needs API key), [4] Configure later."
- If Ollama chosen: install if missing, pull `llama3.2:3b` (default). Show progress.
- If API key chosen: prompt for the key, store in `~/.cambrian/config.json` (or env var).
- "Configure later" = write `llm.provider: "none"` and warn at end.

**Step 4 — Config generation**
- Write `~/.cambrian/configs/config.json` with safe defaults:
  - `server: localhost:50051`
  - `db.url: postgresql://cambrian@localhost:5432/cambrian`
  - `llm.provider: ollama | openai | anthropic`
  - `llm.model: llama3.2:3b` (or as configured)
  - `secret_key: <32-byte random, generated>`
  - `audit.enabled: true`

**Step 5 — Service registration (D6)**
- macOS: generate `~/Library/LaunchAgents/com.cambrian.runtime.plist`, `launchctl load`.
- Linux: generate `~/.config/systemd/user/cambrian.service`, `systemctl --user enable --now cambrian.service`.
- Auto-start is **off by default** (D6). The service starts on user login only if the user opts in.
- Skip if the user prefers manual start.

**Step 6 — First start + verify**
- `cambrian start` (CLI-006).
- Wait for `OperatorConsole.Snapshot` to return.
- Show: "✓ Cambrian is running." + a one-line status.
- Time-to-green recorded for telemetry (D9).

**Step 7 — Login (CLI-002)**
- Prompt: "Create the first operator account? [Y/n]"
- If yes: prompt for username + password, call `OperatorConsole.Login`, store token in keychain.
- If no: print "You can log in later with `cambrian login`."

**Step 8 — Done**
```
┌──────────────────────────────────────────────────────────────┐
│  ✓ Cambrian is ready                                          │
│  ───────────────────                                          │
│  Server:    localhost:50051                                   │
│  Database:  postgresql://cambrian@localhost:5432/cambrian      │
│  LLM:       ollama (llama3.2:3b)                              │
│  Operator:  admin                                             │
│  Time:      3m 42s                                            │
│                                                              │
│  Try:                                                         │
│    cambrian                    # launch the TUI                │
│    cambrian chat "summarize"   # run your first plan          │
│    cambrian doctor             # verify everything is healthy  │
│    cambrian help               # see all commands              │
└──────────────────────────────────────────────────────────────┘
```

### What about the current 5-step wizard?

Deprecated. The 5 steps (welcome, server, operator, test, save) are subsumed by the new wizard's steps 1–7. The `Onboarding.tsx` component is rewritten in place; the file path stays the same.

The **only** case where the old wizard is still useful: a user installs the CLI but **already has** a running Cambrian stack on a remote server. They run `cambrian` and get the "configure remote connection" flow, not the full setup flow. The CLI detects this by probing the configured server: if `Snapshot` succeeds, the user has a stack — skip to step 7 (login only). If `Snapshot` fails with `Unavailable`, the user needs the full setup.

### Detection logic

```typescript
async function detectFirstRun(): Promise<"full-setup" | "login-only" | "ready"> {
  if (!existsSync("~/.cambrian/config.json")) return "full-setup";
  if (!await probeSnapshot(server)) return "full-setup";
  if (!await getKeychainToken(server)) return "login-only";
  return "ready";
}
```

- **`full-setup`** → launch the 8-step wizard.
- **`login-only`** → launch a 1-step wizard: "Log in to <server>".
- **`ready`** → skip the wizard, launch the TUI directly.

### Idempotency

`cambrian init` (re-running the wizard) is safe. Each step checks "already done?" and skips. Running `cambrian init` after a successful first run is a no-op (just prints the status).

---

## Options considered

| Option | What | Why rejected |
|---|---|---|
| **A. Full stack setup wizard, auto-triggered (chosen)** | First `cambrian` invocation launches the 8-step wizard. Wizard handles full setup OR login-only depending on detection. | One entry point. The install script ends by running `cambrian` and the wizard takes over. Users with existing stacks get a short path. |
| **B. Separate `cambrian init` command** | User must know to run `cambrian init` after install. | Extra step to remember. The "first impression" gets worse. |
| **C. Keep the 5-step wizard, add `cambrian setup` for full install** | Old wizard stays for connection-only. New command for full setup. | Two flows. The install script would need to call `cambrian setup`, not just `cambrian`. More friction. |
| **D. Auto-setup with no wizard** | No prompts. Detect everything, install everything, start. | Power users love it. New users are confused when they don't know what happened. No telemetry opt-in. No LLM choice. No "configure later" path. |

---

## Consequences

### Positive

- **One entry point.** The install script ends with `cambrian`. The wizard takes over. No commands to remember.
- **First-run experience is the product.** The wizard is the most-seen UI in V1. It must be beautiful, fast, and forgiving.
- **LLM choice is explicit.** D10 means Ollama is the default but the user can opt into OpenAI/Anthropic. No silent surprise.
- **Telemetry opt-in is in the wizard.** D9 — users consent to install metrics as part of setup.
- **Login is part of setup.** D3 — the user ends the wizard with a working session, not with a config file they have to remember to use.
- **Idempotent.** Re-running the wizard is safe.

### Negative

- **Wizard is long.** 8 steps is a lot. Each step must be skippable (Step 3 LLM choice has "configure later", Step 5 service has "skip").
- **Wizard complexity grows.** Each dependency detection has a platform branch (macOS brew, Linux apt, Linux dnf). Test matrix is large.
- **No remote-only path without a remote stack.** If a user has Postgres on a different host, they need to know to configure it via `cambrian config set db.url`. The wizard handles "no local Postgres" but not "remote Postgres."

### Neutral

- The wizard is implemented as an Ink TUI component, not a web form. This is intentional — it runs in the same terminal where the user ran `curl | sh`.
- The wizard is testable: each step is a function that takes input + state and returns output. The TUI is the presentation layer; the logic is below it.

---

## Acceptance criteria

- [ ] First `cambrian` invocation with no config + no keychain + no orchestrator → launches the 8-step wizard.
- [ ] First `cambrian` invocation with config but no keychain → launches the login-only wizard.
- [ ] Subsequent invocations → skip the wizard, launch the TUI.
- [ ] Step 1 detects platform and installs missing deps with progress.
- [ ] Step 2 creates the DB + runs migrations.
- [ ] Step 3 prompts for LLM provider, installs Ollama if chosen.
- [ ] Step 4 writes `~/.cambrian/configs/config.json` with safe defaults.
- [ ] Step 5 registers the service (systemd / launchd), auto-start off by default.
- [ ] Step 6 starts the orchestrator + waits for `Snapshot` + records time-to-green.
- [ ] Step 7 prompts for first operator login.
- [ ] Step 8 prints the success card with the next steps.
- [ ] Re-running `cambrian init` is a no-op on a successful install.
- [ ] 42 existing smoke tests pass; new tests cover each wizard step.
- [ ] `tsc --noEmit` clean.

---

## Follow-on ADRs

- **CLI-006** — Orchestrator Lifecycle: the `start|stop|restart|status|logs` subcommands that the wizard calls.
- **CLI-002** — Auth Model: the `Login` step at the end of the wizard.
