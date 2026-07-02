import { readFileSync } from "node:fs";
import { join } from "node:path";

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface ServiceSuggestion {
  framework: string | null;
  command: string;
  port: number;
}

export interface StackSuggestion {
  frontend: ServiceSuggestion;
  backend: ServiceSuggestion;
}

function readPackageJson(dir: string): PackageJson | null {
  try {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as PackageJson;
  } catch {
    return null;
  }
}

function hasDep(pkg: PackageJson | null, name: string): boolean {
  if (!pkg) return false;
  return Boolean(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]);
}

/** `npm run <name>` if that script exists, else null. */
function scriptCommand(pkg: PackageJson | null, name: string): string | null {
  return pkg?.scripts?.[name] ? `npm run ${name}` : null;
}

function detectFrontend(pkg: PackageJson | null): ServiceSuggestion {
  if (hasDep(pkg, "next")) {
    return { framework: "Next.js", command: scriptCommand(pkg, "dev") ?? "next dev", port: 3000 };
  }
  if (hasDep(pkg, "vite")) {
    return { framework: "Vite", command: scriptCommand(pkg, "dev") ?? "vite", port: 5173 };
  }
  if (hasDep(pkg, "react-scripts")) {
    return {
      framework: "Create React App",
      command: scriptCommand(pkg, "start") ?? "react-scripts start",
      port: 3000,
    };
  }
  return { framework: null, command: scriptCommand(pkg, "dev") ?? "npm run dev", port: 5173 };
}

function detectBackend(pkg: PackageJson | null): ServiceSuggestion {
  const command =
    scriptCommand(pkg, "server") ?? scriptCommand(pkg, "start:server") ?? "npm run server";
  if (hasDep(pkg, "@nestjs/core")) return { framework: "NestJS", command, port: 5000 };
  if (hasDep(pkg, "fastify")) return { framework: "Fastify", command, port: 5000 };
  if (hasDep(pkg, "koa")) return { framework: "Koa", command, port: 5000 };
  if (hasDep(pkg, "express")) return { framework: "Express", command, port: 5000 };
  return { framework: null, command, port: 5000 };
}

/**
 * Best-effort guess of the frontend/backend commands and ports from the
 * project's package.json (checks cwd and common subdirs). Purely to pre-fill
 * `dev-bridge init` prompts — the user can override every value.
 */
export function detectStack(cwd: string): StackSuggestion {
  const root = readPackageJson(cwd);
  const frontendPkg =
    root ?? readPackageJson(join(cwd, "client")) ?? readPackageJson(join(cwd, "frontend"));
  const backendPkg =
    readPackageJson(join(cwd, "server")) ?? readPackageJson(join(cwd, "backend")) ?? root;

  return {
    frontend: detectFrontend(frontendPkg),
    backend: detectBackend(backendPkg),
  };
}
