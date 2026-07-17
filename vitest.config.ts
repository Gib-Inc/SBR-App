import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@": path.resolve(__dirname, "client/src"),
    },
  },
  test: {
    environment: "node",
    // Only pick up server-side unit tests for now. Widen this glob as more
    // suites are added (e.g. integration tests under server/shopify).
    // scripts/: pure helpers for repo scripts (no DB in tests).
    include: ["server/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
