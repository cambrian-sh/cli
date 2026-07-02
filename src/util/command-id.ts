import { randomUUID, createHash } from "node:crypto";

const NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

function uuidV5(name: string, namespace: string): string {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const nameBytes = Buffer.from(name, "utf-8");
  const combined = Buffer.concat([nsBytes, nameBytes]);
  const hash = createHash("sha1").update(combined).digest();
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50;
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function sortedStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val as Record<string, unknown>).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return val;
  });
}

export function newCommandId(): string {
  return randomUUID();
}

export function commandIdForRetry(
  subcommand: string,
  args: Record<string, unknown>
): string {
  const canonical = sortedStringify({ subcommand, args });
  return uuidV5(canonical, NAMESPACE);
}
