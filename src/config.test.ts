// Unit tests for config.ts.
// Uses bun:test — runs via `bun test` or `bun test src/config.test.ts`.

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

describe("loadConfig", () => {
  let originalHome: string | undefined;
  let originalCwd: string;
  let originalServer: string | undefined;
  let originalOperatorId: string | undefined;
  let originalUser: string | undefined;
  let originalUsername: string | undefined;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(resolve(tmpdir(), "cambrian-test-"));
    originalHome = process.env.HOME;
    originalCwd = process.cwd();
    originalServer = process.env.CAMBRIAN_SERVER;
    originalOperatorId = process.env.CAMBRIAN_OPERATOR_ID;
    originalUser = process.env.USER;
    originalUsername = process.env.USERNAME;
    process.env.HOME = tmpDir;
    process.env.USER = "tester";
    process.env.USERNAME = "tester";
    delete process.env.CAMBRIAN_SERVER;
    delete process.env.CAMBRIAN_OPERATOR_ID;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalServer === undefined) delete process.env.CAMBRIAN_SERVER;
    else process.env.CAMBRIAN_SERVER = originalServer;
    if (originalOperatorId === undefined) delete process.env.CAMBRIAN_OPERATOR_ID;
    else process.env.CAMBRIAN_OPERATOR_ID = originalOperatorId;
    if (originalUser === undefined) delete process.env.USER;
    else process.env.USER = originalUser;
    if (originalUsername === undefined) delete process.env.USERNAME;
    else process.env.USERNAME = originalUsername;
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns defaults when no config and no env vars", async () => {
    const { loadConfig } = await import("./config");
    const cfg = loadConfig();
    expect(cfg.server).toBe("localhost:50051");
    expect(cfg.operatorId).toBe("tester");
  });

  it("honors CAMBRIAN_SERVER env var", async () => {
    process.env.CAMBRIAN_SERVER = "remote:50051";
    const { loadConfig } = await import("./config");
    const cfg = loadConfig();
    expect(cfg.server).toBe("remote:50051");
  });

  it("honors CAMBRIAN_OPERATOR_ID env var", async () => {
    process.env.CAMBRIAN_OPERATOR_ID = "custom-id";
    const { loadConfig } = await import("./config");
    const cfg = loadConfig();
    expect(cfg.operatorId).toBe("custom-id");
  });

  it("env vars override config file values", async () => {
    const xdgDir = resolve(tmpDir, ".config/cambrian");
    const xdgFile = resolve(xdgDir, "config.json");
    mkdirSync(xdgDir, { recursive: true });
    writeFileSync(xdgFile, JSON.stringify({
      server: "from-file:50051",
      operator_id: "from-file",
    }));
    process.env.CAMBRIAN_SERVER = "from-env:50051";
    const { loadConfig } = await import("./config");
    const cfg = loadConfig();
    expect(cfg.server).toBe("from-env:50051");
  });

  it("reads from XDG path when it exists", async () => {
    const xdgDir = resolve(tmpDir, ".config/cambrian");
    const xdgFile = resolve(xdgDir, "config.json");
    mkdirSync(xdgDir, { recursive: true });
    writeFileSync(xdgFile, JSON.stringify({
      server: "xdg:50051",
      operator_id: "xdg-user",
    }));
    const { loadConfig } = await import("./config");
    const cfg = loadConfig();
    expect(cfg.server).toBe("xdg:50051");
    expect(cfg.operatorId).toBe("xdg-user");
  });

  it("reads from local config.json when it exists (takes precedence)", async () => {
    const xdgDir = resolve(tmpDir, ".config/cambrian");
    const xdgFile = resolve(xdgDir, "config.json");
    mkdirSync(xdgDir, { recursive: true });
    writeFileSync(xdgFile, JSON.stringify({ server: "xdg:50051" }));
    process.chdir(tmpDir);
    writeFileSync("./config.json", JSON.stringify({ server: "local:50051" }));
    const { loadConfig } = await import("./config");
    const cfg = loadConfig();
    expect(cfg.server).toBe("local:50051");
  });

  it("ignores invalid JSON gracefully", async () => {
    const xdgDir = resolve(tmpDir, ".config/cambrian");
    const xdgFile = resolve(xdgDir, "config.json");
    mkdirSync(xdgDir, { recursive: true });
    writeFileSync(xdgFile, "{ not valid json");
    const { loadConfig } = await import("./config");
    const cfg = loadConfig();
    expect(cfg.server).toBe("localhost:50051");
  });

  it("reads from custom configPath option", async () => {
    const custom = resolve(tmpDir, "custom.json");
    writeFileSync(custom, JSON.stringify({ server: "custom:50051" }));
    const { loadConfig } = await import("./config");
    const cfg = loadConfig({ configPath: custom });
    expect(cfg.server).toBe("custom:50051");
  });
});

describe("findConfigPath", () => {
  let originalHome: string | undefined;
  let originalCwd: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(resolve(tmpdir(), "cambrian-test-"));
    originalHome = process.env.HOME;
    originalCwd = process.cwd();
    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when nothing exists", async () => {
    const { findConfigPath } = await import("./config");
    expect(findConfigPath()).toBeNull();
  });

  it("returns override path when it exists", async () => {
    const custom = resolve(tmpDir, "custom.json");
    writeFileSync(custom, "{}");
    const { findConfigPath } = await import("./config");
    expect(findConfigPath(custom)).toBe(custom);
  });

  it("returns null for non-existent override", async () => {
    const { findConfigPath } = await import("./config");
    expect(findConfigPath("/nonexistent/path")).toBeNull();
  });
});

describe("saveConfig", () => {
  let originalHome: string | undefined;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(resolve(tmpdir(), "cambrian-test-"));
    originalHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes to XDG path by default", async () => {
    const { saveConfig, findConfigPath } = await import("./config");
    saveConfig({ server: "saved:50051", operatorId: "saved-user" });
    const path = findConfigPath();
    expect(path).not.toBeNull();
    const raw = readFileSync(path!, "utf-8");
    const json = JSON.parse(raw);
    expect(json.server).toBe("saved:50051");
    expect(json.operator_id).toBe("saved-user");
  });

  it("writes to custom path when provided", async () => {
    const custom = resolve(tmpDir, "custom.json");
    const { saveConfig, findConfigPath } = await import("./config");
    saveConfig({ server: "x:50051", operatorId: "y" }, { configPath: custom });
    expect(existsSync(custom)).toBe(true);
    expect(findConfigPath()).toBeNull();
  });

  it("creates directory if it doesn't exist", async () => {
    const { saveConfig } = await import("./config");
    saveConfig({ server: "s:50051", operatorId: "o" });
    const xdgDir = resolve(tmpDir, ".config/cambrian");
    expect(existsSync(xdgDir)).toBe(true);
  });
});