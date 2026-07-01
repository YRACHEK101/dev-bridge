import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface EnvWarning {
  /** Directory checked. */
  dir: string;
  /** True if a `.env.example` exists but `.env` does not. */
  missingEnvFile: boolean;
  /** Keys present in `.env.example` but absent from `.env`. */
  missingKeys: string[];
}

/**
 * Compare `.env.example` against `.env` in each directory and report variables
 * that appear referenced but unset. Purely advisory — never throws.
 */
export function checkEnvFiles(dirs: string[]): EnvWarning[] {
  const warnings: EnvWarning[] = [];
  const seen = new Set<string>();

  for (const dir of dirs) {
    if (seen.has(dir)) continue;
    seen.add(dir);

    const examplePath = join(dir, ".env.example");
    if (!existsSync(examplePath)) continue;

    const exampleKeys = parseEnvKeys(examplePath);
    if (exampleKeys.length === 0) continue;

    const envPath = join(dir, ".env");
    if (!existsSync(envPath)) {
      warnings.push({ dir, missingEnvFile: true, missingKeys: exampleKeys });
      continue;
    }

    const envKeys = new Set(parseEnvKeys(envPath));
    const missingKeys = exampleKeys.filter((key) => !envKeys.has(key));
    if (missingKeys.length > 0) {
      warnings.push({ dir, missingEnvFile: false, missingKeys });
    }
  }

  return warnings;
}

/** Extract the KEY names from a dotenv-style file (ignores comments/blanks/values). */
function parseEnvKeys(path: string): string[] {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const keys: string[] = [];
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ") ? line.slice("export ".length) : line;
    const eq = withoutExport.indexOf("=");
    if (eq <= 0) continue;
    const key = withoutExport.slice(0, eq).trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) keys.push(key);
  }
  return keys;
}
