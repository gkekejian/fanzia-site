import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // Next compiles JSX with the automatic runtime; match it so component
  // tests don't need `import React`.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 20000,
    // db/client.ts throws at import without DATABASE_URL. Tests use PGlite
    // (tests/testDb.ts) and never touch this pool (pg connects lazily), so a
    // dummy value is enough to let modules import cleanly.
    env: { DATABASE_URL: "postgresql://localhost:5432/fanzia_test_unused" },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
