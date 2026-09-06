// Global guards applied to the primary suite:
//  - report the active random seed so any generated-test failure is reproducible;
//  - turn an unhandled promise rejection into a hard failure instead of a
//    silently-swallowed warning.

import { getActiveSeed } from "../../packages/testing/src/seeded-random.js";

console.error(`[harness] active random seed = ${getActiveSeed()} (override with GENTUI_SEED)`);

process.on("unhandledRejection", (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  console.error("[harness] unhandled promise rejection detected:", error);
  process.exitCode = 1;
  throw error;
});
