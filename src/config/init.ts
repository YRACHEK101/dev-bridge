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

/** Asks one question and resolves the user's line. */
export type PromptFn = (query: string) => Promise<string>;

export interface InitOptions {
  cwd?: string;
  /** Skip prompts and write defaults (used when there is no TTY, or --yes). */
  yes?: boolean;
  /** Overwrite an existing config without asking. */
  force?: boolean;
  /** Prompt input stream (default process.stdin). */
  input?: NodeJS.ReadableStream;
  /** Prompt output stream (default process.stdout). */
  output?: NodeJS.WritableStream;
  /** Whether to treat this as an interactive session (default: input.isTTY). */
  isTTY?: boolean;
  /** Inject the prompt function directly (used for testing). Forces interactive. */
  prompt?: PromptFn;
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
  const input = options.input ?? stdin;
  const output = options.output ?? stdout;
  const isTTY = options.isTTY ?? (input as NodeJS.ReadStream).isTTY === true;
  const interactive = !options.yes && (options.prompt !== undefined || isTTY);

  if (!interactive) {
    return writeConfig(configPath, defaultConfig(), options.force ?? false);
  }

  // Use the injected prompt, or a readline-backed one over the given streams.
  let close = () => {};
  let prompt: PromptFn;
  if (options.prompt) {
    prompt = options.prompt;
  } else {
    const rl = createInterface({ input, output });
    prompt = (query) => rl.question(query);
    close = () => rl.close();
  }

  try {
    if (existsSync(configPath) && !options.force) {
      const answer = (await prompt(`${DEFAULT_CONFIG_FILENAME} already exists. Overwrite? (y/N) `))
        .trim()
        .toLowerCase();
      if (answer !== "y" && answer !== "yes") {
        return { configPath, written: false };
      }
    }

    const defaults = defaultConfig();
    const frontendCommand = await ask(prompt, "Frontend command", defaults.frontend.command);
    const frontendPort = await askPort(prompt, "Frontend port", defaults.frontend.port, output);
    const frontendCwd = await ask(prompt, "Frontend directory", defaults.frontend.cwd);
    const backendCommand = await ask(prompt, "Backend command", defaults.backend.command);
    const backendPort = await askPort(prompt, "Backend port", defaults.backend.port, output);
    const backendCwd = await ask(prompt, "Backend directory", defaults.backend.cwd);
    const proxyPort = await askPort(prompt, "Unified proxy port", defaults.proxy.port, output);
    const apiPrefix = await ask(prompt, "API path prefix", defaults.proxy.apiPrefix);

    // Re-validate through the schema so an interactive typo can't produce an
    // invalid file.
    const config = configSchema.parse({
      frontend: { command: frontendCommand, port: frontendPort, cwd: frontendCwd },
      backend: { command: backendCommand, port: backendPort, cwd: backendCwd },
      proxy: { port: proxyPort, apiPrefix },
    });

    return writeConfig(configPath, config, true);
  } finally {
    close();
  }
}

function writeConfig(configPath: string, config: DevBridgeConfig, force: boolean): InitResult {
  if (existsSync(configPath) && !force) {
    return { configPath, written: false };
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  return { configPath, written: true };
}

async function ask(prompt: PromptFn, label: string, fallback: string): Promise<string> {
  const answer = (await prompt(`${label} [${fallback}]: `)).trim();
  return answer.length > 0 ? answer : fallback;
}

async function askPort(
  prompt: PromptFn,
  label: string,
  fallback: number,
  output: NodeJS.WritableStream,
): Promise<number> {
  // Re-prompt until a valid port is given, so we never build an invalid config.
  for (;;) {
    const answer = (await prompt(`${label} [${fallback}]: `)).trim();
    if (answer.length === 0) return fallback;
    const port = Number(answer);
    if (Number.isInteger(port) && port >= 1 && port <= 65535) return port;
    output.write(`  "${answer}" is not a valid port (1-65535). Try again.\n`);
  }
}
