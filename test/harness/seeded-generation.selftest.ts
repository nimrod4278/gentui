import { it, expect } from "vitest";
import { createSeededRandom } from "../../packages/testing/src/seeded-random.js";

// FIXTURE — passes, but emits its seed and generated cases on stdout. The
// harness meta-test runs it twice and asserts the cases are identical and the
// seed is reported.
it("generates a deterministic case list and reports its seed", () => {
  const rng = createSeededRandom();
  const cases = Array.from({ length: 6 }, () => rng.int(1000));
  console.log(`GEN_SEED=${rng.seed}`);
  console.log(`GEN_CASES=${JSON.stringify(cases)}`);
  expect(cases).toHaveLength(6);
});
