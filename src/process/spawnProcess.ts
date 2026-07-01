import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import { execa } from "execa";

export type LogLevel = "info" | "error";

/** Minimal view of a child process we depend on (keeps the module testable). */
export interface Subprocess {
  readonly pid?: number;
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  /** Present on execa's promise-like subprocess; used to swallow exit rejection. */
  catch?(onrejected: (reason: unknown) => unknown): Promise<unknown>;
}

export type SpawnFn = (
  command: string,
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => Subprocess;

export interface SpawnOptions {
  command: string;
  /** Absolute working directory. */
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

export interface ExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface LogEvent {
  level: LogLevel;
  line: string;
}

/** Default spawner: runs the command string in a shell via execa. */
const defaultSpawn: SpawnFn = (command, options) =>
  execa(command, {
    shell: true,
    cwd: options.cwd,
    env: options.env,
    stdout: "pipe",
    stderr: "pipe",
    // Don't throw on non-zero exit; we surface exit via the "exit" event.
    reject: false,
    // New process group on POSIX so we can signal the whole tree on stop().
    detached: process.platform !== "win32",
  }) as unknown as Subprocess;

/**
 * A single spawned dev server. Emits:
 *  - "log"  { level, line }   for each line of stdout ("info") / stderr ("error")
 *  - "exit" { code, signal }  once, when the process terminates
 */
export class ProcessHandle extends EventEmitter {
  readonly command: string;
  readonly cwd: string;
  private readonly subprocess: Subprocess;
  /** Resolves once the process has fully exited. */
  readonly exited: Promise<ExitInfo>;

  constructor(options: SpawnOptions, spawn: SpawnFn = defaultSpawn) {
    super();
    this.command = options.command;
    this.cwd = options.cwd;
    this.subprocess = spawn(options.command, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
    });

    this.streamLines(this.subprocess.stdout, "info");
    this.streamLines(this.subprocess.stderr, "error");

    this.exited = new Promise<ExitInfo>((resolve) => {
      this.subprocess.on("exit", (code, signal) => {
        const info: ExitInfo = { code, signal };
        this.emit("exit", info);
        resolve(info);
      });
    });

    // execa's subprocess is promise-like; swallow settlement so a non-zero
    // exit or a kill never becomes an unhandled rejection.
    this.subprocess.catch?.(() => {});
  }

  get pid(): number | undefined {
    return this.subprocess.pid;
  }

  private streamLines(stream: NodeJS.ReadableStream | null, level: LogLevel): void {
    if (!stream) return;
    const rl = createInterface({ input: stream });
    rl.on("line", (line) => this.emit("log", { level, line } satisfies LogEvent));
  }

  /**
   * Terminate the process. On POSIX we signal the whole process group so that
   * children spawned by the command (e.g. the actual dev server under `npm run`)
   * are also stopped; otherwise we fall back to signalling the process directly.
   */
  stop(signal: NodeJS.Signals = "SIGTERM"): void {
    const pid = this.subprocess.pid;
    try {
      if (process.platform !== "win32" && typeof pid === "number") {
        process.kill(-pid, signal);
      } else {
        this.subprocess.kill(signal);
      }
    } catch {
      // Group may not exist (already exited, or not a leader); best-effort direct kill.
      try {
        this.subprocess.kill(signal);
      } catch {
        /* already gone */
      }
    }
  }
}

/** Spawn a single process and return its handle. */
export function spawnProcess(options: SpawnOptions, spawn?: SpawnFn): ProcessHandle {
  return new ProcessHandle(options, spawn);
}
