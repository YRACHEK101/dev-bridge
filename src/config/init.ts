import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { configSchema, type DevBridgeConfig } from "./schema.js";
import { DEFAULT_CONFIG_FILENAME } from "./loadConfig.js";

/** A sensible starting config used as prompt defaults and non-interactive fallback. */
export function defaultConfig(): DevBridgeConfig {
  return configSchema.parse({
    frontend: { command: "npm run dev", port: 5173, cwd: "./client" },
    backend: { command: "npm run server", port: 5000, cwd: "./server" },
    proxy: { port: 4000, apiPrefix: "/api" },
  });
}

export interface InitOptions {
  cwd?: string;
  /** Skip prompts and write defaults (used when there is no TTY, or --yes). */
  yes?: boolean;
  /** Overwrite an existing config without asking. */
  force?: boolean;
}

export interface InitResult {
  configPath: string;
  written: boolean;
}

/**
 * Interactively scaffold `dev-bridge.config.json`. Falls back to writing
 * defaults when there is no interactive TTY (e.g. CI) or when `yes` is set.
 */
export async function runInit(options: InitOptions = {}): Promise<InitResult> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = resolve(cwd, DEFAULT_CONFIG_FILENAME);
  const interactive = !options.yes && stdin.isTTY === true;

  if (!interactive) {
    return writeConfig(configPath, defaultConfig(), options.force ?? false);
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    if (existsSync(configPath) && !options.force) {
      const answer = (
        await rl.question(`${DEFAULT_CONFIG_FILENAME} already exists. Overwrite? (y/N) `)
      )
        .trim()
        .toLowerCase();
      if (answer !== "y" && answer !== "yes") {
        return { configPath, written: false };
      }
    }

    const defaults = defaultConfig();
    const frontendCommand = await ask(rl, "Frontend command", defaults.frontend.command);
    const frontendPort = await askPort(rl, "Frontend port", defaults.frontend.port);
    const frontendCwd = await ask(rl, "Frontend directory", defaults.frontend.cwd);
    const backendCommand = await ask(rl, "Backend command", defaults.backend.command);
    const backendPort = await askPort(rl, "Backend port", defaults.backend.port);
    const backendCwd = await ask(rl, "Backend directory", defaults.backend.cwd);
    const proxyPort = await askPort(rl, "Unified proxy port", defaults.proxy.port);
    const apiPrefix = await ask(rl, "API path prefix", defaults.proxy.apiPrefix);

    // Re-validate through the schema so an interactive typo can't produce an
    // invalid file.
    const config = configSchema.parse({
      frontend: { command: frontendCommand, port: frontendPort, cwd: frontendCwd },
      backend: { command: backendCommand, port: backendPort, cwd: backendCwd },
      proxy: { port: proxyPort, apiPrefix },
    });

    return writeConfig(configPath, config, true);
  } finally {
    rl.close();
  }
}

function writeConfig(configPath: string, config: DevBridgeConfig, force: boolean): InitResult {
  if (existsSync(configPath) && !force) {
    return { configPath, written: false };
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  return { configPath, written: true };
}

async function ask(
  rl: ReturnType<typeof createInterface>,
  label: string,
  fallback: string,
): Promise<string> {
  const answer = (await rl.question(`${label} [${fallback}]: `)).trim();
  return answer.length > 0 ? answer : fallback;
}

async function askPort(
  rl: ReturnType<typeof createInterface>,
  label: string,
  fallback: number,
): Promise<number> {
  // Re-prompt until a valid port is given, so we never build an invalid config.
  for (;;) {
    const answer = (await rl.question(`${label} [${fallback}]: `)).trim();
    if (answer.length === 0) return fallback;
    const port = Number(answer);
    if (Number.isInteger(port) && port >= 1 && port <= 65535) return port;
    stdout.write(`  "${answer}" is not a valid port (1-65535). Try again.\n`);
  }
}
