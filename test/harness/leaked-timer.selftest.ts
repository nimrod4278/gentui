import { describe, it, beforeEach, afterEach } from "vitest";
import { TimerLeakDetector } from "../../packages/testing/src/timer-leak.js";

// FIXTURE — intentionally leaks a timer. The afterEach leak assertion turns
// the leak into a test failure so the harness meta-test can prove leaked
// handles are reported.
describe("leaked timer fixture", () => {
  const detector = new TimerLeakDetector();

  beforeEach(() => detector.install());
  afterEach(() => {
    try {
      detector.assertNoLeaks();
    } finally {
      detector.restore();
    }
  });

  it("schedules a timer and never clears it", () => {
    setTimeout(() => {}, 60_000);
  });
});
