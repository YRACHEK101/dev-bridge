import { Command } from "commander";
import chalk from "chalk";
import { startPortBridge, type PortBridgeHandle } from "./runtime.js";
import { runInit } from "./config/init.js";
import { ConfigError } from "./config/loadConfig.js";
import { PortInUseError } from "./utils/portCheck.js";
import { readPackageVersion } from "./utils/version.js";
import { openBrowser } from "./utils/openBrowser.js";
import type { EnvWarning } from "./utils/envGuard.js";
import type { PortBridgeConfig } from "./config/schema.js";

function printBanner(config: PortBridgeConfig, useProxy: boolean, dashboardUrl?: string): void {
  const c = chalk;
  const lines: string[] = [
    "",
    c.bold.green("  portbridge") + c.gray("  ·  one port for your whole stack"),
    "",
  ];
  if (useProxy) {
    lines.push(
      `  ${c.bold("Open")}       ${c.cyan.underline(`http://localhost:${config.proxy.port}`)}`,
    );
  }
  if (dashboardUrl) {
    lines.push(`  ${c.bold("Dashboard")}  ${c.magenta.underline(dashboardUrl)}`);
  }
  lines.push(
    `  ${c.bold("Frontend")}   ${c.gray(config.frontend.command)}  ${c.gray(`→ :${config.frontend.port}`)}`,
  );
  lines.push(
    `  ${c.bold("Backend")}    ${c.gray(config.backend.command)}  ${c.gray(`→ :${config.backend.port}`)}  ${c.gray(`${config.proxy.apiPrefix}/*`)}`,
  );
  lines.push("", c.gray("  Press Ctrl+C to stop."), "");
  process.stdout.write(lines.join("\n") + "\n");
}

function printError(err: unknown): void {
  if (err instanceof ConfigError || err instanceof PortInUseError) {
    process.stderr.write(chalk.red(`\n${err.message}\n`));
  } else {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(chalk.red(`\nportbridge failed: ${message}\n`));
  }
}

function printEnvWarnings(warnings: EnvWarning[]): void {
  for (const w of warnings) {
    if (w.missingEnvFile) {
      process.stderr.write(
        chalk.yellow(
          `  ⚠ ${w.dir}: .env.example exists but .env is missing (${w.missingKeys.length} vars).\n`,
        ),
      );
    } else {
      process.stderr.write(
        chalk.yellow(
          `  ⚠ ${w.dir}: .env is missing ${w.missingKeys.length} var(s): ${w.missingKeys.join(", ")}\n`,
        ),
      );
    }
  }
}

interface StartCliOptions {
  config?: string;
  port?: string;
  host?: string;
  proxy?: boolean; // commander sets false when --no-proxy is passed
  dashboard?: boolean;
  strictPort?: boolean;
  envCheck?: boolean; // commander sets false when --no-env-check is passed
  wait?: boolean; // commander sets false when --no-wait is passed
  verbose?: boolean;
}

async function startAction(opts: StartCliOptions): Promise<void> {
  let port: number | undefined;
  if (opts.port !== undefined) {
    port = Number(opts.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      printError(new Error(`Invalid --port "${opts.port}" (must be an integer 1-65535).`));
      process.exitCode = 1;
      return;
    }
  }

  const useProxy = opts.proxy !== false;
  let wantDashboard = opts.dashboard === true;
  if (wantDashboard && !useProxy) {
    process.stderr.write(
      chalk.yellow("\nThe dashboard needs the proxy; ignoring --dashboard with --no-proxy.\n"),
    );
    wantDashboard = false;
  }

  let handle: PortBridgeHandle;
  try {
    handle = await startPortBridge({
      configPath: opts.config,
      port,
      host: opts.host,
      proxy: opts.proxy,
      dashboard: wantDashboard,
      strictPort: opts.strictPort,
      checkEnv: opts.envCheck,
      waitForReady: opts.wait !== false,
      verbose: opts.verbose,
    });
  } catch (err) {
    printError(err);
    process.exitCode = 1;
    return;
  }

  if (handle.proxyPortReassignedFrom !== undefined) {
    process.stderr.write(
      chalk.yellow(
        `\n  ⚠ Port ${handle.proxyPortReassignedFrom} was busy — using ${handle.config.proxy.port} instead.\n`,
      ),
    );
  }
  printEnvWarnings(handle.envWarnings);
  for (const source of handle.notReady) {
    process.stderr.write(
      chalk.red(`  ⚠ "${source}" did not start listening in time — its requests may fail.\n`),
    );
  }

  const dashboardUrl = handle.dashboard?.url(handle.config.proxy.port);
  printBanner(handle.config, handle.proxy !== undefined, dashboardUrl);
  // Auto-open the dashboard, unless disabled (CI/headless/scripted runs).
  if (dashboardUrl && !process.env.PORTBRIDGE_NO_OPEN) {
    void openBrowser(dashboardUrl);
  }

  installShutdown(() => handle.shutdown());
}

export interface ShutdownDeps {
  /** Signal source (default: process). */
  target?: NodeJS.EventEmitter;
  /** Exit function (default: process.exit). */
  exit?: (code: number) => void;
  out?: NodeJS.WritableStream;
}

/**
 * Wire SIGINT/SIGTERM to a graceful shutdown, then exit. Idempotent: repeated
 * signals during teardown are ignored. Dependencies are injectable for testing.
 */
export function installShutdown(shutdown: () => Promise<void>, deps: ShutdownDeps = {}): void {
  const target = deps.target ?? process;
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const out = deps.out ?? process.stdout;
  let shuttingDown = false;
  const onSignal = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    out.write(chalk.gray(`\nReceived ${signal}, shutting down...\n`));
    shutdown()
      .then(() => exit(0))
      .catch(() => exit(1));
  };
  target.on("SIGINT", () => onSignal("SIGINT"));
  target.on("SIGTERM", () => onSignal("SIGTERM"));
}

interface InitCliOptions {
  yes?: boolean;
  force?: boolean;
}

async function initAction(opts: InitCliOptions): Promise<void> {
  const result = await runInit({ yes: opts.yes, force: opts.force });
  if (result.written) {
    process.stdout.write(chalk.green(`Created ${result.configPath}\n`));
  } else {
    process.stdout.write(
      chalk.yellow(`Kept existing ${result.configPath} (use --force to overwrite)\n`),
    );
  }
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("portbridge")
    .description("Run your frontend + backend dev servers behind one unified port.")
    .version(readPackageVersion());

  program
    .command("start", { isDefault: true })
    .description("Start both dev servers behind the unified proxy")
    .option("-c, --config <path>", "path to portbridge.config.json")
    .option("-p, --port <number>", "unified proxy port (overrides config)")
    .option("-H, --host <host>", "interface to bind (default 127.0.0.1; use 0.0.0.0 for LAN)")
    .option("--no-proxy", "run servers with merged logs but without the proxy")
    .option("-d, --dashboard", "open a live request-timeline dashboard in the browser")
    .option("--strict-port", "fail if the proxy port is taken (default: auto-pick a free one)")
    .option("--no-env-check", "skip the .env.example vs .env check")
    .option("--no-wait", "don't wait for the servers to start listening before showing the banner")
    .option("-v, --verbose", "print [portbridge] diagnostics about the startup sequence")
    .action(startAction);

  program
    .command("init")
    .description("Scaffold a portbridge.config.json in the current directory")
    .option("-y, --yes", "write defaults without prompting")
    .option("-f, --force", "overwrite an existing config")
    .action(initAction);

  return program;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  await buildProgram().parseAsync(argv);
}
