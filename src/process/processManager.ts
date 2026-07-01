import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import type { DevBridgeConfig, ServiceConfig } from "../config/schema.js";
import {
  ProcessHandle,
  spawnProcess,
  type ExitInfo,
  type LogEvent,
  type LogLevel,
  type SpawnFn,
} from "./spawnProcess.js";

/** Stable source label used in logs and events. */
export type ServiceSource = string;

export interface ProcessLogEvent {
  source: ServiceSource;
  level: LogLevel;
  line: string;
}

export interface ProcessExitEvent {
  source: ServiceSource;
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface ManagedService {
  source: ServiceSource;
  service: ServiceConfig;
  resolvedCwd: string;
  handle?: ProcessHandle;
}

export interface ProcessManagerOptions {
  /** Directory the config lives in; service `cwd` is resolved against it. */
  baseDir: string;
  /** Override the spawner (used in tests). */
  spawn?: SpawnFn;
}

/**
 * Starts and supervises the frontend and backend dev servers. Relays their
 * output as "process:log" and lifecycle as "process:exit", and shuts them all
 * down on stopAll().
 */
export class ProcessManager extends EventEmitter {
  private readonly services: ManagedService[];
  private readonly spawn?: SpawnFn;
  private shuttingDown = false;

  constructor(config: DevBridgeConfig, options: ProcessManagerOptions) {
    super();
    this.spawn = options.spawn;
    this.services = [
      {
        source: config.frontend.name ?? "web",
        service: config.frontend,
        resolvedCwd: resolve(options.baseDir, config.frontend.cwd),
      },
      {
        source: config.backend.name ?? "api",
        service: config.backend,
        resolvedCwd: resolve(options.baseDir, config.backend.cwd),
      },
    ];
  }

  /** Spawn all services. Safe to call once. */
  start(): void {
    for (const managed of this.services) {
      this.startService(managed);
    }
  }

  private startService(managed: ManagedService): void {
    const handle = spawnProcess(
      { command: managed.service.command, cwd: managed.resolvedCwd },
      this.spawn,
    );
    managed.handle = handle;

    handle.on("log", ({ level, line }: LogEvent) => {
      const event: ProcessLogEvent = { source: managed.source, level, line };
      this.emit("process:log", event);
    });

    handle.on("exit", ({ code, signal }: ExitInfo) => {
      const event: ProcessExitEvent = { source: managed.source, code, signal };
      this.emit("process:exit", event);
    });
  }

  /** All configured service source labels, in start order. */
  get sources(): ServiceSource[] {
    return this.services.map((s) => s.source);
  }

  /**
   * Gracefully stop every process (SIGTERM), escalating to SIGKILL for any that
   * do not exit within `graceMs`.
   */
  async stopAll(signal: NodeJS.Signals = "SIGTERM", graceMs = 5000): Promise<void> {
    this.shuttingDown = true;
    await Promise.all(
      this.services.map(async (managed) => {
        const handle = managed.handle;
        if (!handle) return;
        handle.stop(signal);
        await withTimeout(handle.exited, graceMs, () => handle.stop("SIGKILL"));
      }),
    );
  }

  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }
}

/** Await `promise`, but if it doesn't settle within `ms`, run `onTimeout` and keep waiting. */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => void,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolveTimeout) => {
    timer = setTimeout(() => {
      onTimeout();
      resolveTimeout();
    }, ms);
    // Don't keep the event loop alive just for this safety timer.
    timer.unref?.();
  });
  await Promise.race([promise.then(() => undefined), timeout]);
  if (timer) clearTimeout(timer);
  // Ensure the process is fully reaped even if the force-kill path fired.
  await promise.catch(() => undefined);
}
