import { describe, test, expect, beforeEach, afterEach, afterAll } from "bun:test";

import {
  resolveToken,
  resolveAuth,
  isMutatingRole,
  login as authLogin,
  logout as authLogout,
  whoami as authWhoami,
  formatWhoami,
  warnIfExpiringSoon,
  resetExpiryWarningForTests,
  type Role,
} from "./auth";
import { getKeychain, resetKeychainForTests, __winKeyPathForTests } from "./util/keychain";

const TEST_SERVER = "test.example:50051";
const FLAG_TOKEN = "flag.jwt.token";
const ENV_TOKEN = "env.jwt.token";
const KC_TOKEN = "keychain.jwt.token";

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  process.env.CAMBRIAN_KEYCHAIN_BACKEND = "memory";
  resetKeychainForTests();
  setEnv("CAMBRIAN_TOKEN", undefined);
  getKeychain().clear(TEST_SERVER);
});

afterAll(() => {
  setEnv("CAMBRIAN_KEYCHAIN_BACKEND", undefined);
  setEnv("CAMBRIAN_TOKEN", undefined);
  resetKeychainForTests();
});

describe("resolveToken precedence", () => {
  test("returns null when no source is available", () => {
    expect(resolveToken(undefined, TEST_SERVER)).toBeNull();
  });

  test("returns flag token when --token is provided", () => {
    setEnv("CAMBRIAN_TOKEN", ENV_TOKEN);
    getKeychain().set(TEST_SERVER, {
      token: KC_TOKEN,
      role: "operator",
      username: "kcuser",
    });
    const r = resolveToken(FLAG_TOKEN, TEST_SERVER);
    expect(r?.token).toBe(FLAG_TOKEN);
    expect(r?.source).toBe("flag");
  });

  test("returns env token when --token is absent and CAMBRIAN_TOKEN is set", () => {
    setEnv("CAMBRIAN_TOKEN", ENV_TOKEN);
    getKeychain().set(TEST_SERVER, {
      token: KC_TOKEN,
      role: "operator",
      username: "kcuser",
    });
    const r = resolveToken(undefined, TEST_SERVER);
    expect(r?.token).toBe(ENV_TOKEN);
    expect(r?.source).toBe("env");
  });

  test("returns keychain token when flag and env are absent", () => {
    getKeychain().set(TEST_SERVER, {
      token: KC_TOKEN,
      role: "operator",
      username: "kcuser",
    });
    const r = resolveToken(undefined, TEST_SERVER);
    expect(r?.token).toBe(KC_TOKEN);
    expect(r?.source).toBe("keychain");
  });
});

describe("resolveAuth role mapping", () => {
  test("keychain entry exposes role + username + expiry", () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 7 * 86400;
    getKeychain().set(TEST_SERVER, {
      token: KC_TOKEN,
      role: "viewer",
      username: "alice",
      expiresAt,
    });
    const a = resolveAuth(undefined, TEST_SERVER);
    expect(a.token).toBe(KC_TOKEN);
    expect(a.role).toBe("viewer");
    expect(a.username).toBe("alice");
    expect(a.expiresAt).toBe(expiresAt);
  });

  test("flag/env sources default to operator role", () => {
    setEnv("CAMBRIAN_TOKEN", ENV_TOKEN);
    const a = resolveAuth(undefined, TEST_SERVER);
    expect(a.role).toBe("operator");
    expect(a.username).toBeNull();
    expect(a.expiresAt).toBeNull();
  });

  test("no source returns unknown role and null token", () => {
    const a = resolveAuth(undefined, TEST_SERVER);
    expect(a.token).toBeNull();
    expect(a.role).toBe("unknown");
  });
});

describe("isMutatingRole", () => {
  test("operator is mutating", () => {
    expect(isMutatingRole("operator")).toBe(true);
  });
  test("viewer is not mutating", () => {
    expect(isMutatingRole("viewer")).toBe(false);
  });
  test("unknown fails open (kernel is the real boundary)", () => {
    expect(isMutatingRole("unknown")).toBe(true);
  });
});

describe("whoami", () => {
  test("returns source=none when not logged in", () => {
    const r = authWhoami(undefined, TEST_SERVER);
    expect(r.source).toBe("none");
    expect(r.role).toBe("unknown");
    expect(r.token).toBeNull();
  });

  test("returns keychain entry without echoing the token", () => {
    getKeychain().set(TEST_SERVER, {
      token: KC_TOKEN,
      role: "operator",
      username: "bob",
      expiresAt: Math.floor(Date.now() / 1000) + 14 * 86400,
    });
    const r = authWhoami(undefined, TEST_SERVER);
    expect(r.source).toBe("keychain");
    expect(r.username).toBe("bob");
    expect(r.role).toBe("operator");
    expect(r.token).toBeNull();
    expect(r.daysUntilExpiry).toBe(14);
  });

  test("flag/env source yields operator role, no expiry", () => {
    setEnv("CAMBRIAN_TOKEN", ENV_TOKEN);
    const r = authWhoami(undefined, TEST_SERVER);
    expect(r.source).toBe("env");
    expect(r.role).toBe("operator");
    expect(r.daysUntilExpiry).toBeNull();
  });
});

describe("formatWhoami", () => {
  test("not-logged-in message", () => {
    const r = authWhoami(undefined, TEST_SERVER);
    const out = formatWhoami(r);
    expect(out).toContain("Not logged in");
    expect(out).toContain(TEST_SERVER);
  });

  test("logged-in message includes role + expiry", () => {
    getKeychain().set(TEST_SERVER, {
      token: KC_TOKEN,
      role: "operator",
      username: "carol",
      expiresAt: Math.floor(Date.now() / 1000) + 3 * 86400,
    });
    const r = authWhoami(undefined, TEST_SERVER);
    const out = formatWhoami(r);
    expect(out).toContain("Server:");
    expect(out).toContain("User:    carol");
    expect(out).toContain("Role:    operator");
    expect(out).toMatch(/Expires:.*3d until expiry/);
  });
});

describe("logout", () => {
  test("clears keychain entry", () => {
    getKeychain().set(TEST_SERVER, {
      token: KC_TOKEN,
      role: "operator",
      username: "dan",
    });
    expect(getKeychain().get(TEST_SERVER)?.token).toBe(KC_TOKEN);
    authLogout(TEST_SERVER);
    expect(getKeychain().get(TEST_SERVER)).toBeNull();
  });
});

describe("winKeyPath", () => {
  test("places file under %LOCALAPPDATA%/cambrian/keychain/", () => {
    const path = __winKeyPathForTests("localhost:50051");
    expect(path).toMatch(/cambrian[\\/]keychain[\\/]/);
    expect(path.endsWith(".enc")).toBe(true);
  });

  test("URL-encodes special characters in the server name", () => {
    const path = __winKeyPathForTests("prod.example.com:50051");
    expect(path).not.toMatch(/:/);
    expect(path).toMatch(/prod\.example\.com/);
  });
});

describe("warnIfExpiringSoon", () => {
  let errOutput: string[];
  let originalError: typeof console.error;
  let nowSec: number;

  beforeEach(() => {
    resetExpiryWarningForTests();
    errOutput = [];
    originalError = console.error;
    console.error = (...args: unknown[]) => {
      errOutput.push(args.map((a) => String(a)).join(" "));
    };
    nowSec = 1_700_000_000;
  });

  afterEach(() => {
    console.error = originalError;
  });

  test("does not warn when expiresAt is null", () => {
    warnIfExpiringSoon({ token: "x", role: "operator", username: null, expiresAt: null }, nowSec);
    expect(errOutput.length).toBe(0);
  });

  test("does not warn when more than 7 days remain", () => {
    warnIfExpiringSoon(
      { token: "x", role: "operator", username: null, expiresAt: nowSec + 30 * 86400 },
      nowSec
    );
    expect(errOutput.length).toBe(0);
  });

  test("warns when exactly 7 days remain", () => {
    warnIfExpiringSoon(
      { token: "x", role: "operator", username: null, expiresAt: nowSec + 7 * 86400 },
      nowSec
    );
    expect(errOutput.length).toBe(1);
    expect(errOutput[0]).toContain("expires in 7 day");
  });

  test("warns when 1 day remains", () => {
    warnIfExpiringSoon(
      { token: "x", role: "operator", username: null, expiresAt: nowSec + 86400 },
      nowSec
    );
    expect(errOutput.length).toBe(1);
    expect(errOutput[0]).toContain("expires in 1 day");
  });

  test("warns with 'expired' message when past expiry", () => {
    warnIfExpiringSoon(
      { token: "x", role: "operator", username: null, expiresAt: nowSec - 3600 },
      nowSec
    );
    expect(errOutput.length).toBe(1);
    expect(errOutput[0]).toContain("expired");
  });

  test("only warns once per process", () => {
    warnIfExpiringSoon(
      { token: "x", role: "operator", username: null, expiresAt: nowSec + 86400 },
      nowSec
    );
    warnIfExpiringSoon(
      { token: "x", role: "operator", username: null, expiresAt: nowSec + 86400 },
      nowSec
    );
    expect(errOutput.length).toBe(1);
  });
});
