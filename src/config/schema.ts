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
  /**
   * Host the proxy connects to for this server. Defaults to "localhost", which
   * (with Happy Eyeballs) reaches a server bound to either 127.0.0.1 or ::1.
   * Override to e.g. "127.0.0.1" or "::1" to force one stack.
   */
  host: z.string().min(1).default("localhost"),
  /** Extra environment variables for the spawned process. */
  env: z.record(z.string(), z.string()).optional(),
  /**
   * Optional health path (e.g. "/health"). When set, wait-for-ready polls this
   * URL for a response instead of just checking the TCP port.
   */
  readyPath: z.string().startsWith("/").optional(),
  /** Optional human label; falls back to "web"/"api" at the call site. */
  name: z.string().min(1).optional(),
});

export const proxySchema = z.object({
  /** The single unified port the developer points their browser at. */
  port: portSchema.default(4000),
  /** Requests whose path starts with this prefix are routed to the backend. */
  apiPrefix: z.string().startsWith("/", "apiPrefix must start with '/'").default("/api"),
  /**
   * Interface the proxy binds to. Defaults to 127.0.0.1 (localhost only) so the
   * app and dashboard are not exposed on the LAN. Set to "0.0.0.0" to allow
   * access from other devices.
   */
  host: z.string().min(1).default("127.0.0.1"),
});

/**
 * The full `portbridge.config.json` schema. `.strict()` rejects unknown top
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
export type PortBridgeConfig = z.infer<typeof configSchema>;
