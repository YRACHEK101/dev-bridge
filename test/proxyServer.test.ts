import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import request from "supertest";
import { ProxyServer } from "../src/proxy/proxyServer.js";
import { isApiPath, type RequestRecord } from "../src/proxy/requestTracker.js";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

function startServer(handler: Handler): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

// Backend echoes what it received (method, url, body) so we can prove routing
// and that request bodies are streamed through untouched.
const backendHandler: Handler = (req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    res.writeHead(201, { "content-type": "application/json" });
    res.end(JSON.stringify({ from: "backend", method: req.method, url: req.url, body }));
  });
};

const frontendHandler: Handler = (_req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<html><body>frontend app</body></html>");
};

let backend: { server: Server; port: number };
let frontend: { server: Server; port: number };
let proxy: ProxyServer;

beforeAll(async () => {
  backend = await startServer(backendHandler);
  frontend = await startServer(frontendHandler);
  proxy = new ProxyServer({
    proxyPort: 0, // unused here; supertest wraps the app directly
    apiPrefix: "/api",
    frontendPort: frontend.port,
    backendPort: backend.port,
  });
});

afterAll(async () => {
  backend.server.close();
  frontend.server.close();
  await proxy.close();
});

describe("isApiPath", () => {
  it("matches on path-segment boundaries", () => {
    expect(isApiPath("/api", "/api")).toBe(true);
    expect(isApiPath("/api/users", "/api")).toBe(true);
    expect(isApiPath("/apiary", "/api")).toBe(false); // not a boundary
    expect(isApiPath("/", "/api")).toBe(false);
  });
});

describe("ProxyServer routing", () => {
  it("routes /api/* to the backend and records the request", async () => {
    const records: RequestRecord[] = [];
    proxy.tracker.on("request", (r: RequestRecord) => records.push(r));

    const res = await request(proxy.app).get("/api/users?q=1");

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ from: "backend", method: "GET", url: "/api/users?q=1" });

    await vi.waitFor(() => expect(records.length).toBeGreaterThan(0));
    const rec = records.at(-1)!;
    expect(rec).toMatchObject({
      method: "GET",
      path: "/api/users?q=1",
      target: "backend",
      statusCode: 201,
      aborted: false,
    });
    expect(typeof rec.durationMs).toBe("number");
    expect(rec.durationMs).toBeGreaterThanOrEqual(0);
    expect(rec.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("routes everything else to the frontend", async () => {
    const records: RequestRecord[] = [];
    proxy.tracker.on("request", (r: RequestRecord) => records.push(r));

    const res = await request(proxy.app).get("/dashboard");

    expect(res.status).toBe(200);
    expect(res.text).toContain("frontend app");

    await vi.waitFor(() => expect(records.length).toBeGreaterThan(0));
    expect(records.at(-1)).toMatchObject({
      path: "/dashboard",
      target: "frontend",
      statusCode: 200,
    });
  });

  it("streams the request body through to the backend (no body parsing)", async () => {
    const res = await request(proxy.app).post("/api/echo").send({ hello: "world" });

    expect(res.status).toBe(201);
    expect(res.body.method).toBe("POST");
    expect(res.body.body).toContain("hello");
  });
});
