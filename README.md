# dev-bridge

**One command to run your frontend + backend dev servers behind a single port.**
No CORS setup, merged logs, and a live request dashboard.

Running a separate frontend (Next.js / Vite / CRA) and backend (Express / any
Node server) locally means scattered ports, manual CORS config, logs split
across terminals, and no visibility into requests crossing the front↔back
boundary. `dev-bridge` fixes that:

- 🔗 **One unified port.** The browser only ever talks to `:4000`. Requests to
  `/api/*` are proxied to your backend, everything else to your frontend — so
  your app needs **zero CORS configuration**.
- 📜 **Merged logs.** Both servers' output, interleaved in one terminal, each
  line timestamped, prefixed, and color-coded (`[web]` / `[api]`).
- 📊 **Live dashboard** (`--dashboard`). A real-time timeline of every request:
  method, path, target, status, and duration.
- ♻️ **Robust process control.** Graceful `Ctrl+C` shutdown, optional
  auto-restart on crash, and clear errors when a port is taken.

Framework-agnostic: if it starts with a command and listens on a port, it works.

---

## Install

```bash
npm install -g dev-bridge
# or run without installing:
npx dev-bridge
```

Requires **Node.js ≥ 20**.

## Quick start

From your project root:

```bash
dev-bridge init      # interactively scaffold dev-bridge.config.json
dev-bridge           # start both servers behind the unified proxy
```

Then open the printed **unified URL** (default http://localhost:4000).

Want the request dashboard too?

```bash
dev-bridge --dashboard
```

## Configuration

`dev-bridge` reads `dev-bridge.config.json` from the current directory (or
`--config <path>`):

```json
{
  "frontend": { "command": "npm run dev", "port": 5173, "cwd": "./client" },
  "backend": { "command": "npm run server", "port": 5000, "cwd": "./server" },
  "proxy": { "port": 4000, "apiPrefix": "/api" },
  "restartOnCrash": false
}
```

| Field                             | Meaning                                                             |
| --------------------------------- | ------------------------------------------------------------------- |
| `frontend` / `backend` `.command` | shell command that starts the server                                |
| `frontend` / `backend` `.port`    | the port that server listens on (proxy forwards here)               |
| `frontend` / `backend` `.cwd`     | working directory for the command (relative to the config)          |
| `frontend` / `backend` `.host`    | host the proxy connects to (default `localhost`; reaches IPv4/IPv6) |
| `frontend` / `backend` `.env`     | extra environment variables for that process (object)               |
| `frontend` / `backend` `.name`    | optional log label (defaults: `web` / `api`)                        |
| `proxy.port`                      | the single unified port you open in the browser                     |
| `proxy.host`                      | interface the proxy binds to (default `127.0.0.1`)                  |
| `proxy.apiPrefix`                 | requests under this path go to the backend (default `/api`)         |
| `restartOnCrash`                  | auto-restart a server if it exits non-zero (default `false`)        |

> **`PORT` is injected.** dev-bridge sets `PORT=<the configured port>` in each
> server's environment, so servers that read `process.env.PORT` bind the right
> port automatically. Otherwise, make the server listen on the `port` you
> configure (e.g. Vite's `server.port`). A per-service `env` value wins over the
> injected `PORT`.

## CLI

```
dev-bridge [start] [options]     # "start" is the default command
dev-bridge init [options]

Start options:
  -c, --config <path>   path to dev-bridge.config.json
  -p, --port <number>   unified proxy port (overrides config)
  -H, --host <host>     interface to bind (default 127.0.0.1; use 0.0.0.0 for LAN)
  -d, --dashboard       open a live request-timeline dashboard
      --no-proxy        run servers + merged logs without the proxy
      --strict-port     fail if the proxy port is taken (default: auto-pick free)
      --no-env-check    skip the .env.example vs .env check
  -V, --version
  -h, --help

Init options:
  -y, --yes             write defaults without prompting
  -f, --force           overwrite an existing config

Env:
  DEV_BRIDGE_NO_OPEN=1  don't auto-open the dashboard browser (CI/headless)
```

## How routing works

```
browser ──▶ http://localhost:4000   (the only origin your app knows)
                 │
                 ├─ /api/*     ──▶  backend   (http://127.0.0.1:5000)
                 └─ everything ──▶  frontend  (http://127.0.0.1:5173)
```

Because the browser talks to a single origin, there are no cross-origin
requests — no CORS headers to configure. WebSocket upgrades (e.g. Vite/Next HMR)
are forwarded to the frontend automatically.

## Try the example

A runnable, dependency-free demo lives in [`example/`](./example) — a tiny todo
app. From that folder:

```bash
node ../bin/dev-bridge.js --dashboard   # or `npx dev-bridge --dashboard`
```

…then open http://localhost:4000 and http://localhost:4000/_devbridge.

## Notes

- **ESM-only.** This is a modern Node ≥20 CLI; two core dependencies (`execa`,
  `chalk`) are pure ESM, so there is no CommonJS build.
- The dashboard is served at `/_devbridge` on the unified port; that path is
  reserved (never proxied to your app).
- **Local by default.** The proxy binds `127.0.0.1`, so your app and dashboard
  aren't exposed on the network. Use `--host 0.0.0.0` (or `proxy.host`) to allow
  access from other devices.
- **IPv4/IPv6.** Upstream hosts default to `localhost` and are reached with Happy
  Eyeballs, so a server bound to `127.0.0.1` _or_ `::1` works. Force a stack with
  a service `host` of `127.0.0.1` or `::1`.

## Platform support

Developed and tested on **macOS** and **Linux**, and exercised on **Windows** in
CI (Node 20 & 22 across all three via GitHub Actions). On POSIX, dev-bridge
signals the whole process group on shutdown; on Windows it uses `taskkill /T` to
stop the process tree.

## Development

```bash
npm install
npm test          # vitest (unit + integration + e2e)
npm run lint      # eslint
npm run typecheck # tsc --noEmit
npm run build     # tsup -> dist/
```

## License

MIT
