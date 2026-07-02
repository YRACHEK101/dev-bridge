import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { findFreePort, isPortFree } from "../src/utils/portCheck.js";
import { startPortBridge, type PortBridgeHandle } from "../src/runtime.js";
import type { RequestRecord } from "../src/proxy/requestTracker.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A real fixture script (not an inline `node -e` string) so the spawned command
// has no shell-quoting and behaves identically on macOS/Linux/Windows. The
// server reads PORT (injected by portbridge) and DUMMY_KIND (per-service env).
const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const dummyServer = join(fixtureDir, "dummy-server.cjs");
const serverCommand = () => `node "${dummyServer}"`;

/** Poll a URL until it responds (dev server finished booting). */
async function waitForOk(url: string, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status) return;
    } catch {
      /* not up yet */
    }
    await delay(150);
  }
  throw new Error(`server never became ready: ${url}`);
}

let handle: PortBridgeHandle | undefined;
let dir: string | undefined;

afterEach(async () => {
  await handle?.shutdown();
  handle = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("end-to-end", () => {
  it("spawns both servers and routes through the unified proxy, then shuts down cleanly", async () => {
    const frontendPort = await findFreePort(6100);
    const backendPort = await findFreePort((frontendPort ?? 6100) + 1);
    const proxyPort = await findFreePort((backendPort ?? 6200) + 1);
    expect(frontendPort && backendPort && proxyPort).toBeTruthy();

    dir = mkdtempSync(join(tmpdir(), "portbridge-e2e-"));
    const config = {
      frontend: {
        command: serverCommand(),
        port: frontendPort,
        cwd: ".",
        host: "127.0.0.1",
        env: { DUMMY_KIND: "frontend" },
      },
      backend: {
        command: serverCommand(),
        port: backendPort,
        cwd: ".",
        host: "127.0.0.1",
        env: { DUMMY_KIND: "backend" },
      },
      proxy: { port: proxyPort, apiPrefix: "/api", host: "127.0.0.1" },
    };
    writeFileSync(join(dir, "portbridge.config.json"), JSON.stringify(config), "utf8");

    handle = await startPortBridge({ cwd: dir, quiet: true });

    const records: RequestRecord[] = [];
    handle.proxy!.tracker.on("request", (r: RequestRecord) => records.push(r));

    // Wait for both real child dev servers to finish booting.
    await waitForOk(`http://127.0.0.1:${frontendPort}/`);
    await waitForOk(`http://127.0.0.1:${backendPort}/api/ping`);

    // /api/* -> backend
    const apiRes = await fetch(`http://127.0.0.1:${proxyPort}/api/ping`);
    expect(apiRes.status).toBe(200);
    expect(await apiRes.json()).toMatchObject({ from: "backend", url: "/api/ping" });

    // everything else -> frontend
    const webRes = await fetch(`http://127.0.0.1:${proxyPort}/some/page`);
    expect(webRes.status).toBe(200);
    expect(await webRes.text()).toContain("frontend app");

    // The tracker saw both, correctly classified.
    await vi.waitFor(() => expect(records.length).toBeGreaterThanOrEqual(2));
    expect(records.some((r) => r.path === "/api/ping" && r.target === "backend")).toBe(true);
    expect(records.some((r) => r.path === "/some/page" && r.target === "frontend")).toBe(true);

    // Graceful shutdown frees the proxy port and kills the child servers.
    await handle.shutdown();
    handle = undefined;
    await vi.waitFor(async () => {
      expect(await isPortFree(proxyPort!)).toBe(true);
      expect(await isPortFree(frontendPort!, "127.0.0.1")).toBe(true);
      expect(await isPortFree(backendPort!, "127.0.0.1")).toBe(true);
    });
  });
});
