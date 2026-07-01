import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Read the package version from package.json at runtime. The relative location
 * differs between the bundled CLI (dist/cli.js -> ../package.json) and running
 * from source under tests (src/utils -> ../../package.json), so we try both.
 */
export function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const rel of ["../package.json", "../../package.json"]) {
    try {
      const pkg = JSON.parse(readFileSync(join(here, rel), "utf8")) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      /* try the next candidate */
    }
  }
  return "0.0.0";
}
