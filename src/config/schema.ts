import { z } from "zod";

/** A TCP port number. */
const portSchema = z
  .number({ invalid_type_error: "port must be a number" })
  .int("port must be an integer")
  .min(1, "port must be >= 1")
  .max(65535, "port must be <= 65535");

/** One spawned dev server (frontend or backend). */
export const serviceSchema = z.object({
  /** Shell command that starts the server, e.g. "npm run dev". */
  command: z.string().min(1, "command is required"),
  /** Port the server itself listens on (the proxy forwards here). */
  port: portSchema,
  /** Working directory for the command, relative to the config file. */
  cwd: z.string().min(1).default("."),
  /** Optional human label; falls back to "web"/"api" at the call site. */
  name: z.string().min(1).optional(),
});

export const proxySchema = z.object({
  /** The single unified port the developer points their browser at. */
  port: portSchema.default(4000),
  /** Requests whose path starts with this prefix are routed to the backend. */
  apiPrefix: z
    .string()
    .startsWith("/", "apiPrefix must start with '/'")
    .default("/api"),
});

/**
 * The full `dev-bridge.config.json` schema. `.strict()` rejects unknown top
 * level keys so typos (e.g. "fronend") surface as clear errors instead of
 * being silently ignored.
 */
export const configSchema = z
  .object({
    frontend: serviceSchema,
    backend: serviceSchema,
    proxy: proxySchema.default({}),
    /** Restart a crashed process automatically. Off by default (Phase 2). */
    restartOnCrash: z.boolean().default(false),
  })
  .strict();

export type ServiceConfig = z.infer<typeof serviceSchema>;
export type ProxyConfig = z.infer<typeof proxySchema>;
export type DevBridgeConfig = z.infer<typeof configSchema>;
