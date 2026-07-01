import type { EventEmitter } from "node:events";
import type { ChalkInstance } from "chalk";
import { createFormatter, type LineFormatter } from "./formatter.js";
import type { ProcessLogEvent, ProcessExitEvent } from "../process/processManager.js";

export interface LogAggregatorOptions {
  /** Where merged output goes. Defaults to process.stdout. */
  out?: NodeJS.WritableStream;
  chalk?: ChalkInstance;
}

/**
 * Merges the log/exit streams of every managed process into a single, prefixed,
 * color-coded terminal stream, in the order events arrive (real chronological
 * order, since we subscribe to live events).
 */
export class LogAggregator {
  private readonly format: LineFormatter;
  private readonly out: NodeJS.WritableStream;

  constructor(sources: string[], options: LogAggregatorOptions = {}) {
    this.format = createFormatter(sources, { chalk: options.chalk });
    this.out = options.out ?? process.stdout;
  }

  /** Subscribe to a ProcessManager's "process:log" / "process:exit" events. */
  attach(emitter: EventEmitter): void {
    emitter.on("process:log", (event: ProcessLogEvent) => {
      this.write(event);
    });
    emitter.on("process:exit", (event: ProcessExitEvent) => {
      this.write({
        source: event.source,
        level: event.code ? "error" : "info",
        line: describeExit(event),
      });
    });
  }

  private write(event: ProcessLogEvent): void {
    this.out.write(this.format(event) + "\n");
  }
}

function describeExit(event: ProcessExitEvent): string {
  if (event.signal) return `process exited (${event.signal})`;
  if (event.code === 0 || event.code === null) return "process exited";
  return `process exited with code ${event.code}`;
}
