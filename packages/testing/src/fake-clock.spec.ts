import { describe, it, expect, vi } from "vitest";
import { FakeClock } from "./fake-clock.js";

describe("FakeClock", () => {
  it("does not fire callbacks before time is advanced", () => {
    const clock = new FakeClock();
    const spy = vi.fn();
    clock.setTimeout(spy, 100);
    expect(spy).not.toHaveBeenCalled();
    expect(clock.now()).toBe(0);
  });

  it("fires a timeout exactly at its due time and not before", () => {
    const clock = new FakeClock();
    const spy = vi.fn();
    clock.setTimeout(spy, 100);
    clock.advance(99);
    expect(spy).not.toHaveBeenCalled();
    clock.advance(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(clock.now()).toBe(100);
  });

  it("fires callbacks in time then insertion order", () => {
    const clock = new FakeClock();
    const order: string[] = [];
    clock.setTimeout(() => order.push("b"), 10);
    clock.setTimeout(() => order.push("a"), 10);
    clock.setTimeout(() => order.push("late"), 20);
    clock.advance(20);
    expect(order).toEqual(["b", "a", "late"]);
  });

  it("repeats intervals and stops when cleared", () => {
    const clock = new FakeClock();
    const spy = vi.fn();
    const id = clock.setInterval(spy, 10);
    clock.advance(35);
    expect(spy).toHaveBeenCalledTimes(3);
    clock.clear(id);
    clock.advance(100);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("is deterministic across two identical runs", () => {
    const run = () => {
      const clock = new FakeClock();
      const seen: number[] = [];
      clock.setInterval(() => seen.push(clock.now()), 7);
      clock.advance(30);
      return seen;
    };
    expect(run()).toEqual(run());
  });
});
