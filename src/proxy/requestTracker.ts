import { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";
import type { Request, Response, NextFunction, RequestHandler } from "express";

export type ProxyTarget = "frontend" | "backend";

/** One proxied request, emitted as a "request" event once the response ends. */
export interface RequestRecord {
  /** Monotonic id, unique within this process. */
  id: number;
  method: string;
  /** Full request path including query string. */
  path: string;
  target: ProxyTarget;
  statusCode: number;
  durationMs: number;
  /** ISO timestamp of when the request started. */
  timestamp: string;
  /** True if the client aborted before the response finished. */
  aborted: boolean;
}

export interface RequestTrackerOptions {
  /** Requests whose path is under this prefix are routed to the backend. */
  apiPrefix: string;
}

/**
 * Records timing/metadata for every proxied request and emits it as a "request"
 * event. Consumed by the log line (optional) and the dashboard (Phase 2).
 */
export class RequestTracker extends EventEmitter {
  private readonly apiPrefix: string;
  private seq = 0;

  constructor(options: RequestTrackerOptions) {
    super();
    this.apiPrefix = options.apiPrefix;
  }

  /** Which upstream a given request path routes to. */
  targetFor(path: string): ProxyTarget {
    return isApiPath(path, this.apiPrefix) ? "backend" : "frontend";
  }

  /** Express middleware that measures each request and emits the record once. */
  middleware(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
      const startedAt = new Date().toISOString();
      const start = performance.now();
      const target = this.targetFor(req.path);

      let recorded = false;
      const finalize = (aborted: boolean) => {
        if (recorded) return;
        recorded = true;
        const record: RequestRecord = {
          id: ++this.seq,
          method: req.method,
          path: req.originalUrl,
          target,
          statusCode: res.statusCode,
          durationMs: Math.round((performance.now() - start) * 100) / 100,
          timestamp: startedAt,
          aborted,
        };
        this.emit("request", record);
      };

      // "finish": response fully sent. "close": connection closed; if it wasn't
      // finished, the client aborted.
      res.on("finish", () => finalize(false));
      res.on("close", () => finalize(!res.writableFinished));

      next();
    };
  }
}

/** Prefix match on path segments: "/api" matches "/api" and "/api/x", not "/apiary". */
export function isApiPath(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : prefix + "/");
}
