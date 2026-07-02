import { readFileSync, existsSync } from "node:fs";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { ZodError } from "zod";
import { configSchema, type DevBridgeConfig } from "./schema.js";

export const DEFAULT_CONFIG_FILENAME = "dev-bridge.config.json";

/** Config filenames searched, in priority order, when no explicit path is given. */
export const CONFIG_FILENAMES = [
  "dev-bridge.config.json",
  "dev-bridge.config.js",
  "dev-bridge.config.mjs",
  "dev-bridge.config.cjs",
  "dev-bridge.config.ts",
];

/** Thrown for any config problem, with a human-readable, multi-line message. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface LoadedConfig {
  /** The validated, typed config with defaults applied. */
  config: DevBridgeConfig;
  /** Absolute path to the config file that was read. */
  configPath: string;
  /**
   * Directory the config lives in. Service `cwd` values are relative to this,
   * so callers resolve `path.resolve(baseDir, service.cwd)`.
   */
  baseDir: string;
}

export interface LoadConfigOptions {
  /** Directory to search from (defaults to process.cwd()). */
  cwd?: string;
  /** Explicit path from `--config`; may be absolute or relative to `cwd`. */
  configPath?: string;
}

/** Resolve the config path from an explicit flag or the default filename. */
export function resolveConfigPath(options: LoadConfigOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  if (options.configPath) {
    return isAbsolute(options.configPath) ? options.configPath : resolve(cwd, options.configPath);
  }
  return resolve(cwd, DEFAULT_CONFIG_FILENAME);
}

/**
 * Resolve the config path, searching for any supported extension
 * (dev-bridge.config.{json,js,mjs,cjs,ts}) when no explicit path is given.
 */
export function findConfigPath(options: LoadConfigOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  if (options.configPath) return resolveConfigPath(options);
  for (const name of CONFIG_FILENAMES) {
    const candidate = resolve(cwd, name);
    if (existsSync(candidate)) return candidate;
  }
  return resolve(cwd, DEFAULT_CONFIG_FILENAME); // for the "not found" error message
}

/**
 * Format-aware, async config loader. Supports `.json` (parsed directly) and
 * `.js` / `.mjs` / `.cjs` / `.ts` (loaded via jiti). Validates with the schema.
 * This is what the CLI uses; {@link loadConfig} remains for direct JSON use.
 */
export async function loadConfigFile(options: LoadConfigOptions = {}): Promise<LoadedConfig> {
  const configPath = findConfigPath(options);

  if (!existsSync(configPath)) {
    throw new ConfigError(
      `No config file found (looked for ${CONFIG_FILENAMES.join(", ")}).\n` +
        `Run "dev-bridge init" to create one, or pass --config <path>.`,
    );
  }

  if (extname(configPath).toLowerCase() === ".json") {
    return loadConfig({ configPath });
  }

  let loaded: unknown;
  try {
    const jiti = createJiti(fileURLToPath(import.meta.url));
    loaded = await jiti.import(configPath, { default: true });
  } catch (err) {
    throw new ConfigError(`Could not load config at ${configPath}: ${(err as Error).message}`);
  }

  const result = configSchema.safeParse(loaded);
  if (!result.success) {
    throw new ConfigError(formatZodError(result.error, configPath));
  }
  return { config: result.data, configPath, baseDir: dirname(configPath) };
}

/**
 * Read, parse, and validate the dev-bridge config. Throws a {@link ConfigError}
 * with an actionable message when the file is missing, is not valid JSON, or
 * fails schema validation.
 */
export function loadConfig(options: LoadConfigOptions = {}): LoadedConfig {
  const configPath = resolveConfigPath(options);

  if (!existsSync(configPath)) {
    throw new ConfigError(
      `No config file found at ${configPath}\n` +
        `Run "dev-bridge init" to create one, or pass --config <path>.`,
    );
  }

  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (err) {
    throw new ConfigError(`Could not read config file at ${configPath}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(
      `Config file at ${configPath} is not valid JSON: ${(err as Error).message}`,
    );
  }

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigError(formatZodError(result.error, configPath));
  }

  return {
    config: result.data,
    configPath,
    baseDir: dirname(configPath),
  };
}

/** Turn a ZodError into a readable, one-issue-per-line message. */
function formatZodError(error: ZodError, configPath: string): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `  - ${path}: ${issue.message}`;
  });
  return (
    `Invalid dev-bridge config at ${configPath}:\n` +
    lines.join("\n") +
    `\n\nSee the example config in the README or run "dev-bridge init".`
  );
}
