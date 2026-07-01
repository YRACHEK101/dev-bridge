import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadConfig,
  ConfigError,
  configSchema,
  defaultConfig,
  runInit,
} from "../src/config/index.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "devbridge-config-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeConfigFile(contents: unknown | string): string {
  const path = join(dir, "dev-bridge.config.json");
  const body = typeof contents === "string" ? contents : JSON.stringify(contents);
  writeFileSync(path, body, "utf8");
  return path;
}

describe("configSchema", () => {
  it("applies defaults for proxy and optional fields", () => {
    const config = configSchema.parse({
      frontend: { command: "npm run dev", port: 5173, cwd: "./client" },
      backend: { command: "npm run server", port: 5000 },
    });
    expect(config.proxy).toEqual({ port: 4000, apiPrefix: "/api" });
    expect(config.backend.cwd).toBe(".");
    expect(config.restartOnCrash).toBe(false);
  });
});

describe("loadConfig", () => {
  it("parses a valid config file correctly", () => {
    const configPath = writeConfigFile({
      frontend: { command: "npm run dev", port: 5173, cwd: "./client" },
      backend: { command: "npm run server", port: 5000, cwd: "./server" },
      proxy: { port: 4000, apiPrefix: "/api" },
    });

    const { config, baseDir } = loadConfig({ configPath });

    expect(config.frontend).toEqual({ command: "npm run dev", port: 5173, cwd: "./client" });
    expect(config.backend.port).toBe(5000);
    expect(config.proxy.apiPrefix).toBe("/api");
    expect(baseDir).toBe(dir);
  });

  it("throws a descriptive error when a required field is missing", () => {
    const configPath = writeConfigFile({
      frontend: { command: "npm run dev", port: 5173 },
      // backend omitted entirely
    });

    expect(() => loadConfig({ configPath })).toThrowError(ConfigError);
    try {
      loadConfig({ configPath });
    } catch (err) {
      const message = (err as ConfigError).message;
      expect(message).toContain("backend");
      expect(message).toContain(configPath);
    }
  });

  it("throws when a port has the wrong type", () => {
    const configPath = writeConfigFile({
      frontend: { command: "npm run dev", port: "5173" },
      backend: { command: "npm run server", port: 5000 },
    });

    try {
      loadConfig({ configPath });
      throw new Error("expected loadConfig to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).message).toContain("frontend.port");
      expect((err as ConfigError).message).toContain("number");
    }
  });

  it("rejects an out-of-range port", () => {
    const configPath = writeConfigFile({
      frontend: { command: "npm run dev", port: 70000 },
      backend: { command: "npm run server", port: 5000 },
    });
    expect(() => loadConfig({ configPath })).toThrowError(/frontend\.port/);
  });

  it("rejects unknown top-level keys (typo protection)", () => {
    const configPath = writeConfigFile({
      fronend: { command: "npm run dev", port: 5173 },
      backend: { command: "npm run server", port: 5000 },
    });
    expect(() => loadConfig({ configPath })).toThrowError(ConfigError);
  });

  it("throws a clear error for malformed JSON", () => {
    const configPath = writeConfigFile("{ not valid json ");
    expect(() => loadConfig({ configPath })).toThrowError(/not valid JSON/);
  });

  it("throws a helpful error when the file is missing", () => {
    const configPath = join(dir, "does-not-exist.json");
    expect(() => loadConfig({ configPath })).toThrowError(/No config file found/);
  });
});

describe("runInit", () => {
  it("writes a valid default config non-interactively", async () => {
    const result = await runInit({ cwd: dir, yes: true });
    expect(result.written).toBe(true);
    expect(existsSync(result.configPath)).toBe(true);

    // The written file must round-trip through the loader.
    const { config } = loadConfig({ configPath: result.configPath });
    expect(config).toEqual(defaultConfig());
  });

  it("does not overwrite an existing config without force", async () => {
    const configPath = writeConfigFile({
      frontend: { command: "custom", port: 1111 },
      backend: { command: "custom", port: 2222 },
    });
    const before = readFileSync(configPath, "utf8");

    const result = await runInit({ cwd: dir, yes: true });
    expect(result.written).toBe(false);
    expect(readFileSync(configPath, "utf8")).toBe(before);
  });
});
