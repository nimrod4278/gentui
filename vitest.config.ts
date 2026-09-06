import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

// Primary suite. Deliberately EXCLUDES the *.selftest.* fixtures so the
// day-to-day suite is always green; the harness meta-tests in
// test/harness.spec.ts spawn those fixtures on purpose to prove the harness
// can fail.
export default defineConfig({
  resolve: {
    alias: {
      // Resolve workspace packages to their TypeScript source so tests run
      // against current source, not a possibly-stale build. The
      // package-consumer meta-test spawns a real Node subprocess and is
      // unaffected by these aliases.
      "gentui-testing": `${root}packages/testing/src/index.ts`,
      "gentui-adapter-pi": `${root}packages/adapter-pi/src/index.ts`,
      gentui: `${root}packages/gentui/src/index.ts`,
    },
  },
  test: {
    include: ["test/**/*.spec.ts", "packages/**/src/**/*.spec.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.selftest.*"],
    setupFiles: ["test/setup/global-guards.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
