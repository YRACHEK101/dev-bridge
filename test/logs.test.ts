import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { Chalk } from "chalk";
import { createFormatter } from "../src/logs/formatter.js";
import { LogAggregator } from "../src/logs/logAggregator.js";

// Force color ON so we can assert the exact styling deterministically,
// regardless of whether the test runner has a TTY.
const color = new Chalk({ level: 1 });
const noColor = new Chalk({ level: 0 });
const fixed = new Date(2020, 0, 1, 9, 5, 3); // 09:05:03 local

describe("createFormatter", () => {
  const format = createFormatter(["web", "api"], { chalk: color });

  it("prefixes timestamp and source, colored per source", () => {
    const out = format({ source: "web", level: "info", line: "ready on 5173" }, fixed);
    expect(out).toContain(color.gray("[09:05:03]"));
    expect(out).toContain(color.cyan("[web]")); // first source => cyan
    expect(out).toContain("ready on 5173");
  });

  it("colors the second source magenta", () => {
    const out = format({ source: "api", level: "info", line: "listening" }, fixed);
    expect(out).toContain(color.magenta("[api]"));
  });

  it("styles error-level messages red regardless of source", () => {
    const webErr = format({ source: "web", level: "error", line: "boom" }, fixed);
    const apiErr = format({ source: "api", level: "error", line: "kaboom" }, fixed);
    expect(webErr).toContain(color.red("boom"));
    expect(apiErr).toContain(color.red("kaboom"));
    // Label keeps its source color even on error lines.
    expect(webErr).toContain(color.cyan("[web]"));
    expect(apiErr).toContain(color.magenta("[api]"));
  });

  it("matches the [HH:mm:ss] [source] message shape (plain)", () => {
    const plain = createFormatter(["web", "api"], { chalk: noColor });
    const out = plain({ source: "web", level: "info", line: "hello" }, fixed);
    expect(out).toBe("[09:05:03] [web] hello");
    expect(out).toMatch(/^\[\d{2}:\d{2}:\d{2}\] \[web\] hello$/);
  });
});

describe("LogAggregator", () => {
  function capture() {
    const chunks: string[] = [];
    const out = new (class {
      write(s: string) {
        chunks.push(s);
        return true;
      }
    })() as unknown as NodeJS.WritableStream;
    return { chunks, out };
  }

  it("writes formatted lines for each process:log event, in arrival order", () => {
    const { chunks, out } = capture();
    const emitter = new EventEmitter();
    new LogAggregator(["web", "api"], { out, chalk: noColor }).attach(emitter);

    emitter.emit("process:log", { source: "web", level: "info", line: "first" });
    emitter.emit("process:log", { source: "api", level: "info", line: "second" });

    // Two lines, in arrival order, correctly labelled.
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatch(/^\[\d{2}:\d{2}:\d{2}\] \[web\] first\n$/);
    expect(chunks[1]).toMatch(/^\[\d{2}:\d{2}:\d{2}\] \[api\] second\n$/);
  });

  it("renders a process:exit event, red when the code is non-zero", () => {
    const { chunks, out } = capture();
    const emitter = new EventEmitter();
    new LogAggregator(["web", "api"], { out, chalk: color }).attach(emitter);

    emitter.emit("process:exit", { source: "api", code: 1, signal: null });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain(color.red("process exited with code 1"));
    expect(chunks[0]).toContain(color.magenta("[api]"));
  });
});
