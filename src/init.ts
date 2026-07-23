// `cambrian init` — full-stack setup wizard (CLI-005, amended CLI-004 scope).
//
// The install script drops the two binaries and hands off here; init "sets up the world":
// preflight → database (up + migrate) → config → start orchestrator → verify. Every step is
// check-then-do and idempotent, so re-running `cambrian init` repairs a half-install.
//
// Implemented as a sequential runner (the logic below the TUI, per CLI-005) so it is testable
// and works under `curl | sh` where there may be no rich terminal. The heavier, inherently
// platform-specific pieces — auto-installing missing deps via brew/apt/dnf, and registering a
// launchd/systemd service — are staged as explicit "manual" fallbacks (see TODOs) rather than
// pretending to handle every distro.

import { spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { env, platform } from "node:process";
import { createInterface } from "node:readline";

// Interactive prompts: on when we have a real TTY and the user didn't pass --yes. Under
// `curl | sh` the install script hands off with `cambrian init < /dev/tty`, so stdin is a TTY.
// In CI / piped / --yes, every prompt silently takes its default.
let INTERACTIVE = true;
async function ask(question: string, def: string): Promise<string> {
  if (!INTERACTIVE) return def;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const suffix = def !== "" ? dim(` [${def}]`) : "";
  const answer: string = await new Promise((res) => rl.question(`  ${question}${suffix}: `, res));
  rl.close();
  const a = answer.trim();
  return a === "" ? def : a;
}
async function askChoice(question: string, options: { key: string; label: string }[], def: string): Promise<string> {
  if (!INTERACTIVE) return def;
  console.log(`  ${question}`);
  for (const o of options) console.log(`    ${o.key === def ? bold("(" + o.key + ")") : "(" + o.key + ")"} ${o.label}`);
  const a = await ask("choice", def);
  return options.some((o) => o.key === a) ? a : def;
}

const HOME = env.HOME || env.USERPROFILE || ".";
const PREFIX = env.CAMBRIAN_HOME || resolve(HOME, ".cambrian");
const BIN_DIR = join(PREFIX, "bin");

// Model defaults (kept in sync with the kernel: configs/embedder.json + reranker_agent).
const EMBEDDER_MODEL = "bge-large";                 // ollama embedder (configs/embedder.json)
const RERANK_MODEL = "BAAI/bge-reranker-base";      // Stage-B cross-encoder (RERANK_MODEL env)

// Per-agent import self-check: for each agents/**/requirements.txt, verify every pinned dist is
// installed in the venv, and report which AGENT is missing which package (not a vague failure).
const SELFCHECK_PY = [
  "import sys, glob, os",
  "from importlib.metadata import version, PackageNotFoundError",
  "root = sys.argv[1]",
  "miss = {}",
  "for req in glob.glob(os.path.join(root, '**', 'requirements.txt'), recursive=True):",
  "    agent = os.path.basename(os.path.dirname(req)) or 'agents'",
  "    for ln in open(req, encoding='utf-8'):",
  "        ln = ln.strip()",
  "        if not ln or ln.startswith('#') or ln.startswith('-'): continue",
  "        name = ln.split('==')[0].split('>=')[0].split('~=')[0].split('[')[0].strip()",
  "        if not name: continue",
  "        try: version(name)",
  "        except PackageNotFoundError: miss.setdefault(agent, set()).add(name)",
  "for a, ms in miss.items(): print('MISSING\\t%s\\t%s' % (a, ','.join(sorted(ms))))",
].join("\n");

function venvPyLocal(venvDir: string): string {
  return join(venvDir, platform === "win32" ? "Scripts" : "bin", platform === "win32" ? "python.exe" : "python");
}

// Prefer uv (10–100× faster on the heavy ML deps — torch/docling), fall back to pip so init
// never *requires* uv. Set in preflight.
let UV = false;
function createVenv(pyExe: string, venvDir: string): { ok: boolean; out: string } {
  return UV ? run("uv", ["venv", venvDir], { timeoutMs: 120_000 })
            : run(pyExe, ["-m", "venv", venvDir], { timeoutMs: 120_000 });
}
function pyInstall(venvPy: string, args: string[], timeoutMs = 900_000): { ok: boolean; out: string } {
  return UV ? run("uv", ["pip", "install", "--python", venvPy, ...args], { timeoutMs })
            : run(venvPy, ["-m", "pip", "install", ...args], { timeoutMs });
}

// ---- tiny output helpers (degrade to plain text when not a TTY) --------------------------
const TTY = Boolean(process.stdout.isTTY);
const c = (code: string, s: string) => (TTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s: string) => c("1", s);
const green = (s: string) => c("32", s);
const red = (s: string) => c("31", s);
const yellow = (s: string) => c("33", s);
const dim = (s: string) => c("2", s);

type StepState = "ok" | "warn" | "fail";
function mark(state: StepState): string {
  return state === "ok" ? green("✓") : state === "warn" ? yellow("!") : red("✗");
}
function line(state: StepState, label: string, detail?: string): void {
  console.log(`  ${mark(state)} ${label}${detail ? dim("  " + detail) : ""}`);
}

// ---- environment probes ------------------------------------------------------------------
function has(cmd: string): { ok: boolean; version?: string } {
  const probe = spawnSync(cmd, ["--version"], { encoding: "utf8", timeout: 8000 });
  if (probe.status === 0) {
    const v = (probe.stdout || probe.stderr || "").trim().split("\n")[0];
    return { ok: true, version: v };
  }
  return { ok: false };
}

function portOpen(host: string, port: number, timeoutMs = 1200): Promise<boolean> {
  return new Promise((res) => {
    const sock = createConnection({ host, port });
    const done = (v: boolean) => { sock.destroy(); res(v); };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
  });
}

function run(cmd: string, args: string[], opts: { timeoutMs?: number; cwd?: string } = {}): { ok: boolean; out: string } {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: opts.timeoutMs ?? 120_000, cwd: opts.cwd });
  return { ok: r.status === 0, out: ((r.stdout || "") + (r.stderr || "")).trim() };
}

function orchestratorBin(): string | null {
  const candidates = [
    env.CAMBRIAN_ORCHESTRATOR,
    join(BIN_DIR, platform === "win32" ? "cambrian-orchestrator.exe" : "cambrian-orchestrator"),
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? null;
}

// ---- the wizard --------------------------------------------------------------------------
export interface InitOptions {
  gpu?: boolean;
  yes?: boolean; // non-interactive: accept safe defaults, never block on a prompt
}

export async function runInit(opts: InitOptions = {}): Promise<number> {
  console.log("");
  console.log(bold("  Cambrian setup") + dim("  ·  cambrian init"));
  console.log(dim("  Sets up the world: database, config, orchestrator. Safe to re-run."));
  console.log("");

  INTERACTIVE = Boolean(process.stdin.isTTY) && !opts.yes;
  let degraded = false;
  let venvPy = "";      // set by the Python-runtime step; consumed by the model + config steps
  let agentsDir = "";   // resolved agents dir (holds requirements.lock + system/<agent>/…)
  // Database connection the user chose (or the defaults). The kernel + migrate read these via
  // the CAMBRIAN_DATABASE__* env overrides we set below, so no config-file resolution is needed.
  const dbCfg = { host: "localhost", port: "5432", user: "cambrian_admin", password: "cambrian_password", dbname: "cambrian_db" };
  let dbUp = false;     // Postgres reachability (set in the Database step; migrate runs after config)

  // --- Step 1: preflight ------------------------------------------------------------------
  console.log(bold("1. Preflight"));
  const docker = has("docker");
  const python = has("python3").ok ? has("python3") : has("python");
  const ollama = has("ollama");
  UV = has("uv").ok;
  line(docker.ok ? "ok" : "warn", "docker", docker.ok ? docker.version : "not found — needed for the bundled Postgres");
  line(python.ok ? "ok" : "warn", "python ≥3.11", python.ok ? python.version : "not found — needed for the agent runtime");
  line(ollama.ok ? "ok" : "warn", "ollama", ollama.ok ? ollama.version : "not found — needed for the local embedder");
  line("ok", "package installer", UV ? "uv (fast)" : "pip (uv not found — installs will be slower)");
  if (!docker.ok || !python.ok || !ollama.ok) {
    degraded = true;
    console.log(dim("     install the missing tools, then re-run `cambrian init` (it will pick up from here)."));
  }
  const orch = orchestratorBin();
  line(orch ? "ok" : "fail", "orchestrator binary", orch ?? `not found in ${BIN_DIR}`);
  if (!orch) {
    console.log(red("\n  Cannot continue without the orchestrator binary. Re-run the installer:"));
    console.log("    curl -fsSL https://cambrian.dev/install.sh | sh");
    return 1;
  }

  // --- Step 2: database (choose location + creds, bring up, migrate) ----------------------
  console.log(bold("\n2. Database"));
  const where = await askChoice(
    "Where should Cambrian's database live?",
    [
      { key: "1", label: "Local Docker Postgres — init starts and manages it (recommended)" },
      { key: "2", label: "Existing / remote Postgres — you provide the connection" },
    ],
    "1",
  );
  if (where === "2") {
    dbCfg.host = await ask("Postgres host", dbCfg.host);
    dbCfg.port = await ask("Postgres port", dbCfg.port);
    dbCfg.dbname = await ask("database name", dbCfg.dbname);
    dbCfg.user = await ask("username", dbCfg.user);
    dbCfg.password = await ask("password " + dim("(input is visible)"), dbCfg.password);
  } else {
    // Local Docker: defaults match docker-compose.yml; let the user tweak them.
    dbCfg.user = await ask("Postgres user", dbCfg.user);
    dbCfg.password = await ask("Postgres password " + dim("(input is visible)"), dbCfg.password);
    dbCfg.dbname = await ask("database name", dbCfg.dbname);
  }

  // Inject the chosen connection so `migrate` and the orchestrator use it — CAMBRIAN_DATABASE__*
  // is the highest-precedence override, so the DB works without any config-file resolution.
  env.CAMBRIAN_DATABASE__HOST = dbCfg.host;
  env.CAMBRIAN_DATABASE__PORT = dbCfg.port;
  env.CAMBRIAN_DATABASE__USER = dbCfg.user;
  env.CAMBRIAN_DATABASE__PASSWORD = dbCfg.password;
  env.CAMBRIAN_DATABASE__DBNAME = dbCfg.dbname;

  const dbPortNum = parseInt(dbCfg.port, 10) || 5432;
  dbUp = await portOpen(dbCfg.host, dbPortNum);
  if (dbUp) {
    line("ok", `Postgres reachable on ${dbCfg.host}:${dbCfg.port}`);
  } else if (where !== "2" && docker.ok) {
    const compose = firstExisting([
      env.CAMBRIAN_COMPOSE,
      resolve(process.cwd(), "docker-compose.yml"),
      resolve(process.cwd(), "..", "docker-compose.yml"),
    ]);
    if (compose) {
      process.stdout.write("  starting Postgres via docker compose (cambrian-db)… ");
      // The compose service reads CAMBRIAN_DB_USER/PASSWORD/NAME — create it with the chosen creds.
      env.CAMBRIAN_DB_USER = dbCfg.user;
      env.CAMBRIAN_DB_PASSWORD = dbCfg.password;
      env.CAMBRIAN_DB_NAME = dbCfg.dbname;
      const up = run("docker", ["compose", "-f", compose, "up", "-d", "cambrian-db"], { timeoutMs: 180_000 });
      console.log(up.ok ? green("done") : red("failed"));
      if (!up.ok) console.log(dim("     " + up.out.split("\n").slice(-2).join(" ")));
      dbUp = await waitForPort(dbCfg.host, dbPortNum, 30);
      line(dbUp ? "ok" : "fail", "Postgres up");
    } else {
      line("warn", "no docker-compose.yml found", "start Postgres yourself, then re-run init");
      degraded = true;
    }
  } else {
    line("warn", `Postgres not reachable at ${dbCfg.host}:${dbCfg.port}`, where === "2" ? "check the connection details" : "install docker, or choose an existing Postgres");
    degraded = true;
  }
  // Migrations run AFTER the config bundle is materialized (below) — the orchestrator needs the
  // full config (storage, embedder, …) to boot, not just the DB.

  // --- Step 3: Python agent runtime (venv + SDK + per-agent deps) -------------------------
  // PLAT-01: agents run on a venv with the SDK + a union lockfile (agents/requirements.lock),
  // and each agent declares pinned requirements. Without this the agents cannot import their
  // deps and the kernel degrades. Check-then-do: skip the venv if present, skip installs if the
  // lockfile is already satisfied. The install script deliberately does NOT do this (D7) — it's
  // init's job.
  console.log(bold("\n3. Python agent runtime"));
  if (!python.ok) {
    line("warn", "python not found", "install Python ≥3.11, then re-run `cambrian init`");
    degraded = true;
  } else {
    const pyExe = has("python3").ok ? "python3" : "python";
    const venvDir = join(PREFIX, "venv");
    if (existsSync(venvPyLocal(venvDir))) {
      line("ok", "venv present", venvDir);
    } else {
      process.stdout.write(`  creating venv (${UV ? "uv" : "python -m venv"})… `);
      const v = createVenv(pyExe, venvDir);
      console.log(v.ok ? green("done") : red("failed"));
      if (!v.ok) { console.log(dim("     " + tail(v.out))); degraded = true; }
    }
    if (existsSync(venvPyLocal(venvDir))) {
      venvPy = venvPyLocal(venvDir);
      // Locate the agent runtime assets (repo dev-tree today; bundled with the orchestrator
      // release later). CAMBRIAN_AGENTS_DIR / CAMBRIAN_SDK_DIR override the search.
      const agentsLock = firstExisting([
        env.CAMBRIAN_AGENTS_DIR ? join(env.CAMBRIAN_AGENTS_DIR, "requirements.lock") : undefined,
        resolve(process.cwd(), "agents", "requirements.lock"),
        resolve(process.cwd(), "cambrian-core", "agents", "requirements.lock"),
        resolve(process.cwd(), "..", "cambrian-core", "agents", "requirements.lock"),
      ]);
      if (agentsLock) agentsDir = resolve(agentsLock, "..");
      const sdkDir = firstExisting([
        env.CAMBRIAN_SDK_DIR,
        resolve(process.cwd(), "sdk"),
        resolve(process.cwd(), "..", "sdk"),
      ].map((p) => (p && existsSync(join(p, "pyproject.toml")) ? p : undefined)));

      if (!UV) run(venvPy, ["-m", "pip", "install", "-q", "--upgrade", "pip"], { timeoutMs: 120_000 });
      // SDK: a source checkout installs the local editable package; a released install pulls
      // `cambrian-agent-sdk` from PyPI (PLAT-06 trusted publishing).
      process.stdout.write("  installing agent SDK… ");
      const s = sdkDir
        ? pyInstall(venvPy, ["-e", sdkDir], 300_000)
        : pyInstall(venvPy, ["cambrian-agent-sdk"], 300_000);
      console.log(s.ok ? green("done") : red("failed"));
      if (!s.ok) {
        console.log(dim("     " + tail(s.out)));
        line("warn", "agent SDK not installed", sdkDir ? "check the SDK source tree" : "set CAMBRIAN_SDK_DIR for a source checkout");
        degraded = true;
      }
      if (agentsLock) {
        process.stdout.write("  installing agent deps (union lockfile)… ");
        const d = pyInstall(venvPy, ["-r", agentsLock]);
        console.log(d.ok ? green("done") : red("failed"));
        if (!d.ok) { console.log(dim("     " + tail(d.out))); degraded = true; }
        else line("ok", "agent dependencies installed", agentsLock);
      } else {
        line("warn", "agents/requirements.lock not found", "set CAMBRIAN_AGENTS_DIR; skipping agent deps");
        degraded = true;
      }
      // Per-agent import self-check (PLAT-01): name EXACTLY which agent is missing which dep,
      // rather than a generic "some import failed". Verifies each agent's requirements.txt
      // packages are actually importable in the venv.
      if (agentsDir) {
        const chk = run(venvPy, ["-c", SELFCHECK_PY, agentsDir], { timeoutMs: 60_000 });
        const missing = chk.out.split("\n").filter((l) => l.startsWith("MISSING\t"));
        if (missing.length === 0) {
          line("ok", "per-agent dependency self-check");
        } else {
          for (const m of missing) {
            const [, agent, mods] = m.split("\t");
            line("fail", `agent ${agent} missing`, mods);
          }
          degraded = true;
        }
      }
      line("ok", "python runtime", venvPy);
    }
  }

  // --- Step 4: models (embedder + reranker/docling pre-fetch) -----------------------------
  // Pull the embedder now and pre-fetch the HF models so the FIRST query isn't a multi-GB
  // download mid-request. Check-then-do: skip anything already present. Non-fatal.
  console.log(bold("\n4. Models"));
  if (ollama.ok) {
    const list = run("ollama", ["list"], { timeoutMs: 20_000 });
    if (list.out.includes(EMBEDDER_MODEL.split(":")[0] ?? EMBEDDER_MODEL)) {
      line("ok", `embedder ${EMBEDDER_MODEL} present`);
    } else {
      process.stdout.write(`  ollama pull ${EMBEDDER_MODEL}… `);
      const p = run("ollama", ["pull", EMBEDDER_MODEL], { timeoutMs: 900_000 });
      console.log(p.ok ? green("done") : yellow("skipped"));
      if (!p.ok) { line("warn", `could not pull ${EMBEDDER_MODEL}`, "pull it later: ollama pull " + EMBEDDER_MODEL); }
    }
  } else {
    line("warn", "ollama missing — embedder not pulled", `install ollama, then: ollama pull ${EMBEDDER_MODEL}`);
  }
  if (venvPy) {
    const rerank = env.RERANK_MODEL || RERANK_MODEL;
    process.stdout.write(`  pre-fetching reranker (${rerank})… `);
    const r = run(venvPy, ["-c", "import sys; from huggingface_hub import snapshot_download as s; s(sys.argv[1])", rerank], { timeoutMs: 900_000 });
    console.log(r.ok ? green("done") : yellow("deferred"));
    if (!r.ok) line("warn", "reranker pre-fetch deferred", "downloads on first use (a few hundred MB)");
    // docling ships its own model downloader; use it when present, else defer to first convert.
    const dl = run(venvPy, ["-m", "docling.cli.models", "download"], { timeoutMs: 900_000 });
    if (dl.ok) line("ok", "docling models pre-fetched");
    else line("warn", "docling models deferred", "download on first document parse");
  }

  // --- Step 5: config ---------------------------------------------------------------------
  console.log(bold("\n5. Config"));
  const cliConfigDir = resolve(HOME, ".config", "cambrian");
  const cliConfig = join(cliConfigDir, "config.json");
  if (existsSync(cliConfig)) {
    line("ok", "CLI config present", cliConfig);
  } else {
    mkdirSync(cliConfigDir, { recursive: true });
    writeFileSync(cliConfig, JSON.stringify({ server: "localhost:50051", operatorId: "" }, null, 2) + "\n");
    line("ok", "wrote CLI config", cliConfig);
  }
  // Kernel config bundle: materialize a COMPLETE ~/.cambrian/configs/{config.json,tuning.json}
  // so the orchestrator resolves everything it needs to boot (database, storage, embedder,
  // interpreter). tuning.json is also the sentinel ResolveBaseDir walks up to find, so the
  // binary in ~/.cambrian/bin discovers this bundle from any working directory.
  const kernelCfgDir = join(PREFIX, "configs");
  const kernelCfg = join(kernelCfgDir, "config.json");
  const dataDir = join(PREFIX, "data"); // app-data default (~/.cambrian/data)
  const example = firstExisting([
    resolve(process.cwd(), "configs", "config.example.json"),
    resolve(process.cwd(), "cambrian-core", "configs", "config.example.json"),
    resolve(process.cwd(), "..", "cambrian-core", "configs", "config.example.json"),
  ]);
  try {
    let cfg: any = {};
    if (existsSync(kernelCfg)) cfg = JSON.parse(readFileSync(kernelCfg, "utf8"));
    else if (example) cfg = JSON.parse(readFileSync(example, "utf8"));
    delete cfg._comment;
    cfg.database = { host: dbCfg.host, port: dbCfg.port, user: dbCfg.user, password: dbCfg.password, dbname: dbCfg.dbname };
    cfg.storage = { data_dir: dataDir, db_name: (cfg.storage && cfg.storage.db_name) || "agents.db" };
    cfg.metabolism = cfg.metabolism || {};
    if (venvPy) cfg.metabolism.python_executable = venvPy;
    if (agentsDir) cfg.metabolism.agents_dir = agentsDir;
    cfg.server = cfg.server || { port: "50051" };
    // Embedder is required to boot (dimensions must be explicit); default to the local bge-large.
    cfg.embedder = cfg.embedder || {
      provider: "ollama", model: EMBEDDER_MODEL, endpoint: "http://localhost:11434",
      dimensions: 1024, timeout_ms: 10000,
      query_prefix: "Represent this sentence for searching relevant passages: ",
    };
    mkdirSync(kernelCfgDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(kernelCfg, JSON.stringify(cfg, null, 2) + "\n");
    // Sentinel + tuning defaults: copy the repo's tuning.json if found, else write a stub so
    // ResolveBaseDir can locate this bundle.
    const tuningSrc = example ? join(resolve(example, ".."), "tuning.json") : undefined;
    const tuningDst = join(kernelCfgDir, "tuning.json");
    if (!existsSync(tuningDst)) {
      writeFileSync(tuningDst, (tuningSrc && existsSync(tuningSrc)) ? readFileSync(tuningSrc, "utf8") : "{}\n");
    }
    line("ok", "kernel config bundle", kernelCfgDir + dim("  (db + storage + embedder + interpreter)"));
  } catch (e: any) {
    line("warn", "could not write kernel config", String(e?.message ?? e));
    degraded = true;
  }
  // API keys live in the kernel's .env (never in the CLI config). We only nudge; we never
  // echo or invent a key.
  const kernelEnv = firstExisting([resolve(process.cwd(), ".env"), resolve(process.cwd(), "..", ".env")]);
  line(kernelEnv ? "ok" : "warn", "kernel .env (LLM API keys)", kernelEnv ?? "not found — add provider keys before first query");

  // Migrations: now that the bundle exists, run migrate from PREFIX so the orchestrator resolves
  // ~/.cambrian/configs (ResolveBaseDir CWD check). DB creds also come via the env override set above.
  if (dbUp) {
    process.stdout.write("  running migrations (orchestrator migrate up)… ");
    const mig = run(orch, ["migrate", "up"], { timeoutMs: 120_000, cwd: PREFIX });
    console.log(mig.ok ? green("done") : red("failed"));
    if (!mig.ok) { console.log(dim("     " + tail(mig.out))); degraded = true; }
  }

  // --- Step 6: start + verify -------------------------------------------------------------
  console.log(bold("\n6. Orchestrator"));
  let running = await portOpen("localhost", 50051);
  if (running) {
    line("ok", "orchestrator already running on :50051", "(left as-is; init is idempotent)");
  } else if (degraded) {
    // Don't start on a half-configured stack — a missing DB/deps would just crash-loop.
    line("warn", "not starting (setup had warnings)", "fix the items above, then: cambrian start");
  } else {
    const { startOrchestrator } = await import("./lifecycle");
    running = await startOrchestrator();
    if (!running) degraded = true;
  }
  // Auto-start-on-boot (launchd/systemd service registration, CLI-006 D6) is opt-in and not
  // wired here; `cambrian start` is the on-demand path.

  // --- summary ----------------------------------------------------------------------------
  console.log("");
  if (degraded) {
    console.log(yellow(bold("  Setup finished with warnings.")) + dim("  Re-run `cambrian init` after fixing the items above."));
  } else if (running) {
    console.log(green(bold("  ✓ Cambrian is ready.")));
    console.log(dim("     try:  cambrian status   ·   cambrian doctor   ·   cambrian help"));
  } else {
    console.log(green(bold("  ✓ Setup complete.")) + dim("  Start the orchestrator, then `cambrian status`."));
  }
  console.log("");
  return degraded ? 2 : 0;
}

// ---- small utils -------------------------------------------------------------------------
function firstExisting(paths: (string | undefined)[]): string | null {
  return (paths.filter(Boolean) as string[]).find((p) => existsSync(p)) ?? null;
}
function tail(s: string, n = 2): string {
  return s.split("\n").slice(-n).join(" ");
}
async function waitForPort(host: string, port: number, tries: number): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (await portOpen(host, port)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}
