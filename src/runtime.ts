import { resolve } from "node:path";
import chalk from "chalk";
import type { DevBridgeConfig } from "./config/schema.js";
import { loadConfigFile } from "./config/loadConfig.js";
import { ProcessManager } from "./process/processManager.js";
import { LogAggregator } from "./logs/logAggregator.js";
import { ProxyServer } from "./proxy/proxyServer.js";
import { attachDashboard, DASHBOARD_BASE_PATH, type DashboardHandle } from "./dashboard/server.js";
import { isPortFree, findFreePort, waitForPort, PortInUseError } from "./utils/portCheck.js";
import { checkEnvFiles, type EnvWarning } from "./utils/envGuard.js";
import type { ServiceConfig } from "./config/schema.js";

export interface StartOptions {
  cwd?: string;
  configPath?: string;
  /** Override the proxy port from config. */
  port?: number;
  /** Override the proxy bind host from config (e.g. "0.0.0.0" for LAN access). */
  host?: string;
  /** Start the unified proxy (default true). `false` = merged logs only. */
  proxy?: boolean;
  /** Mount the live request dashboard (requires the proxy). */
  dashboard?: boolean;
  /** Fail if the proxy port is taken instead of auto-picking a free one. */
  strictPort?: boolean;
  /** Compare .env.example vs .env and report missing vars (default true). */
  checkEnv?: boolean;
  /** Wait for each service to start listening before resolving (default false). */
  waitForReady?: boolean;
  /** Timeout for the wait-for-ready phase (default 30000ms). */
  readyTimeoutMs?: number;
  /** Emit [dev-bridge] diagnostic lines about the startup sequence. */
  verbose?: boolean;
  /** Suppress merged log output (used by tests). */
  quiet?: boolean;
}

export interface DevBridgeHandle {
  config: DevBridgeConfig;
  manager: ProcessManager;
  proxy?: ProxyServer;
  dashboard?: DashboardHandle;
  /** Set when the configured proxy port was busy and we picked another. */
  proxyPortReassignedFrom?: number;
  /** Advisory .env warnings (empty when checkEnv is false or none found). */
  envWarnings: EnvWarning[];
  /** Source labels of services that did not become ready in time (if waited). */
  notReady: string[];
  /** Stop the dashboard, proxy, and all child processes. Idempotent. */
  shutdown(): Promise<void>;
}

/** Wait for a single service to accept connections (or respond on readyPath). */
async function waitForService(service: ServiceConfig, timeoutMs: number): Promise<boolean> {
  const host = service.host;
  if (service.readyPath) {
    const url = `http://${host}:${service.port}${service.readyPath}`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        await fetch(url);
        return true;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    return false;
  }
  return waitForPort(service.port, { host, timeoutMs });
}

/**
 * Wire the whole pipeline together: load config -> (guard ports/env) -> spawn
 * processes -> merge logs -> start the unified proxy -> (optionally) mount the
 * dashboard. Returns a handle whose `shutdown()` tears it all down.
 */
export async function startDevBridge(options: StartOptions = {}): Promise<DevBridgeHandle> {
  const diag = (msg: string): void => {
    if (options.verbose && !options.quiet) {
      process.stdout.write(chalk.gray(`[dev-bridge] ${msg}\n`));
    }
  };

  const loaded = await loadConfigFile({ cwd: options.cwd, configPath: options.configPath });
  const { config, baseDir } = loaded;
  diag(`loaded config from ${loaded.configPath}`);
  if (options.port !== undefined) config.proxy.port = options.port;
  if (options.host !== undefined) config.proxy.host = options.host;
  const useProxy = options.proxy !== false;
  const useDashboard = useProxy && options.dashboard === true;

  // Port guard: auto-pick a free port unless strict mode is requested.
  const bindHost = config.proxy.host;
  let proxyPortReassignedFrom: number | undefined;
  if (useProxy && !(await isPortFree(config.proxy.port, bindHost))) {
    if (options.strictPort) throw new PortInUseError(config.proxy.port);
    const free = await findFreePort(config.proxy.port + 1, 20, bindHost);
    if (free === null) throw new PortInUseError(config.proxy.port);
    proxyPortReassignedFrom = config.proxy.port;
    config.proxy.port = free;
    diag(`proxy port in use; using ${free}`);
  }

  // Env guard: purely advisory.
  const envWarnings =
    options.checkEnv === false
      ? []
      : checkEnvFiles([
          baseDir,
          resolve(baseDir, config.frontend.cwd),
          resolve(baseDir, config.backend.cwd),
        ]);

  const manager = new ProcessManager(config, { baseDir });
  if (!options.quiet) {
    new LogAggregator(manager.sources).attach(manager);
  }
  diag(`spawning: ${config.frontend.command} | ${config.backend.command}`);
  manager.start();

  let proxy: ProxyServer | undefined;
  let dashboard: DashboardHandle | undefined;
  if (useProxy) {
    proxy = new ProxyServer({
      proxyPort: config.proxy.port,
      proxyHost: config.proxy.host,
      apiPrefix: config.proxy.apiPrefix,
      frontendPort: config.frontend.port,
      frontendHost: config.frontend.host,
      backendPort: config.backend.port,
      backendHost: config.backend.host,
      reservedPrefix: useDashboard ? DASHBOARD_BASE_PATH : undefined,
    });
    try {
      const server = await proxy.listen();
      diag(`proxy listening on ${config.proxy.host}:${config.proxy.port}`);
      if (useDashboard) {
        dashboard = attachDashboard({ app: proxy.app, server, tracker: proxy.tracker });
        diag("dashboard mounted at /_devbridge");
      }
    } catch (err) {
      // A crashing proxy must not leave orphaned dev servers behind.
      await manager.stopAll();
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
        throw new PortInUseError(config.proxy.port);
      }
      throw err;
    }
  }

  // Optionally wait for both services to start listening before we report ready.
  let notReady: string[] = [];
  if (options.waitForReady) {
    const timeoutMs = options.readyTimeoutMs ?? 30000;
    const services: Array<{ source: string; service: ServiceConfig }> = [
      { source: config.frontend.name ?? "web", service: config.frontend },
      { source: config.backend.name ?? "api", service: config.backend },
    ];
    diag(`waiting up to ${timeoutMs}ms for services to listen…`);
    const results = await Promise.all(
      services.map(async ({ source, service }) => {
        const ready = await waitForService(service, timeoutMs);
        diag(`${source} ${ready ? "ready" : "did not become ready"}`);
        return { source, ready };
      }),
    );
    notReady = results.filter((r) => !r.ready).map((r) => r.source);
  }

  let stopped = false;
  const shutdown = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    await dashboard?.close();
    await proxy?.close();
    await manager.stopAll();
  };

  return {
    config,
    manager,
    proxy,
    dashboard,
    proxyPortReassignedFrom,
    envWarnings,
    notReady,
    shutdown,
  };
}
