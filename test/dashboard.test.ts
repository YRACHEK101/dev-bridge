import { describe, it, expect, afterEach, vi } from "vitest";
import WebSocket from "ws";
import { ProxyServer } from "../src/proxy/proxyServer.js";
import {
  attachDashboard,
  DASHBOARD_BASE_PATH,
  type DashboardHandle,
} from "../src/dashboard/server.js";
import { findFreePort } from "../src/utils/portCheck.js";
import type { RequestRecord } from "../src/proxy/requestTracker.js";

let proxy: ProxyServer | undefined;
let dash: DashboardHandle | undefined;

afterEach(async () => {
  await dash?.close();
  dash = undefined;
  await proxy?.close();
  proxy = undefined;
});

function record(overrides: Partial<RequestRecord> = {}): RequestRecord {
  return {
    id: 1,
    method: "GET",
    path: "/api/a",
    target: "backend",
    statusCode: 200,
    durationMs: 5,
    timestamp: new Date().toISOString(),
    aborted: false,
    ...overrides,
  };
}

async function startDashboard(startPort: number, backlogSize?: number): Promise<number> {
  const port = (await findFreePort(startPort))!;
  proxy = new ProxyServer({
    proxyPort: port,
    apiPrefix: "/api",
    frontendPort: 1,
    backendPort: 2,
    reservedPrefix: DASHBOARD_BASE_PATH,
  });
  const server = await proxy.listen();
  dash = attachDashboard({ app: proxy.app, server, tracker: proxy.tracker, backlogSize });
  return port;
}

describe("dashboard", () => {
  it("serves the dashboard HTML at the reserved base path (not proxied)", async () => {
    const port = await startDashboard(6500);
    const res = await fetch(`http://127.0.0.1:${port}${DASHBOARD_BASE_PATH}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("portbridge");
    expect(html).toContain("live request timeline");
  });

  it("replays backlog and streams live requests over the WebSocket", async () => {
    const port = await startDashboard(6600);

    // A request that happened before the client connected -> should be replayed.
    proxy!.tracker.emit("request", record({ id: 1, path: "/api/a", target: "backend" }));

    const ws = new WebSocket(`ws://127.0.0.1:${port}${DASHBOARD_BASE_PATH}/ws`);
    const messages: Array<{ type: string; record?: RequestRecord; records?: RequestRecord[] }> = [];
    ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });

    await vi.waitFor(() => expect(messages.some((m) => m.type === "backlog")).toBe(true));
    const backlog = messages.find((m) => m.type === "backlog")!;
    expect(backlog.records).toHaveLength(1);
    expect(backlog.records![0]).toMatchObject({ path: "/api/a", target: "backend" });

    // A new request after connecting -> should be pushed live.
    proxy!.tracker.emit("request", record({ id: 2, path: "/live", target: "frontend" }));
    await vi.waitFor(() => expect(messages.some((m) => m.type === "request")).toBe(true));
    expect(messages.find((m) => m.type === "request")!.record).toMatchObject({
      path: "/live",
      target: "frontend",
    });

    expect(dash!.clientCount()).toBe(1);
    ws.close();
  });

  it("caps the replay backlog (ring buffer drops oldest)", async () => {
    const port = await startDashboard(6700, 3); // keep only the last 3
    for (let i = 1; i <= 5; i++) {
      proxy!.tracker.emit("request", record({ id: i, path: `/r${i}` }));
    }

    const ws = new WebSocket(`ws://127.0.0.1:${port}${DASHBOARD_BASE_PATH}/ws`);
    const messages: Array<{ type: string; records?: RequestRecord[] }> = [];
    ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });

    await vi.waitFor(() => expect(messages.some((m) => m.type === "backlog")).toBe(true));
    const backlog = messages.find((m) => m.type === "backlog")!.records!;
    expect(backlog).toHaveLength(3);
    expect(backlog.map((r) => r.path)).toEqual(["/r3", "/r4", "/r5"]);
    ws.close();
  });
});
