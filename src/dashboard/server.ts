import type { Server, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import express, { type Express } from "express";
import { WebSocketServer, type WebSocket } from "ws";
import type { RequestTracker, RequestRecord } from "../proxy/requestTracker.js";
import { DASHBOARD_HTML } from "./ui.js";

export const DASHBOARD_BASE_PATH = "/_portbridge";

export interface DashboardOptions {
  app: Express;
  server: Server;
  tracker: RequestTracker;
  basePath?: string;
  /** How many recent requests to replay to a newly connected client. */
  backlogSize?: number;
}

export interface DashboardHandle {
  basePath: string;
  wss: WebSocketServer;
  /** Number of connected browser clients (for tests/diagnostics). */
  clientCount(): number;
  url(proxyPort: number): string;
  close(): Promise<void>;
}

/**
 * Mount the live dashboard onto an existing proxy server: it serves a static
 * page at `basePath` and streams every tracked request over a WebSocket at
 * `basePath/ws`. The proxy reserves `basePath` so these never get forwarded.
 */
export function attachDashboard(options: DashboardOptions): DashboardHandle {
  const basePath = (options.basePath ?? DASHBOARD_BASE_PATH).replace(/\/$/, "");
  const wsPath = basePath + "/ws";
  // In-memory ring buffer of recent requests, replayed to each new client so
  // they can scroll back beyond what happened while connected.
  const backlogSize = options.backlogSize ?? 1000;
  const backlog: RequestRecord[] = [];

  // --- Static page ---
  const router = express.Router();
  router.get("/", (_req, res) => {
    res.type("html").send(DASHBOARD_HTML);
  });
  options.app.use(basePath, router);

  // --- WebSocket stream ---
  const wss = new WebSocketServer({ noServer: true });

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (pathnameOf(req.url) !== wsPath) return; // not ours; leave for other listeners
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  };
  options.server.on("upgrade", onUpgrade);

  wss.on("connection", (ws: WebSocket) => {
    // Replay recent history so a dashboard opened mid-session isn't blank.
    ws.send(JSON.stringify({ type: "backlog", records: backlog }));
  });

  const onRequest = (record: RequestRecord) => {
    backlog.push(record);
    if (backlog.length > backlogSize) backlog.shift();
    const payload = JSON.stringify({ type: "request", record });
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  };
  options.tracker.on("request", onRequest);

  return {
    basePath,
    wss,
    clientCount: () => wss.clients.size,
    url: (proxyPort: number) => `http://localhost:${proxyPort}${basePath}`,
    close: () =>
      new Promise<void>((resolve) => {
        options.tracker.off("request", onRequest);
        options.server.off("upgrade", onUpgrade);
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      }),
  };
}

function pathnameOf(url: string | undefined): string {
  const raw = url ?? "/";
  const q = raw.indexOf("?");
  return q === -1 ? raw : raw.slice(0, q);
}
