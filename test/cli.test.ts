import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildProgram } from "../src/cli.js";
import { openCommand } from "../src/utils/openBrowser.js";
import { readPackageVersion } from "../src/utils/version.js";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("buildProgram", () => {
  const program = buildProgram();
  const commands = Object.fromEntries(program.commands.map((c) => [c.name(), c]));

  it("exposes start and init commands under the dev-bridge program", () => {
    expect(Object.keys(commands).sort()).toEqual(["init", "start"]);
    expect(program.name()).toBe("dev-bridge");
  });

  it("wires the documented start flags", () => {
    const longs = commands.start!.options.map((o) => o.long);
    expect(longs).toEqual(
      expect.arrayContaining([
        "--config",
        "--port",
        "--host",
        "--no-proxy",
        "--dashboard",
        "--strict-port",
        "--no-env-check",
      ]),
    );
  });

  it("wires the init flags", () => {
    const longs = commands.init!.options.map((o) => o.long);
    expect(longs).toEqual(expect.arrayContaining(["--yes", "--force"]));
  });

  it("reports the package version", () => {
    expect(program.version()).toBe(readPackageVersion());
  });
});

describe("openCommand", () => {
  it("maps each platform to the right opener", () => {
    expect(openCommand("http://x", "darwin")).toEqual({ command: "open", args: ["http://x"] });
    expect(openCommand("http://x", "linux")).toEqual({ command: "xdg-open", args: ["http://x"] });
    expect(openCommand("http://x", "win32")).toEqual({
      command: "cmd",
      args: ["/c", "start", "", "http://x"],
    });
  });
});

describe("readPackageVersion", () => {
  it("matches the version in package.json", () => {
    const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as { version: string };
    expect(readPackageVersion()).toBe(pkg.version);
  });
});
