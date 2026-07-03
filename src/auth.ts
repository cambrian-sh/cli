// Auth orchestration: login, logout, whoami, token resolution.
//
// Per ADR-CLI-002, the CLI has three ways to provide an operator token:
//   1. --token <jwt> (one-shot, never stored)
//   2. CAMBRIAN_TOKEN env var (one-shot, never stored)
//   3. OS keychain (persisted per server, set by `cambrian login`)
//
// Precedence: --token > CAMBRIAN_TOKEN > keychain
//
// The role (operator | viewer) is stored in the keychain alongside the token.
// The CLI hides mutating subcommands for Viewer.

import { createInterface } from "node:readline";
import { stdin, stdout, env, exit } from "node:process";

import { createOperatorClient, type OperatorClient } from "./grpc/operator-client";
import { getKeychain, type KeychainEntry } from "./util/keychain";

export type Role = "operator" | "viewer" | "unknown";

export interface ResolvedToken {
  token: string;
  source: "flag" | "env" | "keychain";
}

export interface ResolvedAuth {
  token: string | null;
  role: Role;
  username: string | null;
  expiresAt: number | null;
}

export function resolveToken(
  flagToken: string | undefined,
  server: string
): ResolvedToken | null {
  if (flagToken) return { token: flagToken, source: "flag" };
  if (env.CAMBRIAN_TOKEN) return { token: env.CAMBRIAN_TOKEN, source: "env" };
  const kc = getKeychain().get(server);
  if (kc) return { token: kc.token, source: "keychain" };
  return null;
}

export function resolveAuth(
  flagToken: string | undefined,
  server: string
): ResolvedAuth {
  const resolved = resolveToken(flagToken, server);
  if (!resolved) {
    return { token: null, role: "unknown", username: null, expiresAt: null };
  }
  if (resolved.source === "keychain") {
    const entry = getKeychain().get(server);
    if (entry) {
      return {
        token: entry.token,
        role: entry.role as Role,
        username: entry.username,
        expiresAt: entry.expiresAt ?? null,
      };
    }
  }
  // flag/env sources have no role info — the kernel will tell us via
  // the first authenticated call's gRPC metadata. For now, default to
  // "operator" so we don't hide subcommands from a one-shot token.
  return {
    token: resolved.token,
    role: "operator",
    username: null,
    expiresAt: null,
  };
}

export function isMutatingRole(role: Role): boolean {
  return role !== "viewer";
}

let expiryWarnEmitted = false;

export function warnIfExpiringSoon(auth: ResolvedAuth, nowSec = Math.floor(Date.now() / 1000)): void {
  if (expiryWarnEmitted) return;
  if (auth.expiresAt === null || auth.expiresAt === undefined) return;
  const secondsLeft = auth.expiresAt - nowSec;
  if (secondsLeft > 7 * 86400) return;
  expiryWarnEmitted = true;
  const iso = new Date(auth.expiresAt * 1000).toISOString().slice(0, 10);
  if (secondsLeft <= 0) {
    console.error(`Warning: token expired on ${iso}. Run \`cambrian login\` to refresh.`);
  } else {
    const days = Math.max(0, Math.floor(secondsLeft / 86400));
    console.error(`Warning: token expires in ${days} day(s) (${iso}). Run \`cambrian login\` to refresh.`);
  }
}

export function resetExpiryWarningForTests(): void {
  expiryWarnEmitted = false;
}

async function prompt(rl: ReturnType<typeof createInterface>, q: string): Promise<string> {
  return new Promise((res) => rl.question(q, (ans) => res(ans)));
}

function isTty(): boolean {
  return Boolean(stdin.isTTY && stdout.isTTY);
}

export interface LoginOptions {
  server: string;
  username?: string;
  password?: string;
}

export async function login(opts: LoginOptions): Promise<KeychainEntry> {
  let { username, password } = opts;
  if (!isTty() && (!username || !password)) {
    throw new Error(
      "cambrian login requires a TTY. Pass --username and --password, or run interactively."
    );
  }
  if (!username || !password) {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      if (!username) username = await prompt(rl, "Username: ");
      if (!password) password = await prompt(rl, "Password: ");
    } finally {
      rl.close();
    }
  }
  if (!username) throw new Error("Username is required");
  if (!password) throw new Error("Password is required");

  const client = createOperatorClient({ server: opts.server });
  try {
    const res = await client.login({ username: username!, password: password! });
    const entry: KeychainEntry = {
      token: res.token,
      role: typeof res.role === "string" ? res.role : "operator",
      username: username!,
    };
    
    // Attempt to parse JWT exp
    try {
      const parts = res.token.split(".");
      if (parts.length === 3) {
        const payloadStr = Buffer.from(parts[1]!, "base64").toString("utf-8");
        const payload = JSON.parse(payloadStr);
        if (typeof payload.exp === "number") {
          entry.expiresAt = payload.exp;
        }
      }
    } catch {
      // Ignore parse errors, just don't set expiresAt
    }

    getKeychain().set(opts.server, entry);
    return entry;
  } finally {
    client.close();
  }
}

export function logout(server: string): void {
  getKeychain().clear(server);
}

export interface WhoamiResult {
  source: ResolvedToken["source"] | "none";
  username: string | null;
  role: Role;
  server: string;
  expiresAt: number | null;
  token: string | null;
  daysUntilExpiry: number | null;
}

export function whoami(
  flagToken: string | undefined,
  server: string
): WhoamiResult {
  const resolved = resolveToken(flagToken, server);
  if (!resolved) {
    return {
      source: "none",
      username: null,
      role: "unknown",
      server,
      expiresAt: null,
      token: null,
      daysUntilExpiry: null,
    };
  }
  if (resolved.source === "keychain") {
    const entry = getKeychain().get(server);
    if (entry) {
      const nowSec = Math.floor(Date.now() / 1000);
      const days = entry.expiresAt
        ? Math.floor((entry.expiresAt - nowSec) / 86400)
        : null;
      return {
        source: "keychain",
        username: entry.username,
        role: entry.role as Role,
        server,
        expiresAt: entry.expiresAt ?? null,
        token: null, // never echo the token
        daysUntilExpiry: days,
      };
    }
  }
  return {
    source: resolved.source,
    username: null,
    role: "operator", // unknown role for one-shot tokens
    server,
    expiresAt: null,
    token: null,
    daysUntilExpiry: null,
  };
}

export function formatWhoami(r: WhoamiResult): string {
  if (r.source === "none") {
    return `Not logged in to ${r.server}.\nRun \`cambrian login\` to authenticate.`;
  }
  const lines: string[] = [];
  lines.push(`Server:  ${r.server}`);
  lines.push(`Source:  ${r.source}`);
  if (r.username) lines.push(`User:    ${r.username}`);
  lines.push(`Role:    ${r.role}`);
  if (r.expiresAt) {
    const iso = new Date(r.expiresAt * 1000).toISOString().slice(0, 10);
    const exp = r.daysUntilExpiry !== null
      ? ` (${r.daysUntilExpiry >= 0 ? `${r.daysUntilExpiry}d until expiry` : "EXPIRED"})`
      : "";
    lines.push(`Expires: ${iso}${exp}`);
  }
  return lines.join("\n");
}

export { createOperatorClient };
export type { OperatorClient };
