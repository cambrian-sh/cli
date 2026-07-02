// OS keychain abstraction. Stores {token, role, expires_at} per server.
//
// V1: shells out to platform-native CLIs. No new dependencies.
//   macOS:    `security` (Keychain)
//   Linux:    `secret-tool` (Secret Service / libsecret)
//   Windows:  `cmdkey` (Credential Manager)
//
// Env override for tests: CAMBRIAN_KEYCHAIN_BACKEND = stub | memory

import { spawnSync } from "node:child_process";
import { platform } from "node:process";

export interface KeychainEntry {
  token: string;
  role: string; // "operator" | "viewer"
  expiresAt?: number; // unix seconds; optional
  username: string;
}

const SERVICE_PREFIX = "cambrian-cli";
const ACCOUNT_PREFIX = "operator";

function serviceName(): string {
  return SERVICE_PREFIX;
}

function accountFor(server: string): string {
  return `${ACCOUNT_PREFIX}@${server}`;
}

function payload(entry: KeychainEntry): string {
  return JSON.stringify(entry);
}

function parsePayload(raw: string): KeychainEntry | null {
  try {
    const obj = JSON.parse(raw);
    if (typeof obj?.token === "string" && typeof obj?.role === "string") {
      return {
        token: obj.token,
        role: obj.role,
        expiresAt: typeof obj.expiresAt === "number" ? obj.expiresAt : undefined,
        username: typeof obj.username === "string" ? obj.username : "",
      };
    }
    return null;
  } catch {
    return null;
  }
}

export interface KeychainBackend {
  available(): boolean;
  get(server: string): KeychainEntry | null;
  set(server: string, entry: KeychainEntry): void;
  clear(server: string): void;
}

// ---- macOS: security CLI ----

const darwinBackend: KeychainBackend = {
  available() {
    const r = spawnSync("security", ["help"], { stdio: "ignore" });
    return r.status === 0;
  },
  get(server) {
    const r = spawnSync(
      "security",
      [
        "find-generic-password",
        "-s", serviceName(),
        "-a", accountFor(server),
        "-w",
      ],
      { encoding: "utf-8" }
    );
    if (r.status !== 0 || !r.stdout) return null;
    return parsePayload(r.stdout.trim());
  },
  set(server, entry) {
    const r = spawnSync(
      "security",
      [
        "add-generic-password",
        "-U",
        "-s", serviceName(),
        "-a", accountFor(server),
        "-w", payload(entry),
      ],
      { stdio: "ignore" }
    );
    if (r.status !== 0) {
      throw new Error(`keychain set failed: ${r.stderr?.toString() ?? "unknown"}`);
    }
  },
  clear(server) {
    spawnSync(
      "security",
      [
        "delete-generic-password",
        "-s", serviceName(),
        "-a", accountFor(server),
      ],
      { stdio: "ignore" }
    );
  },
};

// ---- Linux: secret-tool CLI (libsecret) ----

const linuxBackend: KeychainBackend = {
  available() {
    const r = spawnSync("secret-tool", ["--help"], { stdio: "ignore" });
    return r.status === 0 || r.status === 1; // --help exits 1 on some versions
  },
  get(server) {
    const r = spawnSync(
      "secret-tool",
      [
        "lookup",
        "service", serviceName(),
        "account", accountFor(server),
      ],
      { encoding: "utf-8" }
    );
    if (r.status !== 0 || !r.stdout) return null;
    return parsePayload(r.stdout.trim());
  },
  set(server, entry) {
    const r = spawnSync(
      "secret-tool",
      [
        "store",
        "--label", `Cambrian CLI — ${server}`,
        "service", serviceName(),
        "account", accountFor(server),
      ],
      { input: payload(entry), encoding: "utf-8" }
    );
    if (r.status !== 0) {
      throw new Error(`keychain set failed: ${r.stderr?.toString() ?? "unknown"}`);
    }
  },
  clear(server) {
    spawnSync(
      "secret-tool",
      [
        "clear",
        "service", serviceName(),
        "account", accountFor(server),
      ],
      { stdio: "ignore" }
    );
  },
};

// ---- Windows: DPAPI-encrypted file under %LOCALAPPDATA% ----
//
// We avoid Credential Manager (requires the CredentialManager PS module
// which needs admin to install). DPAPI with DataProtectionScope.CurrentUser
// is the OS-provided secure store: the user's login credentials derive the
// encryption key, so only the same Windows user can decrypt. No admin
// rights, no extra modules — just System.Security.Cryptography.ProtectedData
// via PowerShell (present on every supported Windows version).
//
// Path: %LOCALAPPDATA%\cambrian\keychain\<urlencoded-server>.enc
//   e.g. C:\Users\alice\AppData\Local\cambrian\keychain\localhost%3A50051.enc
//
// Per-user, per-server. Survives reboots. Removed on `cambrian logout`.

import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

function winKeyPath(server: string): string {
  const localAppData =
    process.env.LOCALAPPDATA ||
    join(process.env.USERPROFILE || "", "AppData", "Local");
  const fileName =
    encodeURIComponent(server).replace(/[%]/g, "_") + ".enc";
  return join(localAppData, "cambrian", "keychain", fileName);
}

export { winKeyPath as __winKeyPathForTests };

function psSingleQuote(s: string): string {
  return s.replace(/'/g, "''");
}

const win32Backend: KeychainBackend = {
  available() {
    const r = spawnSync(
      "powershell",
      ["-NoProfile", "-Command", "exit 0"],
      { stdio: "ignore" }
    );
    return r.status === 0;
  },
  get(server) {
    const path = winKeyPath(server);
    if (!existsSync(path)) return null;
    const script = `
$path = '${psSingleQuote(path)}'
$protected = [System.IO.File]::ReadAllBytes($path)
$bytes = [System.Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[System.Text.Encoding]::UTF8.GetString($bytes)
`;
    const r = spawnSync(
      "powershell",
      ["-NoProfile", "-Command", script],
      { encoding: "utf-8" }
    );
    if (r.status !== 0 || !r.stdout) return null;
    return parsePayload(r.stdout.trim());
  },
  set(server, entry) {
    const path = winKeyPath(server);
    const dir = join(path, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const script = `
$path = '${psSingleQuote(path)}'
$json = [Console]::In.ReadToEnd()
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
$protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[System.IO.File]::WriteAllBytes($path, $protected)
`;
    const r = spawnSync(
      "powershell",
      ["-NoProfile", "-Command", script],
      { input: payload(entry), encoding: "utf-8" }
    );
    if (r.status !== 0) {
      const err = r.stderr?.toString().trim() || "unknown";
      throw new Error(`DPAPI keychain write failed: ${err}`);
    }
  },
  clear(server) {
    const path = winKeyPath(server);
    if (existsSync(path)) unlinkSync(path);
  },
};

// ---- In-memory backend (tests, headless CI) ----

const memoryBackend: KeychainBackend = (() => {
  const store = new Map<string, KeychainEntry>();
  return {
    available: () => true,
    get: (server) => store.get(server) ?? null,
    set: (server, entry) => { store.set(server, entry); },
    clear: (server) => { store.delete(server); },
  };
})();

let resolvedBackend: KeychainBackend | null = null;

function pickBackend(): KeychainBackend {
  const override = process.env.CAMBRIAN_KEYCHAIN_BACKEND;
  if (override === "stub" || override === "memory") return memoryBackend;
  const os = platform;
  if (os === "darwin") return darwinBackend;
  if (os === "linux") return linuxBackend;
  if (os === "win32") return win32Backend;
  return memoryBackend;
}

export function getKeychain(): KeychainBackend {
  if (!resolvedBackend) resolvedBackend = pickBackend();
  return resolvedBackend;
}

export function resetKeychainForTests(): void {
  resolvedBackend = null;
}

export { memoryBackend as __keychainMemoryForTests };
