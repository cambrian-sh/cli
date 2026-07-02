import { writeFileSync, statSync, chmodSync, existsSync } from "node:fs";

import { createOperatorClient, type OperatorClient } from "./grpc/operator-client";
import { resolveAuth } from "./auth";
import { resolveReason } from "./util/reason";
import { clientTag } from "./util/client-tag";
import { newCommandId } from "./util/command-id";
import type { AuditOp } from "./cambrian-types";

export interface AuditQuery {
  actor?: string;
  targetType?: string;
  targetId?: string;
  actionType?: string;
  limit?: number;
}

export interface AuditContext {
  server: string;
  flagToken?: string;
}

export function createAuditClient(ctx: AuditContext): OperatorClient {
  const auth = resolveAuth(ctx.flagToken, ctx.server);
  return createOperatorClient({
    server: ctx.server,
    token: auth.token ?? undefined,
  });
}

export async function queryAudit(
  client: OperatorClient,
  q: AuditQuery
): Promise<AuditOp[]> {
  const res = await client.queryAudit({
    actor: q.actor ?? "",
    target_type: q.targetType ?? "",
    target_id: q.targetId ?? "",
    action_type: q.actionType ?? "",
    limit: q.limit ?? 50,
  });
  return res.entries ?? [];
}

export async function findAuditById(
  client: OperatorClient,
  id: string
): Promise<AuditOp | null> {
  const entries = await queryAudit(client, { limit: 1000 });
  return entries.find((e) => e.id === id || e.command_id === id) ?? null;
}

export function formatAuditTable(entries: AuditOp[]): string {
  if (entries.length === 0) {
    return "(no entries)";
  }
  const rows = entries.map((e) => {
    const reason = e.reason ? e.reason : "(none)";
    const reasonTrunc = reason.length > 32 ? reason.slice(0, 29) + "..." : reason;
    return [
      e.id,
      e.actor,
      e.action_type,
      reasonTrunc,
      "n/a",
    ];
  });
  const widths: [number, number, number, number, number] = [36, 12, 14, 32, 8];
  const header = [
    "ID".padEnd(widths[0]),
    "ACTOR".padEnd(widths[1]),
    "ACTION".padEnd(widths[2]),
    "REASON".padEnd(widths[3]),
    "WHEN".padEnd(widths[4]),
  ].join(" ");
  const body = rows
    .map((r) =>
      r
        .map((cell, i) => {
          const w = widths[i] ?? 0;
          return (cell ?? "").padEnd(w).slice(0, w);
        })
        .join(" ")
    )
    .join("\n");
  return header + "\n" + body;
}

export function formatAuditDetail(e: AuditOp): string {
  return [
    `ID:         ${e.id}`,
    `Command ID: ${e.command_id}`,
    `Actor:      ${e.actor} (${e.role})`,
    `Action:     ${e.action_type}`,
    `Target:     ${e.target_type}:${e.target_id}`,
    `Reason:     ${e.reason || "(none)"}`,
    `Before:     ${e.before || "(empty)"}`,
    `After:      ${e.after || "(empty)"}`,
    `Result:     ${e.result || "(empty)"}`,
  ].join("\n");
}

export type ExportFormat = "json" | "csv" | "ndjson";

export function parseExportFormat(s: string | undefined): ExportFormat {
  if (s === "json" || s === "csv" || s === "ndjson") return s;
  return "ndjson";
}

export function formatAuditExport(entries: AuditOp[], fmt: ExportFormat): string {
  if (fmt === "json") return JSON.stringify({ entries }, null, 2);
  if (fmt === "csv") {
    const headers = [
      "id",
      "command_id",
      "actor",
      "role",
      "action_type",
      "target_type",
      "target_id",
      "reason",
      "result",
    ];
    const escape = (v: string) => {
      if (v == null) return "";
      if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
      return v;
    };
    const lines = [headers.join(",")];
    for (const e of entries) {
      lines.push(
        [
          e.id,
          e.command_id,
          e.actor,
          e.role,
          e.action_type,
          e.target_type,
          e.target_id,
          e.reason,
          e.result,
        ]
          .map(escape)
          .join(",")
      );
    }
    return lines.join("\n") + "\n";
  }
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

export function writeExportFile(
  path: string,
  data: string,
  options: { force?: boolean } = {}
): void {
  if (existsSync(path) && !options.force) {
    throw new Error(
      `Refusing to overwrite existing file: ${path}. Use --force to overwrite.`
    );
  }
  writeFileSync(path, data, { encoding: "utf-8", mode: 0o600 });
  try {
    const st = statSync(path);
    if ((st.mode & 0o777) !== 0o600) {
      chmodSync(path, 0o600);
    }
  } catch {
    /* chmod best-effort */
  }
}

export interface ExportOptions {
  fmt: ExportFormat;
  outputPath?: string;
  force?: boolean;
  reasonFlag?: string;
  flagToken?: string;
  ttyIsTerminal: boolean;
  server: string;
  query: AuditQuery;
}

export async function runExport(opts: ExportOptions): Promise<{
  written: number;
  path?: string;
  stdout: string;
}> {
  const reasonArgs = opts.reasonFlag
    ? ["--reason", opts.reasonFlag]
    : [];
  const reason = await resolveReason(reasonArgs, { required: true });
  if (!reason) {
    throw new Error("audit export requires --reason");
  }
  const client = createAuditClient({ server: opts.server, flagToken: opts.flagToken });
  try {
    const entries = await queryAudit(client, { ...opts.query, limit: opts.query.limit ?? 1000 });
    const data = formatAuditExport(entries, opts.fmt);
    if (opts.outputPath) {
      writeExportFile(opts.outputPath, data, { force: opts.force });
      return { written: entries.length, path: opts.outputPath, stdout: "" };
    }
    return { written: entries.length, stdout: data };
  } finally {
    client.close();
  }
}

export function parseListFlags(args: string[]): {
  json: boolean;
  query: AuditQuery;
} {
  const q: AuditQuery = {};
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") json = true;
    else if (a === "--actor" && args[i + 1]) { q.actor = args[i + 1]; i++; }
    else if (a === "--action" && args[i + 1]) { q.actionType = args[i + 1]; i++; }
    else if (a === "--command" && args[i + 1]) { q.actionType = args[i + 1]; i++; }
    else if (a === "--target-type" && args[i + 1]) { q.targetType = args[i + 1]; i++; }
    else if (a === "--target-id" && args[i + 1]) { q.targetId = args[i + 1]; i++; }
    else if (a === "--limit" && args[i + 1]) {
      const n = parseInt(args[i + 1]!, 10);
      if (!isNaN(n) && n > 0 && n <= 1000) q.limit = n;
      i++;
    }
  }
  return { json, query: q };
}

export { newCommandId, clientTag };
