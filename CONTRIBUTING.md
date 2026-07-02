# Contributing to dev-bridge

Thanks for helping out! This project aims to stay small, framework-agnostic, and
trustworthy. Please read the design decisions below before making changes.

## Getting started

```bash
git clone https://github.com/YRACHEK101/dev-bridge.git
cd dev-bridge
npm install
```

Requires **Node.js ≥ 20**.

## Development workflow

```bash
npm test           # vitest: unit + integration + e2e
npm run test:watch # watch mode
npm run lint       # eslint (flat config)
npm run typecheck  # tsc --noEmit (strict)
npm run format     # prettier --write
npm run build      # tsup -> dist/
```

Please make sure `npm run lint && npm run typecheck && npm test && npm run build`
all pass before opening a PR. CI runs the same on Linux, macOS, and Windows
(Node 20 & 22).

## Running the example

A dependency-free demo lives in [`example/`](./example):

```bash
cd example
node ../bin/dev-bridge.js --dashboard   # after `npm run build` at the repo root
# then open http://localhost:4000 and http://localhost:4000/_devbridge
```

## Tests

- Unit tests mock/inject dependencies (e.g. a fake spawner, an injected prompt
  function, an injected signal target) so they stay deterministic.
- Integration/e2e tests spawn **real** processes using the fixtures in
  [`test/fixtures/`](./test/fixtures) (`.cjs` scripts) — **not** inline
  `node -e "…"` strings, which behave differently under Windows `cmd`. Keep it
  that way.

## Design decisions (please don't undo these)

These are intentional; changing them will break things or regress hard-won
fixes:

1. **ESM-only.** `execa` v9 and `chalk` v5 are pure ESM, so there is no CommonJS
   build. The `bin` uses top-level `await import`.
2. **The dashboard UI is embedded as a string** ([src/dashboard/ui.ts](./src/dashboard/ui.ts)),
   not shipped as static files — this avoids asset-path resolution bugs across
   dev and the bundled `dist/`.
3. **The proxy `pathFilter` excludes the dashboard prefix** (`/_devbridge`).
   Without it, `http-proxy-middleware`'s WebSocket auto-subscription hijacks the
   dashboard's own `/_devbridge/ws` upgrade and pipes it to the (non-WS)
   frontend.
4. **`isPortFree` probes `127.0.0.1` specifically**, not all interfaces —
   `SO_REUSEADDR` gives false "free" results when probing all interfaces on
   macOS/BSD.
5. **Process shutdown: POSIX uses the process group** (`detached` + `kill(-pid)`);
   **Windows uses `taskkill /T`**. Killing only the direct child leaves the real
   dev server (a grandchild) running.
6. **Upstream hosts default to `localhost` with `autoSelectFamily`** so a server
   bound to IPv4 or IPv6 is reachable; the proxy binds `127.0.0.1` by default so
   the app isn't exposed on the LAN.

## Commit style

Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`, `ci:`). Keep
one logical change per commit.
