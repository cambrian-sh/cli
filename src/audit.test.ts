import { describe, test, expect } from "bun:test";
import { mkdtempSync, statSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseListFlags,
  parseExportFormat,
  formatAuditTable,
  formatAuditDetail,
  formatAuditExport,
  writeExportFile,
} from "./audit";
import type { AuditOp } from "./cambrian-types";

const SAMPLE_ENTRIES: AuditOp[] = [
  {
    id: "7c4e8a3f-1111-4111-8111-aaaa00000001",
    command_id: "cmd-001",
    actor: "admin",
    role: "operator",
    action_type: "approve",
    target_type: "intervention",
    target_id: "abc-123",
    before: "",
    after: "",
    reason: "ship it",
    result: '{"approved":true}',
  },
  {
    id: "4a7c2e1d-2222-4222-8222-bbbb00000002",
    command_id: "cmd-002",
    actor: "alice",
    role: "viewer",
    action_type: "deny",
    target_type: "intervention",
    target_id: "def-456",
    before: "",
    after: "",
    reason: "invalid input, contains comma, and a \"quote\"",
    result: '{"approved":false}',
  },
];

describe("parseListFlags", () => {
  test("returns empty query for no flags", () => {
    const r = parseListFlags([]);
    expect(r.json).toBe(false);
    expect(r.query.actor).toBeUndefined();
    expect(r.query.limit).toBeUndefined();
  });

  test("parses --json", () => {
    expect(parseListFlags(["--json"]).json).toBe(true);
  });

  test("parses --actor and --action (--command alias)", () => {
    const r1 = parseListFlags(["--actor", "admin", "--action", "approve"]);
    expect(r1.query.actor).toBe("admin");
    expect(r1.query.actionType).toBe("approve");

    const r2 = parseListFlags(["--command", "deny"]);
    expect(r2.query.actionType).toBe("deny");
  });

  test("parses --target-type and --target-id", () => {
    const r = parseListFlags([
      "--target-type", "intervention",
      "--target-id", "abc-123",
    ]);
    expect(r.query.targetType).toBe("intervention");
    expect(r.query.targetId).toBe("abc-123");
  });

  test("parses --limit within bounds", () => {
    expect(parseListFlags(["--limit", "100"]).query.limit).toBe(100);
    expect(parseListFlags(["--limit", "0"]).query.limit).toBeUndefined();
    expect(parseListFlags(["--limit", "5000"]).query.limit).toBeUndefined();
    expect(parseListFlags(["--limit", "abc"]).query.limit).toBeUndefined();
  });
});

describe("parseExportFormat", () => {
  test("accepts json, csv, ndjson", () => {
    expect(parseExportFormat("json")).toBe("json");
    expect(parseExportFormat("csv")).toBe("csv");
    expect(parseExportFormat("ndjson")).toBe("ndjson");
  });

  test("defaults to ndjson for unknown", () => {
    expect(parseExportFormat("xml")).toBe("ndjson");
    expect(parseExportFormat(undefined)).toBe("ndjson");
  });
});

describe("formatAuditTable", () => {
  test("shows '(no entries)' for empty list", () => {
    expect(formatAuditTable([])).toBe("(no entries)");
  });

  test("includes header and rows", () => {
    const out = formatAuditTable(SAMPLE_ENTRIES);
    expect(out).toContain("ID");
    expect(out).toContain("ACTOR");
    expect(out).toContain("ACTION");
    expect(out).toContain("admin");
    expect(out).toContain("approve");
    expect(out).toContain("alice");
    expect(out).toContain("ship it");
  });

  test("truncates long reasons with ellipsis", () => {
    const long: AuditOp = {
      ...SAMPLE_ENTRIES[0]!,
      reason: "x".repeat(100),
    };
    const out = formatAuditTable([long]);
    expect(out).toContain("...");
  });
});

describe("formatAuditDetail", () => {
  test("includes all fields", () => {
    const out = formatAuditDetail(SAMPLE_ENTRIES[0]!);
    expect(out).toContain("ID:");
    expect(out).toContain("Command ID: cmd-001");
    expect(out).toContain("Actor:      admin (operator)");
    expect(out).toContain("Action:     approve");
    expect(out).toContain("Target:     intervention:abc-123");
    expect(out).toContain("Reason:     ship it");
  });
});

describe("formatAuditExport", () => {
  test("json format wraps in { entries: [...] }", () => {
    const out = formatAuditExport(SAMPLE_ENTRIES, "json");
    expect(out).toContain('"entries"');
    const parsed = JSON.parse(out);
    expect(parsed.entries).toHaveLength(2);
  });

  test("csv format has header and one row per entry", () => {
    const out = formatAuditExport(SAMPLE_ENTRIES, "csv");
    const lines = out.split("\n").filter((l) => l.length > 0);
    expect(lines[0]).toBe("id,command_id,actor,role,action_type,target_type,target_id,reason,result");
    expect(lines.length).toBe(3);
  });

  test("csv format escapes commas and quotes in fields", () => {
    const out = formatAuditExport(SAMPLE_ENTRIES, "csv");
    expect(out).toContain('"invalid input, contains comma, and a ""quote"""');
  });

  test("ndjson format is one JSON object per line", () => {
    const out = formatAuditExport(SAMPLE_ENTRIES, "ndjson");
    const lines = out.split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(2);
    for (const l of lines) {
      expect(() => JSON.parse(l)).not.toThrow();
    }
  });
});

describe("writeExportFile", () => {
  let tmpDir: string;

  test("writes file with mode 0600", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "audit-export-"));
    const path = join(tmpDir, "out.json");
    writeExportFile(path, '{"x":1}');
    expect(existsSync(path)).toBe(true);
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(readFileSync(path, "utf-8")).toBe('{"x":1}');
    rmSync(tmpDir, { recursive: true });
  });

  test("refuses to overwrite without --force", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "audit-export-"));
    const path = join(tmpDir, "out.json");
    writeExportFile(path, "first");
    expect(() => writeExportFile(path, "second")).toThrow(/Refusing to overwrite/);
    expect(readFileSync(path, "utf-8")).toBe("first");
    rmSync(tmpDir, { recursive: true });
  });

  test("--force overwrites", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "audit-export-"));
    const path = join(tmpDir, "out.json");
    writeExportFile(path, "first");
    writeExportFile(path, "second", { force: true });
    expect(readFileSync(path, "utf-8")).toBe("second");
    rmSync(tmpDir, { recursive: true });
  });
});
