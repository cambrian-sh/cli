import { describe, expect, test } from "bun:test";
import { newCommandId, commandIdForRetry } from "./command-id";
import { clientTag } from "./client-tag";

describe("newCommandId", () => {
  test("returns a valid UUID v4", () => {
    const id = newCommandId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  test("returns a unique ID on each call", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(newCommandId());
    }
    expect(ids.size).toBe(100);
  });
});

describe("commandIdForRetry", () => {
  test("is deterministic for the same subcommand + args", () => {
    const args = { intervention_id: "abc-123", approve: true };
    const a = commandIdForRetry("approve", args);
    const b = commandIdForRetry("approve", args);
    expect(a).toBe(b);
  });

  test("differs for different subcommands", () => {
    const args = { id: "x" };
    expect(commandIdForRetry("approve", args)).not.toBe(
      commandIdForRetry("deny", args)
    );
  });

  test("differs for different args", () => {
    expect(
      commandIdForRetry("approve", { intervention_id: "a" })
    ).not.toBe(commandIdForRetry("approve", { intervention_id: "b" }));
  });

  test("is order-independent on args keys", () => {
    const a = commandIdForRetry("approve", { x: 1, y: 2 });
    const b = commandIdForRetry("approve", { y: 2, x: 1 });
    expect(a).toBe(b);
  });

  test("returns a valid UUID v5 (version 5, variant 8-b)", () => {
    const id = commandIdForRetry("approve", { x: 1 });
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });
});

describe("clientTag", () => {
  test("returns a string with name/version shape", () => {
    const tag = clientTag();
    expect(tag).toMatch(/^cambrian-cli\/.+/);
  });

  test("is cached (returns same string on repeated calls)", () => {
    expect(clientTag()).toBe(clientTag());
  });
});
