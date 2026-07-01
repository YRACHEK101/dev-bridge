import type { DevBridgeConfig } from "./config/schema.js";
import { loadConfig } from "./config/loadConfig.js";
import { ProcessManager } from "./process/processManager.js";
import { LogAggregator } from "./logs/logAggregator.js";
import { ProxyServer } from "./proxy/proxyServer.js";
import { assertPortFree, PortInUseError } from "./utils/portCheck.js";

export interface StartOptions {
  cwd?: string;
  configPath?: string;
  /** Override the proxy port from config. */
  port?: number;
  /** Start the unified proxy (default true). `false` = merged logs only. */
  proxy?: boolean;
  /** Suppress merged log output (used by tests). */
  quiet?: boolean;
}

export interface DevBridgeHandle {
  config: DevBridgeConfig;
  manager: ProcessManager;
  proxy?: ProxyServer;
  /** Stop the proxy and all child processes. Idempotent. */
  shutdown(): Promise<void>;
}

/**
 * Wire the whole pipeline together: load config -> spawn processes -> merge
 * logs -> start the unified proxy. Returns a handle whose `shutdown()` tears it
 * all down. This is the reusable core the CLI (and tests) drive.
 */
export async function startDevBridge(options: StartOptions = {}): Promise<DevBridgeHandle> {
  const { config, baseDir } = loadConfig({ cwd: options.cwd, configPath: options.configPath });
  if (options.port !== undefined) config.proxy.port = options.port;
  const useProxy = options.proxy !== false;

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
  if (useProxy) {
    proxy = new ProxyServer({
      proxyPort: config.proxy.port,
      apiPrefix: config.proxy.apiPrefix,
      frontendPort: config.frontend.port,
      backendPort: config.backend.port,
    });
    try {
      await proxy.listen();
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
    await proxy?.close();
    await manager.stopAll();
  };

  return { config, manager, proxy, shutdown };
}
