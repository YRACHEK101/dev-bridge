import { setDefaultAutoSelectFamily } from "node:net";
import type { Server, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import express, { type Express } from "express";
import { createProxyMiddleware, type RequestHandler as ProxyHandler } from "http-proxy-middleware";
import { RequestTracker } from "./requestTracker.js";

// Reach dev servers bound to either IPv4 (127.0.0.1) or IPv6 (::1) when the
// target host is "localhost". Default on Node 20+, but set explicitly to be safe.
setDefaultAutoSelectFamily?.(true);

export interface ProxyServerOptions {
  /** The unified port the developer points the browser at. */
  proxyPort: number;
  apiPrefix: string;
  frontendPort: number;
  backendPort: number;
  /** Host the proxy connects to for the frontend/backend (default "localhost"). */
  frontendHost?: string;
  backendHost?: string;
  /** Interface the proxy binds to (default "127.0.0.1"). */
  proxyHost?: string;
  /** Reuse an existing tracker (so the dashboard/logs can subscribe first). */
  tracker?: RequestTracker;
  /**
   * A path prefix that must NOT be proxied (served by the dashboard instead).
   * When set, requests/upgrades under it fall through for another handler.
   */
  reservedPrefix?: string;
}

/** For the frontend proxy we may need to forward WebSocket upgrades (HMR). */
type UpgradeCapable = ProxyHandler & {
  upgrade?: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
};

/**
 * A single HTTP server that fronts both dev servers: requests under `apiPrefix`
 * go to the backend, everything else to the frontend. Because the browser only
 * ever talks to this one origin, the user's app needs no CORS configuration.
 */
export class ProxyServer {
  readonly app: Express;
  readonly tracker: RequestTracker;
  readonly proxyPort: number;
  private readonly proxyHost: string;
  private readonly reservedPrefix?: string;
  private readonly frontendProxy: UpgradeCapable;
  private httpServer?: Server;

  constructor(options: ProxyServerOptions) {
    this.proxyPort = options.proxyPort;
    this.proxyHost = options.proxyHost ?? "127.0.0.1";
    this.reservedPrefix = options.reservedPrefix;
    this.tracker = options.tracker ?? new RequestTracker({ apiPrefix: options.apiPrefix });

    const frontendTarget = `http://${options.frontendHost ?? "localhost"}:${options.frontendPort}`;
    const backendTarget = `http://${options.backendHost ?? "localhost"}:${options.backendPort}`;

    const backendProxy = createProxyMiddleware({
      target: backendTarget,
      changeOrigin: true,
    });
    this.frontendProxy = createProxyMiddleware({
      target: frontendTarget,
      changeOrigin: true,
      ws: true, // forward HMR / websocket upgrades to the frontend
      // Never proxy the reserved dashboard path. Without this, hpm's WS
      // auto-subscription would hijack the dashboard's own /_devbridge/ws
      // upgrade and pipe it to the (non-WS) frontend server.
      pathFilter: (pathname: string) => !this.isReserved(pathname),
    }) as UpgradeCapable;

    const track = this.tracker.middleware();

    this.app = express();
    // Measure first, then route. Reserved paths (dashboard) are neither tracked
    // nor proxied — they fall through to routes registered later.
    this.app.use((req, res, next) =>
      this.isReserved(req.path) ? next() : track(req, res, next),
    );
    this.app.use((req, res, next) => {
      if (this.isReserved(req.path)) return next();
      if (this.tracker.targetFor(req.path) === "backend") {
        return backendProxy(req, res, next);
      }
      return this.frontendProxy(req, res, next);
    });
  }

  private isReserved(path: string): boolean {
    const prefix = this.reservedPrefix;
    return !!prefix && (path === prefix || path.startsWith(prefix + "/"));
  }

  /** The underlying http.Server, available after listen(). */
  get server(): Server | undefined {
    return this.httpServer;
  }

  /** Start listening. Resolves once bound; rejects on bind error (e.g. EADDRINUSE). */
  listen(): Promise<Server> {
    return new Promise((resolve, reject) => {
      const server = this.app.listen(this.proxyPort, this.proxyHost);
      const onError = (err: Error) => {
        server.removeListener("listening", onListening);
        reject(err);
      };
      const onListening = () => {
        server.removeListener("error", onError);
        server.on("upgrade", (req, socket, head) => {
          // Reserved (dashboard) upgrades are handled by another listener.
          if (this.isReserved(pathnameOf(req.url))) return;
          this.frontendProxy.upgrade?.(req, socket, head);
        });
        this.httpServer = server;
        resolve(server);
      };
      server.once("error", onError);
      server.once("listening", onListening);
    });
  }

  /** Stop listening and free the port. */
  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.httpServer) return resolve();
      this.httpServer.close(() => resolve());
      this.httpServer = undefined;
    });
  }

  /** The unified URL a developer opens. */
  get url(): string {
    return `http://localhost:${this.proxyPort}`;
  }
}

/** Path portion of a request URL, without the query string. */
function pathnameOf(url: string | undefined): string {
  const raw = url ?? "/";
  const q = raw.indexOf("?");
  return q === -1 ? raw : raw.slice(0, q);
}

export function createProxyServer(options: ProxyServerOptions): ProxyServer {
  return new ProxyServer(options);
}
