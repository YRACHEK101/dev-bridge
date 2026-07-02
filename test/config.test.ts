import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
  loadConfig,
  loadConfigFile,
  ConfigError,
  configSchema,
  defaultConfig,
  runInit,
  detectStack,
} from "../src/config/index.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "portbridge-config-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeConfigFile(contents: unknown | string): string {
  const path = join(dir, "portbridge.config.json");
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
    expect(config.proxy).toEqual({ port: 4000, apiPrefix: "/api", host: "127.0.0.1" });
    expect(config.backend.cwd).toBe(".");
    expect(config.frontend.host).toBe("localhost");
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

    expect(config.frontend).toEqual({
      command: "npm run dev",
      port: 5173,
      cwd: "./client",
      host: "localhost",
    });
    expect(config.backend.port).toBe(5000);
    expect(config.proxy.apiPrefix).toBe("/api");
    expect(config.proxy.host).toBe("127.0.0.1");
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

describe("loadConfigFile (multi-format)", () => {
  it("loads a .json config", async () => {
    writeFileSync(
      join(dir, "portbridge.config.json"),
      JSON.stringify({
        frontend: { command: "npm run dev", port: 5173 },
        backend: { command: "npm run server", port: 5000 },
      }),
      "utf8",
    );
    const { config, configPath } = await loadConfigFile({ cwd: dir });
    expect(configPath.endsWith(".json")).toBe(true);
    expect(config.frontend.port).toBe(5173);
  });

  it("loads and validates a .mjs config (via jiti)", async () => {
    writeFileSync(
      join(dir, "portbridge.config.mjs"),
      [
        "export default {",
        "  frontend: { command: 'vite', port: 5173 },",
        "  backend: { command: 'node server.js', port: 4000 },",
        "  proxy: { port: 8080, apiPrefix: '/api' },",
        "};",
      ].join("\n"),
      "utf8",
    );
    const { config, configPath } = await loadConfigFile({ cwd: dir });
    expect(configPath.endsWith(".mjs")).toBe(true);
    expect(config.frontend.command).toBe("vite");
    expect(config.proxy.port).toBe(8080);
  });

  it("reports schema errors from a .mjs config", async () => {
    writeFileSync(
      join(dir, "portbridge.config.mjs"),
      "export default { frontend: { command: 'x' } };", // missing port + backend
      "utf8",
    );
    await expect(loadConfigFile({ cwd: dir })).rejects.toBeInstanceOf(ConfigError);
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

  // Returns a prompt function that replies with scripted answers in order.
  function scripted(answers: string[]) {
    let i = 0;
    return async () => answers[i++] ?? "";
  }

  it("builds a config from interactive answers", async () => {
    // Answers in prompt order: frontend command/port/cwd, backend command/port/cwd,
    // proxy port, api prefix.
    const prompt = scripted([
      "vite",
      "5001",
      "./ui",
      "node api.js",
      "8080",
      "./api",
      "4321",
      "/rest",
    ]);

    const result = await runInit({ cwd: dir, prompt });
    expect(result.written).toBe(true);

    const { config } = loadConfig({ configPath: result.configPath });
    expect(config.frontend).toMatchObject({ command: "vite", port: 5001, cwd: "./ui" });
    expect(config.backend).toMatchObject({ command: "node api.js", port: 8080, cwd: "./api" });
    expect(config.proxy).toMatchObject({ port: 4321, apiPrefix: "/rest" });
  });

  it("re-prompts on an invalid port and keeps the rest", async () => {
    const output = new PassThrough();
    output.resume();
    // frontend port invalid twice then valid (6001); every other field blank -> default.
    const prompt = scripted(["", "notaport", "70000", "6001"]);

    const result = await runInit({ cwd: dir, prompt, output });
    const { config } = loadConfig({ configPath: result.configPath });
    expect(config.frontend.port).toBe(6001);
    expect(config.frontend.command).toBe(defaultConfig().frontend.command); // blank -> default
    expect(config.proxy.apiPrefix).toBe(defaultConfig().proxy.apiPrefix); // ran out -> "" -> default
  });
});

describe("detectStack", () => {
  function writePkg(pkg: unknown): void {
    writeFileSync(join(dir, "package.json"), JSON.stringify(pkg), "utf8");
  }

  it("detects Next.js on the frontend", () => {
    writePkg({ dependencies: { next: "14" }, scripts: { dev: "next dev" } });
    const s = detectStack(dir);
    expect(s.frontend).toEqual({ framework: "Next.js", command: "npm run dev", port: 3000 });
  });

  it("detects Vite on the frontend", () => {
    writePkg({ devDependencies: { vite: "5" } });
    expect(detectStack(dir).frontend).toMatchObject({ framework: "Vite", port: 5173 });
  });

  it("detects Express on the backend", () => {
    writePkg({ dependencies: { express: "4" }, scripts: { server: "node server.js" } });
    expect(detectStack(dir).backend).toEqual({
      framework: "Express",
      command: "npm run server",
      port: 5000,
    });
  });

  it("falls back to sensible defaults with no package.json", () => {
    const s = detectStack(dir);
    expect(s.frontend).toMatchObject({ framework: null, command: "npm run dev", port: 5173 });
    expect(s.backend).toMatchObject({ framework: null, command: "npm run server", port: 5000 });
  });
});
