// Unit tests for errors.ts.
// Uses bun:test — runs via `bun test` or `bun test src/errors.test.ts`.

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { handleConnectionError } from "./errors";

describe("handleConnectionError", () => {
  let consoleErrorCalls: string[] = [];
  let originalError: typeof console.error;

  beforeEach(() => {
    consoleErrorCalls = [];
    originalError = console.error;
    console.error = (...args: any[]) => {
      consoleErrorCalls.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    console.error = originalError;
  });

  it("handles gRPC UNAVAILABLE (14) with helpful hints", () => {
    const err = { code: 14, details: "connection refused" };
    handleConnectionError(err, "localhost:50051");
    expect(consoleErrorCalls).toHaveLength(4);
    expect(consoleErrorCalls[0]).toContain("gRPC error (UNAVAILABLE)");
    expect(consoleErrorCalls[0]).toContain("connection refused");
    expect(consoleErrorCalls[1]).toContain("Could not connect to localhost:50051");
    expect(consoleErrorCalls[2]).toContain("Is the Cambrian orchestrator running?");
    expect(consoleErrorCalls[3]).toContain("CAMBRIAN_SERVER=<host>:<port>");
  });

  it("handles gRPC DEADLINE_EXCEEDED (4)", () => {
    const err = { code: 4, message: "Request timeout" };
    handleConnectionError(err, "localhost:50051");
    expect(consoleErrorCalls).toHaveLength(2);
    expect(consoleErrorCalls[0]).toContain("gRPC error (DEADLINE_EXCEEDED)");
    expect(consoleErrorCalls[1]).toContain("Request timed out");
  });

  it("handles gRPC NOT_FOUND (5)", () => {
    const err = { code: 5, message: "resource not found" };
    handleConnectionError(err, "localhost:50051");
    expect(consoleErrorCalls).toHaveLength(2);
    expect(consoleErrorCalls[0]).toContain("gRPC error (NOT_FOUND)");
    expect(consoleErrorCalls[1]).toContain("Resource not found");
  });

  it("handles gRPC PERMISSION_DENIED (7)", () => {
    const err = { code: 7, message: "no access" };
    handleConnectionError(err, "localhost:50051");
    expect(consoleErrorCalls).toHaveLength(2);
    expect(consoleErrorCalls[0]).toContain("gRPC error (PERMISSION_DENIED)");
    expect(consoleErrorCalls[1]).toContain("Permission denied");
  });

  it("handles gRPC errors with details but no message", () => {
    const err = { code: 3, details: "bad input" };
    handleConnectionError(err, "localhost:50051");
    expect(consoleErrorCalls[0]).toContain("gRPC error (INVALID_ARGUMENT)");
    expect(consoleErrorCalls[0]).toContain("bad input");
  });

  it("treats codes outside gRPC range (0-16) as generic errors", () => {
    const err = { code: 99, message: "weird error" };
    handleConnectionError(err, "localhost:50051");
    expect(consoleErrorCalls).toHaveLength(1);
    expect(consoleErrorCalls[0]).toBe("weird error");
  });

  it("handles ECONNREFUSED with specific message", () => {
    const err = new Error("connect ECONNREFUSED") as NodeJS.ErrnoException;
    err.code = "ECONNREFUSED";
    handleConnectionError(err, "localhost:50051");
    expect(consoleErrorCalls).toHaveLength(2);
    expect(consoleErrorCalls[0]).toContain("Connection refused at localhost:50051");
    expect(consoleErrorCalls[1]).toContain("Is the Cambrian orchestrator running");
  });

  it("handles ETIMEDOUT with specific message", () => {
    const err = new Error("timeout") as NodeJS.ErrnoException;
    err.code = "ETIMEDOUT";
    handleConnectionError(err, "localhost:50051");
    expect(consoleErrorCalls).toHaveLength(1);
    expect(consoleErrorCalls[0]).toContain("Connection timed out at localhost:50051");
  });

  it("handles ENOTFOUND with specific message", () => {
    const err = new Error("getaddrinfo ENOTFOUND") as NodeJS.ErrnoException;
    err.code = "ENOTFOUND";
    handleConnectionError(err, "missing.example.com");
    expect(consoleErrorCalls).toHaveLength(1);
    expect(consoleErrorCalls[0]).toContain("Server host not found: missing.example.com");
  });

  it("falls back to err.message for unknown errors", () => {
    handleConnectionError(new Error("something went wrong"), "localhost:50051");
    expect(consoleErrorCalls).toHaveLength(1);
    expect(consoleErrorCalls[0]).toBe("something went wrong");
  });

  it("handles null/undefined errors gracefully", () => {
    handleConnectionError(null, "localhost:50051");
    expect(consoleErrorCalls).toHaveLength(1);
    expect(consoleErrorCalls[0]).toBe("null");
  });

  it("handles string errors via String()", () => {
    handleConnectionError("plain string error", "localhost:50051");
    expect(consoleErrorCalls).toHaveLength(1);
    expect(consoleErrorCalls[0]).toBe("plain string error");
  });
});