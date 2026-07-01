import { resolve } from "node:path";
import type { DevBridgeConfig } from "./config/schema.js";
import { loadConfig } from "./config/loadConfig.js";
import { ProcessManager } from "./process/processManager.js";
import { LogAggregator } from "./logs/logAggregator.js";
import { ProxyServer } from "./proxy/proxyServer.js";
import { attachDashboard, DASHBOARD_BASE_PATH, type DashboardHandle } from "./dashboard/server.js";
import { isPortFree, findFreePort, PortInUseError } from "./utils/portCheck.js";
import { checkEnvFiles, type EnvWarning } from "./utils/envGuard.js";

export interface StartOptions {
  cwd?: string;
  configPath?: string;
  /** Override the proxy port from config. */
  port?: number;
  /** Start the unified proxy (default true). `false` = merged logs only. */
  proxy?: boolean;
  /** Mount the live request dashboard (requires the proxy). */
  dashboard?: boolean;
  /** Fail if the proxy port is taken instead of auto-picking a free one. */
  strictPort?: boolean;
  /** Compare .env.example vs .env and report missing vars (default true). */
  checkEnv?: boolean;
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
  /** Stop the dashboard, proxy, and all child processes. Idempotent. */
  shutdown(): Promise<void>;
}

/**
 * Wire the whole pipeline together: load config -> (guard ports/env) -> spawn
 * processes -> merge logs -> start the unified proxy -> (optionally) mount the
 * dashboard. Returns a handle whose `shutdown()` tears it all down.
 */
export async function startDevBridge(options: StartOptions = {}): Promise<DevBridgeHandle> {
  const { config, baseDir } = loadConfig({ cwd: options.cwd, configPath: options.configPath });
  if (options.port !== undefined) config.proxy.port = options.port;
  const useProxy = options.proxy !== false;
  const useDashboard = useProxy && options.dashboard === true;

  // Port guard: auto-pick a free port unless strict mode is requested.
  let proxyPortReassignedFrom: number | undefined;
  if (useProxy && !(await isPortFree(config.proxy.port))) {
    if (options.strictPort) throw new PortInUseError(config.proxy.port);
    const free = await findFreePort(config.proxy.port + 1);
    if (free === null) throw new PortInUseError(config.proxy.port);
    proxyPortReassignedFrom = config.proxy.port;
    config.proxy.port = free;
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
  manager.start();

  let proxy: ProxyServer | undefined;
  let dashboard: DashboardHandle | undefined;
  if (useProxy) {
    proxy = new ProxyServer({
      proxyPort: config.proxy.port,
      apiPrefix: config.proxy.apiPrefix,
      frontendPort: config.frontend.port,
      backendPort: config.backend.port,
      reservedPrefix: useDashboard ? DASHBOARD_BASE_PATH : undefined,
    });
    try {
      const server = await proxy.listen();
      if (useDashboard) {
        dashboard = attachDashboard({ app: proxy.app, server, tracker: proxy.tracker });
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

  let stopped = false;
  const shutdown = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    await dashboard?.close();
    await proxy?.close();
    await manager.stopAll();
  };

  return { config, manager, proxy, dashboard, proxyPortReassignedFrom, envWarnings, shutdown };
}
