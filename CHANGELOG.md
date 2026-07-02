# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-07-02

Initial release.

### Added

- **Unified proxy** — one port fronts both dev servers: `/api/*` (configurable
  prefix) routes to the backend, everything else to the frontend, so the app
  needs no CORS configuration. WebSocket upgrades (HMR) are forwarded to the
  frontend.
- **Config** — `portbridge.config.json`, validated with zod (clear per-field
  errors). `portbridge init` scaffolds it interactively (with a `--yes`
  non-interactive fallback).
- **Process supervision** — spawns the frontend and backend, merges their
  stdout/stderr into one timestamped, prefixed, color-coded stream, and shuts
  them down gracefully on `Ctrl+C` (process-group kill on POSIX, `taskkill /T`
  on Windows). Optional `restartOnCrash` with a crash-loop cap that resets after
  a process has run healthy.
- **Live dashboard** (`--dashboard`) — a self-contained request-timeline UI at
  `/_portbridge`, streaming every proxied request over WebSocket with backlog
  replay.
- **Guards** — auto-picks a free proxy port when the configured one is busy
  (`--strict-port` to fail instead); advisory `.env.example` vs `.env` check;
  injects `PORT` into each child process.
- **Networking** — proxy binds `127.0.0.1` by default (`--host` / `proxy.host`
  to expose on the LAN); upstream hosts default to `localhost` and are reached
  over IPv4 or IPv6 (Happy Eyeballs).

[Unreleased]: https://github.com/YRACHEK101/dev-bridge/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/YRACHEK101/dev-bridge/releases/tag/v0.1.0
