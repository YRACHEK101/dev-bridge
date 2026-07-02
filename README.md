<p align="center">
  <img src="assets/logo-banner.png" alt="portbridge" width="620" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/portbridge"><img src="https://img.shields.io/npm/v/portbridge?color=22d3ee&label=npm" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/portbridge"><img src="https://img.shields.io/npm/dm/portbridge?color=c084fc" alt="downloads" /></a>
  <img src="https://img.shields.io/node/v/portbridge?color=3c873a" alt="node version" />
  <img src="https://img.shields.io/npm/l/portbridge?color=blue" alt="license" />
</p>

<p align="center">
  <b>One command to run your frontend + backend dev servers behind a single port.</b><br/>
  No CORS setup&nbsp;·&nbsp;merged logs&nbsp;·&nbsp;a live request dashboard.
</p>

Running a separate frontend (Next.js / Vite / CRA) and backend (Express / any
Node server) locally means scattered ports, manual CORS config, logs split
across terminals, and no visibility into requests crossing the front↔back
boundary. `portbridge` fixes that:

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

## Getting started (Windows · macOS · Linux)

The commands are **identical on every OS**. Run them in your terminal —
PowerShell or Windows Terminal on Windows, Terminal/iTerm on macOS, any shell on
Linux.

### 1. Make sure you have Node.js 20+

Check your version:

```bash
node -v
```

If it prints `v20` (or higher) you're good. If not, install Node **LTS**:

| OS          | Easiest way                                                                       |
| ----------- | --------------------------------------------------------------------------------- |
| **Windows** | [nodejs.org](https://nodejs.org) installer, or `winget install OpenJS.NodeJS.LTS` |
| **macOS**   | [nodejs.org](https://nodejs.org) installer, or `brew install node`                |
| **Linux**   | your package manager, or [nvm](https://github.com/nvm-sh/nvm): `nvm install 20`   |

### 2. Create a config in your project

Go to your project's root folder (the one with your frontend and backend), then:

```bash
cd my-project
npx portbridge init
```

`init` **auto-detects** your stack (Next.js / Vite / CRA on the frontend;
Express / Fastify / Koa / NestJS on the backend) and pre-fills the commands and
ports — press **Enter** to accept each suggestion or type your own. It writes a
`portbridge.config.json`:

```json
{
  "frontend": { "command": "npm run dev", "port": 5173, "cwd": "./client" },
  "backend": { "command": "npm run server", "port": 5000, "cwd": "./server" },
  "proxy": { "port": 4000, "apiPrefix": "/api" }
}
```

> `command` = how each server starts · `port` = where it listens · `cwd` = its
> folder. Adjust to match your project.

### 3. Start both servers

```bash
npx portbridge              # add --dashboard for the live request timeline
```

You'll get a banner with the **unified URL** and both servers' logs merged into
one terminal.

### 4. Open your app

Open **http://localhost:4000** in your browser. Your frontend loads, and any
call it makes to `/api/...` is forwarded to your backend on the **same origin**
— so there's **no CORS to configure**. Press **Ctrl+C** to stop everything.

> **Use it everywhere:** install once with `npm install -g portbridge`, then just
> run `portbridge` (instead of `npx portbridge`) in any project.

## Configuration

`portbridge` reads its config from the current directory (or `--config <path>`).
Supported formats: `portbridge.config.{json,js,mjs,cjs,ts}` — JS/TS configs are
loaded via [jiti](https://github.com/unjs/jiti), so you can use comments and
computed values.

```json
{
  "frontend": { "command": "npm run dev", "port": 5173, "cwd": "./client" },
  "backend": { "command": "npm run server", "port": 5000, "cwd": "./server" },
  "proxy": { "port": 4000, "apiPrefix": "/api" },
  "restartOnCrash": false
}
```

| Field                               | Meaning                                                             |
| ----------------------------------- | ------------------------------------------------------------------- |
| `frontend` / `backend` `.command`   | shell command that starts the server                                |
| `frontend` / `backend` `.port`      | the port that server listens on (proxy forwards here)               |
| `frontend` / `backend` `.cwd`       | working directory for the command (relative to the config)          |
| `frontend` / `backend` `.host`      | host the proxy connects to (default `localhost`; reaches IPv4/IPv6) |
| `frontend` / `backend` `.env`       | extra environment variables for that process (object)               |
| `frontend` / `backend` `.readyPath` | health path to poll for wait-for-ready (e.g. `/health`)             |
| `frontend` / `backend` `.name`      | optional log label (defaults: `web` / `api`)                        |
| `proxy.port`                        | the single unified port you open in the browser                     |
| `proxy.host`                        | interface the proxy binds to (default `127.0.0.1`)                  |
| `proxy.apiPrefix`                   | requests under this path go to the backend (default `/api`)         |
| `restartOnCrash`                    | auto-restart a server if it exits non-zero (default `false`)        |

> **`PORT` is injected.** portbridge sets `PORT=<the configured port>` in each
> server's environment, so servers that read `process.env.PORT` bind the right
> port automatically. Otherwise, make the server listen on the `port` you
> configure (e.g. Vite's `server.port`). A per-service `env` value wins over the
> injected `PORT`.

## CLI

```
portbridge [start] [options]     # "start" is the default command
portbridge init [options]

Start options:
  -c, --config <path>   path to portbridge.config.json
  -p, --port <number>   unified proxy port (overrides config)
  -H, --host <host>     interface to bind (default 127.0.0.1; use 0.0.0.0 for LAN)
  -d, --dashboard       open a live request-timeline dashboard
  -v, --verbose         print [portbridge] diagnostics about the startup sequence
      --no-proxy        run servers + merged logs without the proxy
      --no-wait         don't wait for the servers to start listening first
      --strict-port     fail if the proxy port is taken (default: auto-pick free)
      --no-env-check    skip the .env.example vs .env check
  -V, --version
  -h, --help

Init options:
  -y, --yes             write defaults without prompting
  -f, --force           overwrite an existing config

Env:
  PORTBRIDGE_NO_OPEN=1  don't auto-open the dashboard browser (CI/headless)
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

## What it looks like

```text
  portbridge  ·  one port for your whole stack

  Open       http://localhost:4000
  Dashboard  http://localhost:4000/_portbridge
  Frontend   npm run dev     → :5173
  Backend    npm run server  → :5000  /api/*

  Press Ctrl+C to stop.

[10:24:01] [web] VITE ready in 412 ms
[10:24:01] [api] API listening on http://localhost:5000
[10:24:07] [api] GET /api/todos 200 18ms
```

Frontend lines are cyan, backend magenta, errors red — all interleaved in one
terminal, in real time. With `--dashboard`, the same requests stream into a live
timeline at `/_portbridge`.

## Why not just `concurrently` + CORS?

`concurrently "npm run client" "npm run server"` runs both processes, and that's
it. You still:

- **configure CORS** on your backend (or a framework proxy) so the browser can
  call the API from a different port;
- juggle **two URLs/ports** and keep them straight;
- read **interleaved-but-unlabelled** logs with no per-line source or timing;
- have **no view** of requests crossing the front↔back boundary.

`portbridge` gives you **one origin** (no CORS), **labelled/timed merged logs**,
a **live request dashboard**, plus quality-of-life guards (port auto-resolution,
`.env` check, wait-for-ready, crash restart). It's the "run both servers" step
_plus_ the glue you'd otherwise wire by hand.

## Try the example

A runnable, dependency-free demo lives in [`example/`](./example) — a tiny todo
app. From that folder:

```bash
node ../bin/portbridge.js --dashboard   # or `npx portbridge --dashboard`
```

…then open http://localhost:4000 and http://localhost:4000/_portbridge.

## Notes

- **ESM-only.** This is a modern Node ≥20 CLI; two core dependencies (`execa`,
  `chalk`) are pure ESM, so there is no CommonJS build.
- The dashboard is served at `/_portbridge` on the unified port; that path is
  reserved (never proxied to your app).
- **Local by default.** The proxy binds `127.0.0.1`, so your app and dashboard
  aren't exposed on the network. Use `--host 0.0.0.0` (or `proxy.host`) to allow
  access from other devices.
- **IPv4/IPv6.** Upstream hosts default to `localhost` and are reached with Happy
  Eyeballs, so a server bound to `127.0.0.1` _or_ `::1` works. Force a stack with
  a service `host` of `127.0.0.1` or `::1`.

## Platform support

Developed and tested on **macOS** and **Linux**, and exercised on **Windows** in
CI (Node 20 & 22 across all three via GitHub Actions). On POSIX, portbridge
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
