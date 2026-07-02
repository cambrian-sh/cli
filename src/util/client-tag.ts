import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

let cached: string | null = null;

export function clientTag(): string {
  if (cached) return cached;
  try {
    const __dirname = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, "package.json"), "utf-8")
    ) as { name: string; version: string };
    cached = `${pkg.name}/${pkg.version}`;
  } catch {
    cached = "cambrian-cli/unknown";
  }
  return cached;
}
