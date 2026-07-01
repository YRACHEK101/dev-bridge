#!/usr/bin/env node
// Silence Node deprecation warnings emitted by dependencies (notably the
// unmaintained `http-proxy` using util._extend / DEP0060). This is a CLI whose
// whole point is clean terminal output; we don't want third-party deprecation
// noise on every start. Our own code targets current Node APIs.
process.noDeprecation = true;

// Thin entry point. Real logic lives in the compiled CLI.
const { main } = await import("../dist/cli.js");

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
