import { it, expect } from "vitest";

// FIXTURE — intentionally fails. Run only by the harness meta-test to prove
// the runner exits non-zero on a failing behavioral assertion. Excluded from
// the primary suite by the `*.selftest.*` exclude in vitest.config.ts.
it("intentionally fails so the harness can prove it rejects failures", () => {
  expect(1 + 1).toBe(3);
});
