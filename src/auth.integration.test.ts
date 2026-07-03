import { test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startMockServer, MockServer } from "./grpc/test-harness";
import * as grpc from "@grpc/grpc-js";

let server: MockServer;
let port: number;
let tmpDir: string;
let keychainFile: string;

beforeAll(async () => {
  server = await startMockServer();
  port = server.port;
  tmpDir = mkdtempSync(join(tmpdir(), "cambrian-auth-test-"));
  keychainFile = join(tmpDir, "keychain.json");
});

afterAll(() => {
  server.close();
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  server.clearCalls();
  server.clearResponses();
  if (existsSync(keychainFile)) {
    rmSync(keychainFile);
  }
});

async function runCLI(args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn(["bun", "run", "src/index.tsx", ...args], {
    env: {
      ...process.env,
      CAMBRIAN_SERVER: `127.0.0.1:${port}`,
      CAMBRIAN_KEYCHAIN_BACKEND: "memory",
      CAMBRIAN_KEYCHAIN_FILE: keychainFile,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  
  return { status: exitCode, stdout, stderr };
}

function getKeychainStore() {
  if (!existsSync(keychainFile)) return {};
  try {
    return JSON.parse(readFileSync(keychainFile, "utf-8"));
  } catch {
    return {};
  }
}

function getKeychainEntry() {
  const store = getKeychainStore();
  return store[`127.0.0.1:${port}`];
}

function mockJWT(exp?: number) {
  const header = Buffer.from("{}").toString("base64");
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64");
  return `${header}.${payload}.sig`;
}

const NOW = Math.floor(Date.now() / 1000);

test("Login success", async () => {
  server.setResponse("Login", {
    token: mockJWT(NOW + 3600),
    role: "operator",
  });

  const res = await runCLI(["login", "--username", "alice", "--password", "secret"]);
  if (res.status !== 0) console.log("Login error:", res.stderr);
  expect(res.status).toBe(0);
  expect(res.stdout).toContain("Logged in as alice (role: operator)");
  
  const entry = getKeychainEntry();
  expect(entry).toBeDefined();
  expect(entry.token).toBeDefined();
  expect(entry.role).toBe("operator");
  expect(entry.username).toBe("alice");
  expect(entry.expiresAt).toBe(NOW + 3600);
});

test("Login with --username and --password (non-interactive path)", async () => {
  server.setResponse("Login", {
    token: mockJWT(NOW + 3600),
    role: "operator",
  });

  const res = await runCLI(["login", "--username", "bob", "--password", "secret"]);
  expect(res.status).toBe(0);
  expect(res.stderr).not.toContain("TTY");
});

test("Login rejection", async () => {
  server.injectError("Login", grpc.status.UNAUTHENTICATED, "invalid credentials");

  const res = await runCLI(["login", "--username", "alice", "--password", "bad"]);
  expect(res.status).toBe(1);
  expect(res.stderr).toContain("auth:");
  expect(res.stderr).toContain("invalid credentials");
});

test("Whoami after login", async () => {
  server.setResponse("Login", {
    token: mockJWT(NOW + 3600),
    role: "operator",
  });

  const loginRes = await runCLI(["login", "--username", "alice", "--password", "secret"]);
  expect(loginRes.status).toBe(0);

  const whoamiRes = await runCLI(["whoami"]);
  expect(whoamiRes.status).toBe(0);
  expect(whoamiRes.stdout).toContain("User:    alice");
  expect(whoamiRes.stdout).toContain("Role:    operator");
  expect(whoamiRes.stdout).toContain("Source:  keychain");
});

test("Whoami with --token", async () => {
  const res = await runCLI(["--token", "test-jwt-2", "whoami"]);
  if (res.status !== 0) console.log("whoami --token stderr:", res.stderr);
  expect(res.status).toBe(0);
  expect(res.stdout).toContain("Source:  flag");
});

test("Whoami with CAMBRIAN_TOKEN env var", async () => {
  const res = await runCLI(["whoami"], { CAMBRIAN_TOKEN: "test-jwt-env" });
  expect(res.status).toBe(0);
  expect(res.stdout).toContain("Source:  env");
});

test("Logout clears keychain entry", async () => {
  server.setResponse("Login", { token: mockJWT(), role: "operator" });
  await runCLI(["login", "--username", "alice", "--password", "secret"]);
  expect(getKeychainEntry()).toBeDefined();

  const logoutRes = await runCLI(["logout"]);
  expect(logoutRes.status).toBe(0);
  expect(logoutRes.stdout).toContain(`Logged out of 127.0.0.1:${port}`);

  expect(getKeychainEntry()).toBeUndefined();

  const whoamiRes = await runCLI(["whoami"]);
  expect(whoamiRes.status).toBe(0);
  expect(whoamiRes.stdout).toContain("Not logged in");
});

test("Role-gating: viewer", async () => {
  server.setResponse("Login", { token: mockJWT(), role: "viewer" });
  await runCLI(["login", "--username", "viewer", "--password", "secret"]);

  const res = await runCLI(["approve", "interv-1"]);
  expect(res.status).toBe(1);
  expect(res.stderr).toContain("Permission denied: `approve` requires the \"operator\" role");
  expect(res.stderr).toContain("current role is \"viewer\"");
});

test("Role-gating: operator + authorization header assertion", async () => {
  const testJwt = mockJWT();
  server.setResponse("Login", { token: testJwt, role: "operator" });
  await runCLI(["login", "--username", "operator", "--password", "secret"]);

  server.setResponse("ResolveHITL", { commandId: "cmd-123", success: true });

  const res = await runCLI(["approve", "interv-1"]);
  if (res.status !== 0) console.log("approve stderr:", res.stderr);
  expect(res.status).toBe(0);
  expect(res.stdout).toContain("Approved (id: cmd-123)");

  const calls = server.getCalls("ResolveHITL");
  expect(calls.length).toBe(1);
  const authHeader = calls[0].metadata.get("authorization");
  expect(authHeader).toEqual([`Bearer ${testJwt}`]); // proves Bearer is used
});

test("Token expiry warning", async () => {
  const THREE_DAYS = 3 * 24 * 60 * 60;
  server.setResponse("Login", {
    token: mockJWT(NOW + THREE_DAYS),
    role: "operator",
  });
  await runCLI(["login", "--username", "alice", "--password", "secret"]);

  // Need a command that triggers resolveAuth. `status` is a good one.
  server.setResponse("GetStatus", { version: "1.0", state: "active" });
  const res = await runCLI(["status"]);
  expect(res.status).toBe(0);
  expect(res.stderr).toMatch(/expires in [23] day\(s\)/);
});

test("Token already expired", async () => {
  const ONE_HOUR_AGO = NOW - 3600;
  server.setResponse("Login", {
    token: mockJWT(ONE_HOUR_AGO),
    role: "operator",
  });
  await runCLI(["login", "--username", "alice", "--password", "secret"]);

  server.setResponse("GetStatus", { version: "1.0", state: "active" });
  const res = await runCLI(["status"]);
  expect(res.status).toBe(0);
  expect(res.stderr).toContain("expired on");
});
