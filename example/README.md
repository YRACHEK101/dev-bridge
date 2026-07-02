# portbridge example — todo app

A tiny, **dependency-free** full-stack app that shows what portbridge does. Both
servers are plain Node (`node server.js`) — no `npm install` needed here.

```
example/
├── client/      # frontend dev server (serves index.html on :5173)
├── server/      # backend API (/api/todos on :5000)
└── portbridge.config.json
```

## Run it

From this `example/` folder:

```bash
# if portbridge is installed globally or via npx:
npx portbridge

# or, from inside this repo (after `npm run build` at the repo root):
node ../bin/portbridge.js --dashboard
```

Then open **http://localhost:4000**.

## What to notice

- **One port.** The browser only ever talks to `:4000`. The frontend fetches
  `/api/todos` on the **same origin**, so there is **no CORS configuration** —
  portbridge forwards `/api/*` to the backend on `:5000` and everything else to
  the frontend on `:5173`.
- **Merged logs.** Both servers' output is interleaved in one terminal, each
  line prefixed and colored (`[web]` cyan, `[api]` magenta).
- **Live dashboard.** With `--dashboard`, open
  http://localhost:4000/_portbridge to watch every request (method, path,
  target, status, duration) stream in as you click around.
- **Ctrl+C** stops both servers cleanly.

Add a few todos in the UI and watch the `GET`/`POST /api/todos` requests appear
in the dashboard with their timings.
