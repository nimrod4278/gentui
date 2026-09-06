import { describe, it, expect } from "vitest";
import { TerminalStateGuard } from "./terminal-state.js";

describe("TerminalStateGuard", () => {
  it("passes when the terminal mode is unchanged", () => {
    const tty = { isRaw: false, isTTY: true };
    const guard = new TerminalStateGuard(tty);
    guard.capture();
    // ...work that leaves raw mode alone...
    expect(() => guard.assertRestored()).not.toThrow();
  });

  it("flags a terminal left in raw mode", () => {
    const tty = { isRaw: false, isTTY: true };
    const guard = new TerminalStateGuard(tty);
    guard.capture();
    tty.isRaw = true; // simulate acquisition without restoration
    expect(() => guard.assertRestored()).toThrow(/not restored/i);
    expect(guard.diff().changed).toBe(true);
  });

  it("passes when raw mode is entered and then restored", () => {
    const tty = { isRaw: false, isTTY: true };
    const guard = new TerminalStateGuard(tty);
    guard.capture();
    tty.isRaw = true;
    tty.isRaw = false;
    expect(() => guard.assertRestored()).not.toThrow();
  });

  it("requires capture() before diff()", () => {
    const guard = new TerminalStateGuard({ isRaw: false });
    expect(() => guard.diff()).toThrow(/capture/i);
  });
});
