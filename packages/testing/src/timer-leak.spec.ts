import { describe, it, expect, afterEach } from "vitest";
import { TimerLeakDetector } from "./timer-leak.js";

describe("TimerLeakDetector", () => {
  let detector: TimerLeakDetector | undefined;

  afterEach(() => {
    detector?.restore();
    detector = undefined;
  });

  it("flags an uncleared timeout and clears once cancelled", () => {
    detector = new TimerLeakDetector();
    detector.install();

    const handle = setTimeout(() => {}, 60_000);
    expect(detector.activeCount()).toBe(1);
    expect(() => detector!.assertNoLeaks()).toThrow(/leaked timer/i);

    clearTimeout(handle);
    expect(detector.activeCount()).toBe(0);
    expect(() => detector!.assertNoLeaks()).not.toThrow();
  });

  it("tracks intervals too", () => {
    detector = new TimerLeakDetector();
    detector.install();
    const handle = setInterval(() => {}, 1000);
    expect(() => detector!.assertNoLeaks()).toThrow(/interval/i);
    clearInterval(handle);
    expect(() => detector!.assertNoLeaks()).not.toThrow();
  });

  it("does not throw when nothing is scheduled", () => {
    detector = new TimerLeakDetector();
    detector.install();
    expect(() => detector!.assertNoLeaks()).not.toThrow();
  });
});
