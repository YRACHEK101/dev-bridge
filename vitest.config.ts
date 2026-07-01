import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Integration tests spin up real sockets/processes; give them room.
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
