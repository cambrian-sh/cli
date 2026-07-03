import { describe, expect, test } from "bun:test";
import { resolveReason } from "./reason";

describe("resolveReason", () => {
  test("returns --reason value when present", async () => {
    const result = await resolveReason(["--reason", "ship it"], { required: true });
    expect(result).toBe("ship it");
  });

  test("returns empty string when not required and no --reason", async () => {
    const result = await resolveReason([], { required: false });
    expect(result).toBe("");
  });

  test("throws when required and no --reason in non-TTY", async () => {
    const originalIsTTY = process.stdout.isTTY;
    process.stdout.isTTY = false;
    try {
      await expect(
        resolveReason([], { required: true })
      ).rejects.toThrow(/--reason is required/);
    } finally {
      process.stdout.isTTY = originalIsTTY;
    }
  });

  test("accepts reasonFlag override", async () => {
    const result = await resolveReason([], {
      required: true,
      reasonFlag: "from-flag",
    });
    expect(result).toBe("from-flag");
  });
});
