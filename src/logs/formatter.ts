import defaultChalk, { type ChalkInstance } from "chalk";
import type { LogLevel } from "../process/spawnProcess.js";

export interface FormattableLine {
  source: string;
  level: LogLevel;
  line: string;
}

export interface FormatterOptions {
  /** Inject a Chalk instance (e.g. forced color in tests). */
  chalk?: ChalkInstance;
}

/** Colors assigned to sources in order of appearance. */
function palette(c: ChalkInstance): ChalkInstance[] {
  return [c.cyan, c.magenta, c.green, c.yellow, c.blue, c.white];
}

/** `HH:mm:ss` in local time, zero-padded. */
export function formatClock(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export type LineFormatter = (event: FormattableLine, timestamp?: Date) => string;

/**
 * Build a formatter that renders `[HH:mm:ss] [source] message`. Each source
 * gets a stable color (first = cyan, second = magenta, ...); error-level lines
 * render their message in red regardless of source.
 */
export function createFormatter(sources: string[], options: FormatterOptions = {}): LineFormatter {
  const c = options.chalk ?? defaultChalk;
  const colors = palette(c);
  const colorBySource = new Map<string, ChalkInstance>();
  sources.forEach((source, i) => {
    colorBySource.set(source, colors[i % colors.length] ?? c.white);
  });

  return (event, timestamp = new Date()): string => {
    const time = c.gray(`[${formatClock(timestamp)}]`);
    const sourceColor = colorBySource.get(event.source) ?? c.white;
    const label = sourceColor(`[${event.source}]`);
    const message = event.level === "error" ? c.red(event.line) : event.line;
    return `${time} ${label} ${message}`;
  };
}
