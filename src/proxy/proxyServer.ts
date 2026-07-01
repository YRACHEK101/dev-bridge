import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import express, { type Express } from "express";
import { createProxyMiddleware, type RequestHandler as ProxyHandler } from "http-proxy-middleware";
import { RequestTracker } from "./requestTracker.js";

export interface ProxyServerOptions {
  /** The unified port the developer points the browser at. */
  proxyPort: number;
  apiPrefix: string;
  frontendPort: number;
  backendPort: number;
  /** Upstream host; dev servers are local by default. */
  upstreamHost?: string;
  /** Reuse an existing tracker (so the dashboard/logs can subscribe first). */
  tracker?: RequestTracker;
}

/** For the frontend proxy we may need to forward WebSocket upgrades (HMR). */
type UpgradeCapable = ProxyHandler & {
  upgrade?: (req: import("node:http").IncomingMessage, socket: Duplex, head: Buffer) => void;
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
  private readonly frontendProxy: UpgradeCapable;
  private server?: Server;

  constructor(options: ProxyServerOptions) {
    this.proxyPort = options.proxyPort;
    this.tracker = options.tracker ?? new RequestTracker({ apiPrefix: options.apiPrefix });

    const host = options.upstreamHost ?? "127.0.0.1";
    const frontendTarget = `http://${host}:${options.frontendPort}`;
    const backendTarget = `http://${host}:${options.backendPort}`;

    const backendProxy = createProxyMiddleware({
      target: backendTarget,
      changeOrigin: true,
    });
    this.frontendProxy = createProxyMiddleware({
      target: frontendTarget,
      changeOrigin: true,
      ws: true, // forward HMR / websocket upgrades to the frontend
    }) as UpgradeCapable;

    this.app = express();
    // Measure first, then route. No body parser: we must stream bodies untouched.
    this.app.use(this.tracker.middleware());
    this.app.use((req, res, next) => {
      if (this.tracker.targetFor(req.path) === "backend") {
        return backendProxy(req, res, next);
      }
      return this.frontendProxy(req, res, next);
    });
  }

  /** Start listening. Resolves once bound; rejects on bind error (e.g. EADDRINUSE). */
  listen(): Promise<Server> {
    return new Promise((resolve, reject) => {
      const server = this.app.listen(this.proxyPort);
      const onError = (err: Error) => {
        server.removeListener("listening", onListening);
        reject(err);
      };
      const onListening = () => {
        server.removeListener("error", onError);
        // Forward WebSocket upgrades (Vite/Next HMR) to the frontend dev server.
        if (typeof this.frontendProxy.upgrade === "function") {
          server.on("upgrade", this.frontendProxy.upgrade);
        }
        this.server = server;
        resolve(server);
      };
      server.once("error", onError);
      server.once("listening", onListening);
    });
  }

  /** Stop listening and free the port. */
  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      this.server = undefined;
    });
  }

  /** The unified URL a developer opens. */
  get url(): string {
    return `http://localhost:${this.proxyPort}`;
  }
}

export function createProxyServer(options: ProxyServerOptions): ProxyServer {
  return new ProxyServer(options);
}
