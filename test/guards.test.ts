import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:net";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkEnvFiles } from "../src/utils/envGuard.js";
import { findFreePort, PortInUseError } from "../src/utils/portCheck.js";
import { startDevBridge, type DevBridgeHandle } from "../src/runtime.js";

let dir: string | undefined;
let handle: DevBridgeHandle | undefined;
let blocker: Server | undefined;

afterEach(async () => {
  await handle?.shutdown();
  handle = undefined;
  if (blocker) await new Promise<void>((r) => blocker!.close(() => r()));
  blocker = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function occupy(port: number): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

describe("checkEnvFiles", () => {
  it("reports keys present in .env.example but missing from .env", () => {
    dir = mkdtempSync(join(tmpdir(), "devbridge-env-"));
    writeFileSync(join(dir, ".env.example"), "API_URL=\n# comment\nSECRET=\nPORT=3000\n");
    writeFileSync(join(dir, ".env"), "API_URL=http://localhost\nPORT=3000\n");

    const [warning] = checkEnvFiles([dir]);
    expect(warning).toBeDefined();
    expect(warning!.missingEnvFile).toBe(false);
    expect(warning!.missingKeys).toEqual(["SECRET"]);
  });

  it("flags a missing .env entirely when an example exists", () => {
    dir = mkdtempSync(join(tmpdir(), "devbridge-env-"));
    writeFileSync(join(dir, ".env.example"), "A=\nB=\n");

    const [warning] = checkEnvFiles([dir]);
    expect(warning!.missingEnvFile).toBe(true);
    expect(warning!.missingKeys).toEqual(["A", "B"]);
  });

  it("returns no warnings when there is no .env.example", () => {
    dir = mkdtempSync(join(tmpdir(), "devbridge-env-"));
    writeFileSync(join(dir, ".env"), "A=1\n");
    expect(checkEnvFiles([dir])).toEqual([]);
  });
});

describe("port-conflict resolution", () => {
  // Idle child processes: they just need to exist, not serve, for the port guard.
  // A real fixture script (no shell quoting) that just stays alive.
  const idleScript = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "idle.cjs");
  const idle = `node "${idleScript}"`;

  function writeConfig(proxyPort: number): void {
    dir = mkdtempSync(join(tmpdir(), "devbridge-port-"));
    writeFileSync(
      join(dir, "dev-bridge.config.json"),
      JSON.stringify({
        frontend: { command: idle, port: 5173, cwd: "." },
        backend: { command: idle, port: 5000, cwd: "." },
        proxy: { port: proxyPort, apiPrefix: "/api" },
      }),
      "utf8",
    );
  }

  it("auto-picks a free port when the configured proxy port is busy", async () => {
    const busy = (await findFreePort(6800))!;
    blocker = await occupy(busy);
    writeConfig(busy);

    handle = await startDevBridge({ cwd: dir, quiet: true });
    expect(handle.proxyPortReassignedFrom).toBe(busy);
    expect(handle.config.proxy.port).not.toBe(busy);
    expect(handle.proxy).toBeDefined();
  });

  it("throws PortInUseError with strictPort when the proxy port is busy", async () => {
    const busy = (await findFreePort(6900))!;
    blocker = await occupy(busy);
    writeConfig(busy);

    await expect(
      startDevBridge({ cwd: dir, quiet: true, strictPort: true }),
    ).rejects.toBeInstanceOf(PortInUseError);
  });
});

describe("wait-for-ready", () => {
  const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
  const server = `node "${join(fixtureDir, "dummy-server.cjs")}"`;
  const idle = `node "${join(fixtureDir, "idle.cjs")}"`;

  it("reports a service that never starts listening as notReady", async () => {
    const [fe, be, px] = [
      (await findFreePort(7000))!,
      (await findFreePort(7100))!,
      (await findFreePort(7200))!,
    ];
    dir = mkdtempSync(join(tmpdir(), "devbridge-ready-"));
    writeFileSync(
      join(dir, "dev-bridge.config.json"),
      JSON.stringify({
        // frontend really listens; backend is idle and never binds its port.
        frontend: { command: server, port: fe, cwd: ".", host: "127.0.0.1" },
        backend: { command: idle, port: be, cwd: ".", host: "127.0.0.1" },
        proxy: { port: px, apiPrefix: "/api", host: "127.0.0.1" },
      }),
      "utf8",
    );

    handle = await startDevBridge({
      cwd: dir,
      quiet: true,
      waitForReady: true,
      readyTimeoutMs: 1500,
    });

    expect(handle.notReady).toContain("api");
    expect(handle.notReady).not.toContain("web");
  }, 10000);
});
