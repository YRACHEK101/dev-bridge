import type { DevBridgeConfig } from "./config/schema.js";
import { loadConfig } from "./config/loadConfig.js";
import { ProcessManager } from "./process/processManager.js";
import { LogAggregator } from "./logs/logAggregator.js";
import { ProxyServer } from "./proxy/proxyServer.js";
import { attachDashboard, DASHBOARD_BASE_PATH, type DashboardHandle } from "./dashboard/server.js";
import { assertPortFree, PortInUseError } from "./utils/portCheck.js";

export interface StartOptions {
  cwd?: string;
  configPath?: string;
  /** Override the proxy port from config. */
  port?: number;
  /** Start the unified proxy (default true). `false` = merged logs only. */
  proxy?: boolean;
  /** Mount the live request dashboard (requires the proxy). */
  dashboard?: boolean;
  /** Suppress merged log output (used by tests). */
  quiet?: boolean;
}

export interface DevBridgeHandle {
  config: DevBridgeConfig;
  manager: ProcessManager;
  proxy?: ProxyServer;
  dashboard?: DashboardHandle;
  /** Stop the dashboard, proxy, and all child processes. Idempotent. */
  shutdown(): Promise<void>;
}

/**
 * Wire the whole pipeline together: load config -> spawn processes -> merge
 * logs -> start the unified proxy -> (optionally) mount the dashboard. Returns a
 * handle whose `shutdown()` tears it all down. This is the reusable core the CLI
 * (and tests) drive.
 */
export async function startDevBridge(options: StartOptions = {}): Promise<DevBridgeHandle> {
  const { config, baseDir } = loadConfig({ cwd: options.cwd, configPath: options.configPath });
  if (options.port !== undefined) config.proxy.port = options.port;
  const useProxy = options.proxy !== false;
  const useDashboard = useProxy && options.dashboard === true;

  // Fail fast with a clear message before we spawn anything.
  if (useProxy) {
    await assertPortFree(config.proxy.port);
  }

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

  return { config, manager, proxy, dashboard, shutdown };
}
