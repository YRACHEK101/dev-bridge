import { createServer, connect } from "node:net";

export class PortInUseError extends Error {
  readonly port: number;
  constructor(port: number) {
    super(
      `Port ${port} is already in use.\n` +
        `Stop whatever is using it, or pass a different --port.`,
    );
    this.name = "PortInUseError";
    this.port = port;
  }
}

/**
 * Resolve true if nothing is listening on `port` (best-effort).
 *
 * Checks 127.0.0.1 by default: dev servers bind localhost, and testing the exact
 * host we care about avoids false "free" results from SO_REUSEADDR when probing
 * all interfaces on macOS/BSD.
 */
export function isPortFree(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = createServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => tester.close(() => resolve(true)));
    tester.listen(port, host);
  });
}

/** Throw {@link PortInUseError} if `port` is already taken. */
export async function assertPortFree(port: number, host?: string): Promise<void> {
  if (!(await isPortFree(port, host))) {
    throw new PortInUseError(port);
  }
}

export interface WaitForPortOptions {
  host?: string;
  timeoutMs?: number;
  intervalMs?: number;
}

/**
 * Poll until something is accepting TCP connections on `host:port`, or the
 * timeout elapses. Resolves true if it became reachable, false on timeout.
 */
export function waitForPort(port: number, options: WaitForPortOptions = {}): Promise<boolean> {
  const host = options.host ?? "127.0.0.1";
  const timeoutMs = options.timeoutMs ?? 30000;
  const intervalMs = options.intervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve) => {
    const attempt = () => {
      const socket = connect({ host, port });
      socket.setTimeout(Math.max(500, intervalMs));
      const retryOrFail = () => {
        socket.destroy();
        if (Date.now() >= deadline) resolve(false);
        else setTimeout(attempt, intervalMs);
      };
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", retryOrFail);
      socket.once("timeout", retryOrFail);
    };
    attempt();
  });
}

/**
 * Find the first free port at or after `start`. Returns null if none is free
 * within `attempts` tries. (Used by the Phase 2 port-conflict resolver.)
 */
export async function findFreePort(
  start: number,
  attempts = 20,
  host?: string,
): Promise<number | null> {
  for (let port = start; port < start + attempts && port <= 65535; port++) {
    if (await isPortFree(port, host)) return port;
  }
  return null;
}
