import { defineConfig } from "tsup";

// ESM-only build. Two core dependencies (execa v9, chalk v5) are pure ESM,
// so a CommonJS build is not possible without breaking them. This is a CLI
// targeting Node >=20, where ESM is the correct default.
export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    index: "src/index.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  // The dashboard static assets are copied verbatim (Phase 2).
  publicDir: false,
});
