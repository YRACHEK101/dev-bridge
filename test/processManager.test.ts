import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { resolve } from "node:path";
import { execa } from "execa";
import { ProcessManager } from "../src/process/processManager.js";
import { spawnProcess } from "../src/process/spawnProcess.js";
import type { DevBridgeConfig } from "../src/config/schema.js";
import type { SpawnFn, Subprocess } from "../src/process/spawnProcess.js";

/** Controllable fake child process for deterministic unit tests. */
class FakeSubprocess extends EventEmitter implements Subprocess {
  pid: number | undefined = undefined; // undefined => stop() uses direct kill (safe in tests)
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn((signal?: NodeJS.Signals | number) => {
    // Simulate the OS delivering the signal and the process exiting.
    queueMicrotask(() => this.emit("exit", 0, (signal as NodeJS.Signals) ?? null));
    return true;
  });
  catch(): Promise<unknown> {
    return Promise.resolve();
  }
}

function makeConfig(overrides: Partial<DevBridgeConfig> = {}): DevBridgeConfig {
  return {
    frontend: { command: "npm run dev", port: 5173, cwd: "./client" },
    backend: { command: "npm run server", port: 5000, cwd: "./server" },
    proxy: { port: 4000, apiPrefix: "/api" },
    restartOnCrash: false,
    ...overrides,
  };
}

function fakeSpawner() {
  const created: FakeSubprocess[] = [];
  const calls: Array<{ command: string; cwd: string }> = [];
  const envs: NodeJS.ProcessEnv[] = [];
  const spawn: SpawnFn = (command, options) => {
    calls.push({ command, cwd: options.cwd });
    envs.push(options.env);
    const sp = new FakeSubprocess();
    created.push(sp);
    return sp;
  };
  return { spawn, created, calls, envs };
}

describe("ProcessManager", () => {
  it("spawns both services with the correct command and resolved cwd", () => {
    const { spawn, calls } = fakeSpawner();
    const baseDir = "/projects/app";
    const manager = new ProcessManager(makeConfig(), { baseDir, spawn });

    manager.start();

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ command: "npm run dev", cwd: resolve(baseDir, "./client") });
    expect(calls[1]).toEqual({ command: "npm run server", cwd: resolve(baseDir, "./server") });
  });

  it("relays stdout as info logs and stderr as error logs, tagged by source", async () => {
    const { spawn, created } = fakeSpawner();
    const manager = new ProcessManager(makeConfig(), { baseDir: "/app", spawn });

    const events: Array<{ source: string; level: string; line: string }> = [];
    manager.on("process:log", (e) => events.push(e));

    manager.start();
    const [web, api] = created;
    web!.stdout.write("frontend ready\n");
    api!.stderr.write("backend boom\n");

    // Let readline flush the lines.
    await vi.waitFor(() => expect(events).toHaveLength(2));

    expect(events).toContainEqual({ source: "web", level: "info", line: "frontend ready" });
    expect(events).toContainEqual({ source: "api", level: "error", line: "backend boom" });
  });

  it("stopAll() signals every process and resolves once they exit", async () => {
    const { spawn, created } = fakeSpawner();
    const manager = new ProcessManager(makeConfig(), { baseDir: "/app", spawn });

    const exits: string[] = [];
    manager.on("process:exit", (e) => exits.push(e.source));

    manager.start();
    await manager.stopAll();

    for (const sp of created) {
      expect(sp.kill).toHaveBeenCalledWith("SIGTERM");
    }
    expect(exits.sort()).toEqual(["api", "web"]);
    expect(manager.isShuttingDown).toBe(true);
  });

  it("injects PORT (the configured port) into each child's environment", () => {
    const { spawn, envs } = fakeSpawner();
    const manager = new ProcessManager(makeConfig(), { baseDir: "/app", spawn });
    manager.start();
    expect(envs[0]!.PORT).toBe("5173"); // frontend
    expect(envs[1]!.PORT).toBe("5000"); // backend
  });

  it("lets a service's own env override the injected PORT", () => {
    const { spawn, envs } = fakeSpawner();
    const config = makeConfig({
      frontend: { command: "npm run dev", port: 5173, cwd: ".", env: { PORT: "3000", API_KEY: "x" } },
    });
    const manager = new ProcessManager(config, { baseDir: "/app", spawn });
    manager.start();
    expect(envs[0]!.PORT).toBe("3000");
    expect(envs[0]!.API_KEY).toBe("x");
  });

  it("uses custom name labels when provided", () => {
    const { spawn } = fakeSpawner();
    const config = makeConfig({
      frontend: { command: "vite", port: 5173, cwd: ".", name: "ui" },
      backend: { command: "node server.js", port: 5000, cwd: ".", name: "srv" },
    });
    const manager = new ProcessManager(config, { baseDir: "/app", spawn });
    expect(manager.sources).toEqual(["ui", "srv"]);
  });
});

describe("ProcessManager auto-restart", () => {
  it("restarts a crashed process when restartOnCrash is enabled", async () => {
    const { spawn, created, calls } = fakeSpawner();
    const manager = new ProcessManager(makeConfig({ restartOnCrash: true }), {
      baseDir: "/app",
      spawn,
      restartDelayMs: 5,
    });
    const logs: Array<{ source: string; line: string }> = [];
    manager.on("process:log", (e) => logs.push(e));

    manager.start();
    expect(calls).toHaveLength(2);

    // Crash the frontend with a non-zero exit code.
    created[0]!.emit("exit", 1, null);

    await vi.waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2]).toEqual({ command: "npm run dev", cwd: resolve("/app", "./client") });
    expect(logs.some((l) => l.source === "web" && /restarting/.test(l.line))).toBe(true);
  });

  it("does NOT restart on a clean (code 0) exit", async () => {
    const { spawn, created, calls } = fakeSpawner();
    const manager = new ProcessManager(makeConfig({ restartOnCrash: true }), {
      baseDir: "/app",
      spawn,
      restartDelayMs: 5,
    });
    manager.start();
    created[0]!.emit("exit", 0, null);

    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toHaveLength(2); // no restart
  });

  it("does NOT restart when restartOnCrash is disabled", async () => {
    const { spawn, created, calls } = fakeSpawner();
    const manager = new ProcessManager(makeConfig({ restartOnCrash: false }), {
      baseDir: "/app",
      spawn,
      restartDelayMs: 5,
    });
    manager.start();
    created[0]!.emit("exit", 1, null);

    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toHaveLength(2);
  });

  it("resets the restart budget after a process has run healthy", () => {
    vi.useFakeTimers();
    try {
      const { spawn, created, calls } = fakeSpawner();
      const manager = new ProcessManager(makeConfig({ restartOnCrash: true }), {
        baseDir: "/app",
        spawn,
        restartDelayMs: 1,
        maxRestarts: 1, // only one rapid restart allowed...
        healthyResetMs: 10_000,
      });
      const logs: Array<{ line: string }> = [];
      manager.on("process:log", (e) => logs.push(e));

      manager.start();
      // Frontend runs healthy for 15s, then crashes -> budget resets, restarts.
      vi.advanceTimersByTime(15_000);
      created[0]!.emit("exit", 1, null);
      vi.advanceTimersByTime(5); // let the restart timer fire
      expect(calls).toHaveLength(3);

      // ...and again: healthy for 15s, crash -> resets again, restarts again.
      vi.advanceTimersByTime(15_000);
      created[2]!.emit("exit", 1, null);
      vi.advanceTimersByTime(5);
      expect(calls).toHaveLength(4);

      // Because each run was healthy, we never hit the "giving up" cap.
      expect(logs.some((l) => /giving up/.test(l.line))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up after maxRestarts and logs it", async () => {
    const { spawn, created, calls } = fakeSpawner();
    const manager = new ProcessManager(makeConfig({ restartOnCrash: true }), {
      baseDir: "/app",
      spawn,
      restartDelayMs: 2,
      maxRestarts: 1,
    });
    const logs: Array<{ source: string; line: string; level: string }> = [];
    manager.on("process:log", (e) => logs.push(e));

    manager.start();
    created[0]!.emit("exit", 1, null); // restart attempt 1 -> spawns created[2]
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    created[2]!.emit("exit", 1, null); // attempt 2 > maxRestarts -> give up

    await vi.waitFor(() => expect(logs.some((l) => /giving up/.test(l.line))).toBe(true));
    // No further spawn beyond the single allowed restart.
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(3);
  });
});

describe("spawnProcess (real execa integration)", () => {
  it("streams stdout/stderr lines and reports exit code from a real process", async () => {
    const handle = spawnProcess(
      {
        command: `node -e "console.log('hello'); console.error('oops')"`,
        cwd: process.cwd(),
      },
      // Use the real execa spawner (mirrors production default).
      (command, options) =>
        execa(command, {
          shell: true,
          cwd: options.cwd,
          env: options.env,
          stdout: "pipe",
          stderr: "pipe",
          reject: false,
        }) as never,
    );

    const logs: Array<{ level: string; line: string }> = [];
    handle.on("log", (e) => logs.push(e));

    const exit = await handle.exited;
    expect(exit.code).toBe(0);

    // readline may flush the final lines just after the exit event; wait for them.
    await vi.waitFor(() => expect(logs).toHaveLength(2));
    expect(logs).toContainEqual({ level: "info", line: "hello" });
    expect(logs).toContainEqual({ level: "error", line: "oops" });
  });
});
