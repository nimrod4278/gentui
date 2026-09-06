import { defineConfig } from "vitest/config";

// Config used ONLY by the harness meta-tests to run the deliberately
// broken fixtures (`*.selftest.ts`). It has no global guard setup so each
// fixture demonstrates exactly one failure mode.
export default defineConfig({
  test: {
    include: ["test/harness/**/*.selftest.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 10_000,
  },
});
