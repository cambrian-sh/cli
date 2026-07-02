// Config loader for Cambrian CLI.
// Priority: env vars > config file > defaults.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { env } from "node:process";
import { dirname, resolve } from "node:path";

export interface Config {
  server: string;
  operatorId: string;
  token?: string;
}

const DEFAULTS: Config = {
  server: "localhost:50051",
  operatorId: "",
};

function xdgConfigPath(): string {
  const home = env.HOME || env.USERPROFILE || ".";
  return resolve(home, ".config/cambrian/config.json");
}

function localConfigPath(): string {
  return resolve(process.cwd(), "config.json");
}

export function findConfigPath(override?: string): string | null {
  if (override) {
    return existsSync(override) ? override : null;
  }
  for (const p of [localConfigPath(), xdgConfigPath()]) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function loadConfig(options: { configPath?: string } = {}): Config {
  const cfg = { ...DEFAULTS };

  const path = findConfigPath(options.configPath);
  if (path) {
    try {
      const raw = readFileSync(path, "utf-8");
      const json = JSON.parse(raw);
      if (json.server) cfg.server = json.server;
      if (json.operator_id) cfg.operatorId = json.operator_id;
    } catch { /* invalid JSON, use defaults */ }
  }

  if (env.CAMBRIAN_SERVER) cfg.server = env.CAMBRIAN_SERVER;
  if (env.CAMBRIAN_OPERATOR_ID) cfg.operatorId = env.CAMBRIAN_OPERATOR_ID;
  if (!cfg.operatorId) {
    cfg.operatorId = env.USER || env.USERNAME || "operator";
  }
  if (env.CAMBRIAN_TOKEN) cfg.token = env.CAMBRIAN_TOKEN;

  return cfg;
}

export function saveConfig(cfg: Config, options: { configPath?: string } = {}): void {
  const path = options.configPath || xdgConfigPath();
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify({ server: cfg.server, operator_id: cfg.operatorId }, null, 2), "utf-8");
}