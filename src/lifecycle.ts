// Orchestrator lifecycle — `cambrian start` / `stop` / `restart` (CLI-006).
//
// MVP mechanism: direct-spawn a DETACHED `cambrian-orchestrator` process with a PID file
// (~/.cambrian/orchestrator.pid) and log redirection (~/.cambrian/logs/), then wait for the
// gRPC port to answer. Cross-platform (works on Windows too, where launchd/systemd don't
// exist). The service-manager registration for auto-start-on-boot (CLI-006 D6 — launchd plist
// / systemd user unit) is a follow-up layered on top of this; `start` stays the on-demand path.

import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { env, platform } from "node:process";

const HOME = env.HOME || env.USERPROFILE || ".";
const PREFIX = env.CAMBRIAN_HOME || resolve(HOME, ".cambrian");
const BIN_DIR = join(PREFIX, "bin");
const LOG_DIR = join(PREFIX, "logs");
const PID_FILE = join(PREFIX, "orchestrator.pid");

const PORT = 50051;

function orchestratorBin(): string | null {
  const candidates = [
    env.CAMBRIAN_ORCHESTRATOR,
    join(BIN_DIR, platform === "win32" ? "cambrian-orchestrator.exe" : "cambrian-orchestrator"),
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? null;
}

// The orchestrator discovers its config bundle via ResolveBaseDir (the configs/tuning.json
// sentinel) — we spawn it with cwd=PREFIX so the CWD check lands on ~/.cambrian/configs.
// It defines no CLI flags (app.Run calls flag.Parse with none), so we pass NO args; a
// missing bundle is surfaced here rather than via an unknown-flag error.
function kernelConfigExists(): boolean {
  return existsSync(join(PREFIX, "configs", "config.json"));
}

function portOpen(port = PORT, timeoutMs = 1000): Promise<boolean> {
  return new Promise((res) => {
    const sock = createConnection({ host: "localhost", port });
    const done = (v: boolean) => { sock.destroy(); res(v); };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
  });
}

function readPid(): number | null {
  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf8").trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch { return null; }
}

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Start the orchestrator if it isn't already up. Returns true if running at exit. */
export async function startOrchestrator(): Promise<boolean> {
  if (await portOpen()) {
    console.log(`Orchestrator already running on :${PORT}.`);
    return true;
  }
  const bin = orchestratorBin();
  if (!bin) {
    console.error(`Orchestrator binary not found in ${BIN_DIR}.`);
    console.error("Re-run the installer: curl -fsSL https://cambrian.dev/install.sh | sh");
    return false;
  }
  mkdirSync(LOG_DIR, { recursive: true });
  const out = openSync(join(LOG_DIR, "orchestrator.log"), "a");
  const err = openSync(join(LOG_DIR, "orchestrator.err"), "a");
  if (!kernelConfigExists()) {
    console.error(`No kernel config bundle at ${join(PREFIX, "configs", "config.json")}. Run: cambrian init`);
    return false;
  }
  // No CLI args: config is resolved from the bundle. cwd = PREFIX so ResolveBaseDir's CWD
  // check finds ~/.cambrian/configs (the bundle init wrote).
  const child = spawn(bin, [], { cwd: PREFIX, detached: true, stdio: ["ignore", out, err] });
  child.unref();
  if (child.pid) writeFileSync(PID_FILE, String(child.pid) + "\n");

  process.stdout.write("Starting orchestrator");
  for (let i = 0; i < 40; i++) {
    if (await portOpen()) {
      console.log(`\n✓ Orchestrator started (PID ${child.pid}) on :${PORT}.`);
      console.log(`  logs: ${join(LOG_DIR, "orchestrator.log")}`);
      return true;
    }
    if (child.pid && !pidAlive(child.pid)) {
      console.log("");
      console.error("Orchestrator exited during startup. Last log lines:");
      try { console.error(tailFile(join(LOG_DIR, "orchestrator.err"), 8)); } catch {}
      return false;
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 750));
  }
  console.log("");
  console.error(`Orchestrator did not answer on :${PORT} within 30s. Check ${join(LOG_DIR, "orchestrator.err")}.`);
  return false;
}

/** Stop the orchestrator started by `cambrian start` (via its PID file). */
export async function stopOrchestrator(): Promise<boolean> {
  const pid = readPid();
  if (!pid || !pidAlive(pid)) {
    if (await portOpen()) {
      console.error("An orchestrator is running on :50051 but was not started by `cambrian start` (no live PID file).");
      console.error("Stop it where you started it (e.g. the terminal running the binary, or your service manager).");
      return false;
    }
    console.log("Orchestrator is not running.");
    try { unlinkSync(PID_FILE); } catch {}
    return true;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch (e: any) {
    console.error(`Could not stop PID ${pid}: ${e?.message ?? e}`);
    return false;
  }
  // Wait for it to actually go down.
  for (let i = 0; i < 20; i++) {
    if (!pidAlive(pid)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (pidAlive(pid)) { try { process.kill(pid, "SIGKILL"); } catch {} }
  try { unlinkSync(PID_FILE); } catch {}
  console.log(`✓ Orchestrator stopped (PID ${pid}).`);
  return true;
}

export async function restartOrchestrator(): Promise<boolean> {
  await stopOrchestrator();
  return startOrchestrator();
}

function tailFile(path: string, n: number): string {
  const lines = readFileSync(path, "utf8").split("\n");
  return lines.slice(-n).join("\n");
}
