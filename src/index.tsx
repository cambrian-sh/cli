// Cambrian CLI entry point.
// No args → TUI mode. Subcommands → non-interactive output.

import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { loadConfig, findConfigPath, saveConfig } from "./config";
import { createClient } from "./grpc/client";
import { createOperatorClient } from "./grpc/operator-client";
import { openOperatorEventStream } from "./grpc/operator-streams";
import { handleConnectionError } from "./errors";
import { newCommandId, commandIdForRetry } from "./util/command-id";
import { resolveReason } from "./util/reason";
import { clientTag } from "./util/client-tag";
import { login as authLogin, logout as authLogout, whoami as authWhoami, formatWhoami, resolveAuth, isMutatingRole, warnIfExpiringSoon, type Role } from "./auth";
import { createAuditClient, queryAudit, findAuditById, formatAuditTable, formatAuditDetail, parseListFlags, parseExportFormat, formatAuditExport, writeExportFile, runExport } from "./audit";

function resolveCommandId(
  args: string[],
  subcommand: string,
  retryArgs: Record<string, unknown>
): string {
  const idx = args.indexOf("--command-id");
  if (idx >= 0 && idx + 1 < args.length) {
    return args[idx + 1]!;
  }
  if (args.includes("--force")) {
    return newCommandId();
  }
  return commandIdForRetry(subcommand, retryArgs);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    const { launchTui } = await import("./tui");
    await launchTui();
    return;
  }

  if (args[0] === "--version" || args[0] === "-v" || args[0] === "version") {
    const pkg = await import("../package.json", { with: { type: "json" } });
    console.log(`cambrian ${pkg.default.version}`);
    return;
  }

  let configPath: string | undefined;
  let tokenFlag: string | undefined;
  let serverOverride: string | undefined;
  let rest = args.slice();

  while (
    rest[0] === "--config" || rest[0] === "--token" || rest[0] === "--server"
  ) {
    if (rest[0] === "--config") {
      if (!rest[1]) {
        console.error("--config requires a path argument");
        process.exit(1);
      }
      configPath = rest[1];
      rest = rest.slice(2);
    } else if (rest[0] === "--token") {
      if (!rest[1]) {
        console.error("--token requires a JWT argument");
        process.exit(1);
      }
      tokenFlag = rest[1];
      rest = rest.slice(2);
    } else {
      if (!rest[1]) {
        console.error("--server requires a host:port argument");
        process.exit(1);
      }
      serverOverride = rest[1];
      rest = rest.slice(2);
    }
  }

  function resolveServer(): string {
    return (
      serverOverride ||
      process.env.CAMBRIAN_SERVER ||
      loadConfig({ configPath }).server
    );
  }

  let subcommand = rest[0]!;
  let subArgs = rest.slice(1);
  if (!subcommand) {
    console.error("Missing subcommand after global flags");
    printHelp(resolveAuth(tokenFlag, resolveServer()).role);
    process.exit(1);
  }

  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    printHelp(resolveAuth(tokenFlag, resolveServer()).role);
    return;
  }

  if (subcommand === "login" || subcommand === "logout" || subcommand === "whoami") {
    const server = resolveServer();
    try {
      switch (subcommand) {
        case "login": {
          let username: string | undefined;
          let password: string | undefined;
          for (let i = 0; i < subArgs.length; i++) {
            if (subArgs[i] === "--username" && subArgs[i + 1]) { username = subArgs[i + 1]; i++; }
            else if (subArgs[i] === "--password" && subArgs[i + 1]) { password = subArgs[i + 1]; i++; }
          }
          const entry = await authLogin({ server, username, password });
          console.log(`Logged in as ${entry.username} (role: ${entry.role})`);
          console.log("Token stored in OS keychain.");
          if (entry.expiresAt) {
            const iso = new Date(entry.expiresAt * 1000).toISOString().slice(0, 10);
            console.log(`Expires: ${iso}`);
          }
          return;
        }
        case "logout":
          authLogout(server);
          console.log(`Logged out of ${server}.`);
          return;
        case "whoami": {
          const r = authWhoami(tokenFlag, server);
          console.log(formatWhoami(r));
          return;
        }
      }
    } catch (err: any) {
      console.error(`auth: ${err?.message ?? err}`);
      process.exit(1);
    }
  }

  const cfg = loadConfig({ configPath });
  if (serverOverride) cfg.server = serverOverride;
  if (tokenFlag) cfg.token = tokenFlag;

  if (!findConfigPath(configPath) && !process.env.CAMBRIAN_SERVER && !process.env.CAMBRIAN_OPERATOR_ID && !serverOverride) {
    console.error(`No config found at ~/.config/cambrian/config.json or ./config.json`);
    console.error(`Run \`cambrian\` (no args) for interactive setup, or set:`);
    console.error(`  CAMBRIAN_SERVER=host:port CAMBRIAN_OPERATOR_ID=yourname cambrian <cmd>`);
    process.exit(1);
  }

  // Role-gate operator-plane mutations. Agent-plane subcommands stay
  // available; the kernel enforces its own model there.
  const auth = resolveAuth(tokenFlag, cfg.server);
  const role: Role = auth.role;
  const isMutating = isMutatingRole(role);
  warnIfExpiringSoon(auth);

  const client = createClient(cfg);

  try {
    switch (subcommand) {
      case "tools":
        await handleTools(client, subArgs);
        break;
      case "skills":
        await handleSkills(client, subArgs);
        break;
      case "watches":
        await handleWatches(client, subArgs);
        break;
      case "approve":
        if (!isMutating) return roleDenied("approve", role);
        await handleApprove(client, subArgs);
        break;
      case "deny":
        if (!isMutating) return roleDenied("deny", role);
        await handleDeny(client, subArgs);
        break;
      case "audit":
        await handleAudit(cfg, tokenFlag, subArgs);
        break;
      case "memory":
        await handleMemory(client, subArgs);
        break;
      case "doctor":
        await handleDoctor(client, cfg, subArgs);
        break;
      case "config":
        handleConfig(cfg, configPath, subArgs);
        break;
      case "status":
        await handleStatus(client, subArgs);
        break;
      default:
        console.error(`Unknown command: ${subcommand}`);
        printHelp(role);
        process.exit(1);
    }
  } catch (err: any) {
    handleConnectionError(err, cfg.server);
    process.exit(1);
  } finally {
    client.close();
  }
}

function roleDenied(cmd: string, role: Role): never {
  console.error(
    `Permission denied: \`${cmd}\` requires the "operator" role; current role is "${role}".`
  );
  console.error(`Run \`cambrian whoami\` to inspect your role, or log in with an operator account.`);
  process.exit(1);
}

const MUTATING_HELP = `  cambrian approve <id>          Approve a pending tool request (--reason <text>)
  cambrian approve list          Watch approval stream (--timeout <s> --json)
  cambrian deny <id>             Deny a pending tool request (--reason <text>)
`;

function printHelp(role: Role = "operator") {
  const isViewer = role === "viewer";
  const mutatingBlock = isViewer ? "" : MUTATING_HELP;
  const viewerNote = isViewer
    ? `
Viewer note: approve/deny are hidden because your role is "viewer".
             The kernel will reject them anyway — run \`cambrian whoami\` to confirm.`
    : "";

  console.log(`Cambrian CLI — admin interface for the Cambrian orchestrator

Usage: cambrian [command] [args]

Commands:
  cambrian                       Launch interactive TUI dashboard
  cambrian login                 Authenticate to server (stores token in OS keychain)
  cambrian login --username <u> --password <p>
                                 Non-interactive login
  cambrian logout                Clear keychain entry for the current server
  cambrian whoami                Show current user, role, and token expiry
  cambrian config                Show resolved configuration
  cambrian config get <key>      Print a single config value
  cambrian config path           Print resolved config file path
  cambrian config set <k> <v>    Set config key (server, operator_id)
  cambrian config edit           Open config in $EDITOR (or vi)
  cambrian status                One-line summary of server state
  cambrian status --json         Output as JSON (for scripting)
  cambrian doctor                Diagnose config and server connectivity
  cambrian doctor --json         Output as JSON (for scripting)
  cambrian tools list             List registered system tools
  cambrian tools list --query     Semantic search for tools
  cambrian tools list --k <n>     Limit number of results
  cambrian tools list --dangerous Show only dangerous tools
  cambrian tools list --safe      Show only safe tools
  cambrian tools list --json     Output as JSON (for scripting)
  cambrian tools get <name>      Show tool JSON schema
  cambrian tools get --summary  Show only the description
  cambrian tools describe <name>
                                  Show tool details (human-readable)
  cambrian tools exec <name>     Execute a tool with JSON args
  cambrian tools exec <name> --args <json>
                                  Pass args inline
  cambrian tools exec <name> --file <path>
                                  Read args from JSON file
  cambrian tools exec <name> --dry-run
                                  Print payload without executing
  cambrian skills list           List registered system skills
  cambrian skills list --query   Semantic search for skills
  cambrian skills list --k <n>     Limit number of results
  cambrian skills list --json    Output as JSON (for scripting)
  cambrian skills get <name>     Show skill JSON
  cambrian skills get --summary Show only the description
  cambrian skills describe <name>
                                  Show skill instructions (human-readable)
  cambrian watches list          List reactive watch configs
  cambrian watches list --json   Output as JSON (for scripting)
  cambrian watches list --active  Show only active watches
  cambrian watches list --inactive
                                  Show only inactive watches
  cambrian watches create <json> Create a watch from JSON
  cambrian watches create --from-file <path>
                                  Create a watch from JSON file
  cambrian watches describe <id> Show watch details (human-readable)
  cambrian watches delete <id>   Delete a watch
  cambrian watches toggle <id>   Toggle watch active state
${mutatingBlock}  cambrian memory query <text>   Semantic memory search
  cambrian memory query --top-k  Limit number of results (default 10)
  cambrian memory query --json   Output as JSON (for scripting)
  cambrian memory write <text>  Write text to long-term memory
  cambrian memory write --tags   Comma-separated tags (e.g. t1,t2)
  cambrian audit list            List recent audit entries (--json, --actor, --action, --limit)
  cambrian audit show <id>       Show full detail for one entry
  cambrian audit export          Export entries (--format json|csv|ndjson, --output, --reason)

Global flags (must come before the subcommand):
  --config <path>                Use a custom config file
  --server <host:port>           Override the target server
  --token <jwt>                  One-shot operator token (never stored)

Options:
  --version, -v                  Print version and exit
  --help, -h                     Print this help

Config: ~/.config/cambrian/config.json
Env:     CAMBRIAN_SERVER, CAMBRIAN_OPERATOR_ID, CAMBRIAN_TOKEN
Auth:    OS keychain (via \`cambrian login\`) — precedence: --token > env > keychain${viewerNote}`);
}

async function handleTools(
  client: ReturnType<typeof createClient>,
  args: string[]
) {
  if (args[0] === "exec" && args[1]) {
    const toolName = args[1];
    let argsJson = "";
    let sessionTokenId = "";
    let stepIndex = 0;
    let dryRun = false;
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--args" && args[i + 1]) {
        argsJson = args[i + 1]!;
        i++;
      } else if (args[i] === "--file" && args[i + 1]) {
        argsJson = readFileSync(args[i + 1]!, "utf-8");
        i++;
      } else if (args[i] === "--session" && args[i + 1]) {
        sessionTokenId = args[i + 1]!;
        i++;
      } else if (args[i] === "--step" && args[i + 1]) {
        stepIndex = parseInt(args[i + 1]!, 10) || 0;
        i++;
      } else if (args[i] === "--dry-run") {
        dryRun = true;
      }
    }
    if (!argsJson) {
      console.error("Usage: cambrian tools exec <name> --args <json>|--file <path>");
      process.exit(1);
    }
    if (dryRun) {
      console.log("DRY RUN — would execute:");
      console.log(JSON.stringify({
        tool_name: toolName,
        args_json: argsJson,
        session_token_id: sessionTokenId,
        step_index: stepIndex,
      }, null, 2));
      return;
    }
    const res = await client.executeTool({
      tool_name: toolName,
      args_json: argsJson,
      session_token_id: sessionTokenId,
      step_index: stepIndex,
    });
    if (res.error) {
      console.error(`Error: ${res.error}`);
      process.exit(1);
    }
    if (res.denied) {
      console.error(`Denied: ${res.deny_reason}`);
      process.exit(1);
    }
    console.log(res.result_json || "(empty result)");
    if (res.result_cid) console.log(`(stored as ${res.result_cid})`);
    return;
  }
  if ((args[0] === "get" || args[0] === "describe") && args[1]) {
    const res = await client.listTools({});
    const tool = res.tools.find((t) => t.name === args[1]);
    if (!tool) {
      console.error(`Tool not found: ${args[1]}`);
      process.exit(1);
    }
    if (args[0] === "describe") {
      console.log(`# ${tool.name}`);
      console.log("");
      console.log(tool.description);
      console.log("");
      console.log(`Dangerous: ${tool.dangerous ? "YES" : "no"}`);
      if (tool.schema_json) {
        console.log("");
        console.log("## Schema");
        console.log("");
        console.log(tool.schema_json);
      }
      return;
    }
    if (args.includes("--summary")) {
      console.log(tool.description);
      return;
    }
    console.log(JSON.stringify(tool, null, 2));
    return;
  }
  const extra: Record<string, string> = {};
  let asJson = false;
  const dangerFilter = args.includes("--dangerous") ? true
    : args.includes("--safe") ? false
    : null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--query" && args[i + 1]) {
      extra["x-tool-query"] = args[i + 1]!;
      i++;
    } else if (args[i] === "--k" && args[i + 1]) {
      extra["x-tool-k"] = args[i + 1]!;
      i++;
    } else if (args[i] === "--json") {
      asJson = true;
    }
  }
  const res = await client.listTools({}, extra);
  let tools = res.tools;
  if (dangerFilter !== null) {
    tools = tools.filter((t) => t.dangerous === dangerFilter);
  }
  if (asJson) {
    console.log(JSON.stringify({ tools }, null, 2));
    return;
  }
  if (tools.length === 0) {
    console.log("No tools" + (dangerFilter !== null ? (dangerFilter ? " dangerous." : " safe.") : " registered."));
    return;
  }
  console.log("NAME".padEnd(22) + "DANGEROUS".padEnd(12) + "DESCRIPTION");
  console.log("─".repeat(70));
  for (const t of tools) {
    const danger = t.dangerous ? "⚠ YES" : "✓ safe";
    console.log(
      t.name.padEnd(22) + danger.padEnd(12) + t.description
    );
  }
}

async function handleSkills(
  client: ReturnType<typeof createClient>,
  args: string[]
) {
  if ((args[0] === "get" || args[0] === "describe") && args[1]) {
    const res = await client.listSkills({});
    const skill = res.skills.find((s) => s.name === args[1]);
    if (!skill) {
      console.error(`Skill not found: ${args[1]}`);
      process.exit(1);
    }
    if (args[0] === "describe") {
      console.log(`# ${skill.name}`);
      console.log("");
      console.log(skill.description);
      if (skill.tool_grants.length > 0) {
        console.log("");
        console.log(`## Tool grants: ${skill.tool_grants.join(", ")}`);
      }
      if (skill.instructions) {
        console.log("");
        console.log("## Instructions");
        console.log("");
        console.log(skill.instructions);
      }
      return;
    }
    if (args.includes("--summary")) {
      console.log(skill.description);
      return;
    }
    console.log(JSON.stringify(skill, null, 2));
    return;
  }
  const extra: Record<string, string> = {};
  let asJson = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--query" && args[i + 1]) {
      extra["x-skill-query"] = args[i + 1]!;
      i++;
    } else if (args[i] === "--k" && args[i + 1]) {
      extra["x-skill-k"] = args[i + 1]!;
      i++;
    } else if (args[i] === "--json") {
      asJson = true;
    }
  }
  const res = await client.listSkills({}, extra);
  if (asJson) {
    console.log(JSON.stringify(res, null, 2));
    return;
  }
  if (res.skills.length === 0) {
    console.log("No skills registered.");
    return;
  }
  console.log("NAME".padEnd(24) + "GRANTS".padEnd(8) + "DESCRIPTION");
  console.log("─".repeat(70));
  for (const s of res.skills) {
    const grants = String(s.tool_grants.length).padEnd(8);
    console.log(
      s.name.padEnd(24) + grants + s.description
    );
  }
}

async function handleWatches(
  client: ReturnType<typeof createClient>,
  args: string[]
) {
  if ((args[0] === "describe" || args[0] === "get") && args[1]) {
    const res = await client.listWatches({});
    const watch = res.configs.find((w) => w.id === args[1]);
    if (!watch) {
      console.error(`Watch not found: ${args[1]}`);
      process.exit(1);
    }
    if (args[0] === "describe") {
      console.log(`# ${watch.name || watch.id}`);
      console.log("");
      console.log(watch.description || "(no description)");
      console.log("");
      console.log(`ID:           ${watch.id}`);
      console.log(`Active:       ${watch.active ? "yes" : "no"}`);
      console.log(`Source:       ${watch.source_type || "-"}`);
      console.log(`Stream ID:    ${watch.source_stream_id || "-"}`);
      console.log(`Condition:    ${watch.condition || "-"}`);
      console.log(`Condition:    ${watch.condition_type || "-"}`);
      console.log(`Response:     ${watch.response_mode || "-"}`);
      console.log(`Max plans:    ${watch.max_concurrent_plans}`);
      if (watch.action) {
        console.log(`Action type:  ${watch.action.type || "-"}`);
        if (watch.action.target_type) console.log(`Action tgt:  ${watch.action.target_type}`);
        if (watch.action.target) console.log(`Action val:  ${watch.action.target}`);
        if (watch.action.payload) console.log(`Action data: ${watch.action.payload}`);
      }
      if (Object.keys(watch.daemon_params).length > 0) {
        console.log("");
        console.log("## Daemon params");
        for (const [k, v] of Object.entries(watch.daemon_params)) {
          console.log(`  ${k}: ${v}`);
        }
      }
      return;
    }
    console.log(JSON.stringify(watch, null, 2));
    return;
  }
  if (args[0] === "delete" && args[1]) {
    const res = await client.deleteWatch({ id: args[1] });
    console.log(`Watch ${res.id} deleted.`);
    return;
  }
  if (args[0] === "toggle" && args[1]) {
    const listRes = await client.listWatches({});
    const watch = listRes.configs.find((w) => w.id === args[1]);
    if (!watch) {
      console.error(`Watch not found: ${args[1]}`);
      process.exit(1);
    }
    const res = await client.setWatchActive({
      id: args[1],
      active: !watch.active,
    });
    console.log(`Watch ${res.id} active=${res.active}`);
    return;
  }
  if (args[0] === "create") {
    let body = "";
    if (args[1] === "--from-file" && args[2]) {
      body = readFileSync(args[2], "utf-8");
    } else if (args[1]) {
      body = args[1];
    } else {
      // Read from stdin
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
      }
      body = Buffer.concat(chunks).toString("utf-8");
    }
    const config = JSON.parse(body);
    const res = await client.registerWatch({ config });
    console.log(`Watch created: ${res.id}`);
    return;
  }
  // Default: list
  const asJson = args.includes("--json");
  const activeFilter = args.includes("--active") ? true
    : args.includes("--inactive") ? false
    : null;
  const res = await client.listWatches({});
  let configs = res.configs;
  if (activeFilter !== null) {
    configs = configs.filter((w) => w.active === activeFilter);
  }
  if (asJson) {
    console.log(JSON.stringify({ configs }, null, 2));
    return;
  }
  if (configs.length === 0) {
    console.log("No watches" + (activeFilter !== null ? (activeFilter ? " active." : " inactive.") : " registered."));
    return;
  }
  console.log(
    "ID".padEnd(10) +
    "NAME".padEnd(24) +
    "SOURCE".padEnd(22) +
    "ACTIVE".padEnd(8) +
    "ACTION"
  );
  console.log("─".repeat(80));
  for (const w of configs) {
    const active = w.active ? "● ON" : "○ OFF";
    const action = w.action?.type ?? "-";
    console.log(
      w.id.padEnd(10) +
      (w.name || "-").padEnd(24) +
      (w.source_type || "-").padEnd(22) +
      active.padEnd(8) +
      action
    );
  }
}

async function handleApprove(
  client: ReturnType<typeof createClient>,
  args: string[]
) {
  if (args[0] === "list") {
    let timeoutMs = 5000;
    let asJson = false;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--timeout" && args[i + 1]) {
        timeoutMs = parseInt(args[i + 1]!, 10) * 1000 || 5000;
        i++;
      } else if (args[i] === "--json") {
        asJson = true;
      }
    }
    console.log("Watching for approval requests...");
    const cfg = loadConfig();
    const operator = createOperatorClient({
      server: cfg.server,
      token: cfg.token,
    });
    let count = 0;
    let lastSeq = 0;
    const stream = openOperatorEventStream(operator, {
      onEvent: (event) => {
        lastSeq = event.seq ?? lastSeq;
        if (event.payload !== "hitl_raised") return;
        const hitl = event.hitl_raised;
        count++;
        if (asJson) {
          console.log(JSON.stringify({
            intervention_id: hitl.intervention_id,
            session_id: hitl.session_id,
            agent_id: hitl.agent_id,
            description: hitl.description,
            is_destructive: hitl.is_destructive,
            seq: event.seq,
          }));
        } else {
          const tag = hitl.is_destructive ? "⚠ DESTRUCTIVE" : "approval";
          console.log(
            `[${hitl.intervention_id}] ${hitl.agent_id}: ${hitl.description} (${tag})`
          );
        }
      },
      onError: (err) => {
        handleConnectionError(err, cfg.server);
      },
    });
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        stream.close();
        operator.close();
        if (count === 0 && !asJson) console.log("No approvals in window.");
        resolve();
      }, timeoutMs);
    });
  }
  if (!args[0]) {
    console.error("Usage: cambrian approve <id>");
    process.exit(1);
  }
  const cfg = loadConfig();
  const operator = createOperatorClient({
    server: cfg.server,
    token: cfg.token,
  });
  const reason = await resolveReason(args, { required: false });
  const commandId = resolveCommandId(args, "approve", { intervention_id: args[0], approve: true });
  try {
    const res = await operator.resolveHITL({
      command_id: commandId,
      reason,
      intervention_id: args[0],
      approve: true,
    });
    if (res.deduped) {
      console.log(`Already approved (deduped, id: ${res.command_id}).`);
    } else {
      console.log(`✓ Approved (id: ${res.command_id}).`);
    }
  } catch (err) {
    handleConnectionError(err as Error, cfg.server);
    process.exit(1);
  } finally {
    operator.close();
  }
}

async function handleDeny(
  client: ReturnType<typeof createClient>,
  args: string[]
) {
  if (!args[0]) {
    console.error("Usage: cambrian deny <id>");
    process.exit(1);
  }
  const cfg = loadConfig();
  const operator = createOperatorClient({
    server: cfg.server,
    token: cfg.token,
  });
  const reason = await resolveReason(args, { required: false });
  const commandId = resolveCommandId(args, "deny", { intervention_id: args[0], approve: false });
  try {
    const res = await operator.resolveHITL({
      command_id: commandId,
      reason,
      intervention_id: args[0],
      approve: false,
    });
    if (res.deduped) {
      console.log(`Already denied (deduped, id: ${res.command_id}).`);
    } else {
      console.log(`✓ Denied (id: ${res.command_id}).`);
    }
  } catch (err) {
    handleConnectionError(err as Error, cfg.server);
    process.exit(1);
  } finally {
    operator.close();
  }
}

async function handleAudit(
  cfg: { server: string },
  flagToken: string | undefined,
  args: string[]
) {
  const sub = args[0];
  if (sub === "list") {
    const { json, query } = parseListFlags(args.slice(1));
    const operator = createAuditClient({ server: cfg.server, flagToken });
    try {
      const entries = await queryAudit(operator, query);
      if (json) {
        console.log(JSON.stringify({ entries }, null, 2));
      } else {
        console.log(formatAuditTable(entries));
      }
    } catch (err) {
      handleConnectionError(err as Error, cfg.server);
      process.exit(1);
    } finally {
      operator.close();
    }
    return;
  }

  if (sub === "show") {
    const id = args[1];
    if (!id) {
      console.error("Usage: cambrian audit show <command_id>");
      process.exit(1);
    }
    const operator = createAuditClient({ server: cfg.server, flagToken });
    try {
      const entry = await findAuditById(operator, id);
      if (!entry) {
        console.error(
          `Audit entry ${id} not found. It may have been pruned (default retention: 90 days).`
        );
        process.exit(1);
      }
      console.log(formatAuditDetail(entry));
    } catch (err) {
      handleConnectionError(err as Error, cfg.server);
      process.exit(1);
    } finally {
      operator.close();
    }
    return;
  }

  if (sub === "export") {
    let fmt: "json" | "csv" | "ndjson" = "ndjson";
    let outputPath: string | undefined;
    let force = false;
    let reasonFlag: string | undefined;
    const query: { actor?: string; actionType?: string; targetType?: string; targetId?: string; limit?: number } = {};
    for (let i = 1; i < args.length; i++) {
      const a = args[i];
      if (a === "--format" && args[i + 1]) { fmt = parseExportFormat(args[i + 1]); i++; }
      else if (a === "--output" && args[i + 1]) { outputPath = args[i + 1]; i++; }
      else if (a === "--force") { force = true; }
      else if (a === "--reason" && args[i + 1]) { reasonFlag = args[i + 1]; i++; }
      else if (a === "--actor" && args[i + 1]) { query.actor = args[i + 1]; i++; }
      else if (a === "--action" && args[i + 1]) { query.actionType = args[i + 1]; i++; }
      else if (a === "--command" && args[i + 1]) { query.actionType = args[i + 1]; i++; }
      else if (a === "--target-type" && args[i + 1]) { query.targetType = args[i + 1]; i++; }
      else if (a === "--target-id" && args[i + 1]) { query.targetId = args[i + 1]; i++; }
      else if (a === "--limit" && args[i + 1]) {
        const n = parseInt(args[i + 1]!, 10);
        if (!isNaN(n) && n > 0 && n <= 1000) query.limit = n;
        i++;
      }
    }
    try {
      const result = await runExport({
        fmt,
        outputPath,
        force,
        reasonFlag,
        flagToken,
        ttyIsTerminal: Boolean(process.stdout.isTTY),
        server: cfg.server,
        query,
      });
      if (result.path) {
        console.log(`✓ Exported ${result.written} entries to ${result.path}`);
      } else {
        process.stdout.write(result.stdout);
      }
    } catch (err: any) {
      if (err?.message?.includes("--reason")) {
        console.error(err.message);
      } else {
        handleConnectionError(err, cfg.server);
      }
      process.exit(1);
    }
    return;
  }

  console.error(`Usage: cambrian audit <list|show|export> [args]`);
  process.exit(1);
}

async function handleMemory(
  client: ReturnType<typeof createClient>,
  args: string[]
) {
  if (args[0] === "write") {
    let importance = 0.5;
    let source = "cli";
    let sessionId = "";
    let tags: string[] = [];
    const textParts: string[] = [];
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--importance" && args[i + 1]) {
        importance = parseFloat(args[i + 1]!) || 0.5;
        i++;
      } else if (args[i] === "--source" && args[i + 1]) {
        source = args[i + 1]!;
        i++;
      } else if (args[i] === "--session" && args[i + 1]) {
        sessionId = args[i + 1]!;
        i++;
      } else if (args[i] === "--tags" && args[i + 1]) {
        tags = args[i + 1]!.split(",").map((t) => t.trim());
        i++;
      } else {
        textParts.push(args[i]!);
      }
    }
    const text = textParts.join(" ");
    if (!text) {
      console.error("Usage: cambrian memory write <text> [--importance <0-1>] [--source <str>] [--session <id>] [--tags <t1,t2>]");
      process.exit(1);
    }
    const res = await client.ingestMemory({
      text,
      tags,
      importance,
      source,
      session_id: sessionId,
    });
    console.log(`Memory written: ${res.doc_id}`);
    return;
  }

  if (args[0] === "query") args = args.slice(1);

  let topK = 10;
  let asJson = false;
  const queryParts: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--top-k" && args[i + 1]) {
      topK = parseInt(args[i + 1]!, 10) || 10;
      i++;
    } else if (args[i] === "--json") {
      asJson = true;
    } else {
      queryParts.push(args[i]!);
    }
  }
  const query = queryParts.join(" ");
  if (!query) {
    console.error("Usage: cambrian memory query <text> [--top-k <n>] [--json]");
    process.exit(1);
  }
  const res = await client.queryMemory({ query, top_k: topK });
  if (asJson) {
    console.log(JSON.stringify(res, null, 2));
    return;
  }
  if (res.results.length === 0) {
    console.log("No results.");
    return;
  }
  console.log("SCORE".padEnd(8) + "TEXT".padEnd(60) + "METADATA");
  console.log("─".repeat(80));
  for (const r of res.results) {
    const scoreStr = r.score.toFixed(3).padEnd(8);
    const text = (r.text || "").substring(0, 58).padEnd(60);
    console.log(scoreStr + text + (r.metadata || ""));
  }
}

async function handleDoctor(
  client: ReturnType<typeof createClient>,
  cfg: { server: string; operatorId: string },
  args: string[] = []
) {
  const asJson = args.includes("--json");
  const report: {
    server: string;
    operator_id: string;
    proto: string;
    server_reachable: boolean;
    tools?: number;
    watches?: number;
    error?: string;
  } = {
    server: cfg.server,
    operator_id: cfg.operatorId,
    proto: "embedded",
    server_reachable: false,
  };

  let serverOk = false;
  let toolsCount = 0;
  let watchesCount = 0;

  try {
    const toolsRes = await client.listTools({});
    toolsCount = toolsRes.tools.length;
    serverOk = true;
  } catch { /* connection failed */ }

  if (serverOk) {
    try {
      const watchesRes = await client.listWatches({});
      watchesCount = watchesRes.configs.length;
    } catch { /* ignore */ }
    report.server_reachable = true;
    report.tools = toolsCount;
    report.watches = watchesCount;
  } else {
    report.error = "server unreachable";
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    if (!serverOk) process.exit(1);
    return;
  }

  console.log("Cambrian CLI Doctor");
  console.log("─".repeat(40));
  console.log(`Config server:   ${cfg.server}`);
  console.log(`Operator ID:     ${cfg.operatorId}`);
  console.log(`Proto:           embedded (no fs dependency)`);

  if (serverOk) {
    console.log(`Server status:   ✓ connected`);
    console.log(`Tools:           ${toolsCount} registered`);
    console.log(`Watches:         ${watchesCount} registered`);
  } else {
    console.log(`Server status:   ✗ unreachable`);
    console.log(`Tools:           —`);
    console.log(`Watches:         —`);
    process.exitCode = 1;
  }
}

async function handleStatus(
  client: ReturnType<typeof createClient>,
  args: string[] = []
) {
  let toolsCount = 0;
  let watchesCount = 0;
  let toolsRes: { tools: unknown[] } | null = null;
  let watchesRes: { configs: unknown[] } | null = null;

  try {
    toolsRes = await client.listTools({});
    toolsCount = toolsRes.tools.length;
    watchesRes = await client.listWatches({});
    watchesCount = watchesRes.configs.length;
  } catch {
    if (args.includes("--json")) {
      console.log(JSON.stringify({ error: "server unreachable" }));
    } else {
      console.error("server unreachable");
    }
    process.exit(1);
  }

  if (args.includes("--json")) {
    console.log(JSON.stringify({
      server: "reachable",
      tools: toolsCount,
      watches: watchesCount,
    }, null, 2));
    return;
  }

  console.log(`tools: ${toolsCount}  watches: ${watchesCount}`);
}

function handleConfig(
  cfg: { server: string; operatorId: string },
  configPath: string | undefined,
  args: string[]
) {
  if (args[0] === "edit") {
    const path = configPath || findConfigPath() || process.env.HOME + "/.config/cambrian/config.json";
    if (!existsSync(path)) {
      saveConfig({ server: "localhost:50051", operatorId: "" }, { configPath: path });
      console.log(`Created new config at ${path}`);
    }
    const editor = process.env.EDITOR || process.env.VISUAL || "vi";
    console.log(`Opening ${path} in ${editor}...`);
    const result = spawnSync(editor, [path], { stdio: "inherit" });
    if (result.status !== 0) {
      console.error(`Editor exited with status ${result.status}`);
      process.exit(1);
    }
    return;
  }
  if (args[0] === "path") {
    const path = configPath || findConfigPath() || `${process.env.HOME || "."}/.config/cambrian/config.json`;
    console.log(path);
    return;
  }
  if (args[0] === "set" && args[1] && args[2]) {
    const key = args[1];
    const value = args[2];
    let updated: { server: string; operatorId: string };
    if (key === "server") {
      updated = { server: value, operatorId: cfg.operatorId };
    } else if (key === "operator_id" || key === "operator-id") {
      updated = { server: cfg.server, operatorId: value };
    } else {
      console.error(`Unknown config key: ${key}`);
      console.error(`Valid keys: server, operator_id`);
      process.exit(1);
    }
    saveConfig(updated, { configPath });
    console.log(`Set ${key} = ${value}`);
    console.log(`Saved to ${configPath || "~/.config/cambrian/config.json"}`);
    return;
  }
  if (args[0] === "get" && args[1]) {
    const key = args[1];
    if (key === "server") {
      console.log(cfg.server);
      return;
    }
    if (key === "operator_id" || key === "operator-id" || key === "operator") {
      console.log(cfg.operatorId);
      return;
    }
    console.error(`Unknown config key: ${key}`);
    console.error(`Valid keys: server, operator_id`);
    process.exit(1);
  }

  const home = process.env.HOME || process.env.USERPROFILE || ".";
  const xdgPath = `${home}/.config/cambrian/config.json`;
  const localPath = "./config.json";
  const resolvedPath = configPath || xdgPath;

  const serverSource = process.env.CAMBRIAN_SERVER
    ? "env (CAMBRIAN_SERVER)"
    : configPath
    ? `flag (--config ${configPath})`
    : "config file or default";

  const operatorSource = process.env.CAMBRIAN_OPERATOR_ID
    ? "env (CAMBRIAN_OPERATOR_ID)"
    : "config file or default";

  console.log("Cambrian CLI Configuration");
  console.log("─".repeat(40));
  console.log(`Server:          ${cfg.server}`);
  console.log(`  source:        ${serverSource}`);
  console.log(`Operator ID:     ${cfg.operatorId}`);
  console.log(`  source:        ${operatorSource}`);
  console.log(`Config path:     ${resolvedPath}`);
  console.log(`  (local check:  ${localPath})`);
  console.log(`  (xdg path:     ${xdgPath})`);
}

main().catch((err: any) => {
  const cfg = loadConfig();
  handleConnectionError(err, cfg.server);
  process.exit(1);
});
