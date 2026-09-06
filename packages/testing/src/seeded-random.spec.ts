import { describe, it, expect } from "vitest";
import {
  createSeededRandom,
  getActiveSeed,
  hashStringToSeed,
} from "./seeded-random.js";

describe("seeded random", () => {
  it("replays the same sequence for the same seed", () => {
    const a = createSeededRandom(12345);
    const b = createSeededRandom(12345);
    const seqA = Array.from({ length: 8 }, () => a.int(1000));
    const seqB = Array.from({ length: 8 }, () => b.int(1000));
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = Array.from({ length: 8 }, () => createSeededRandom(1).int(1_000_000));
    const b = Array.from({ length: 8 }, () => createSeededRandom(2).int(1_000_000));
    expect(a).not.toEqual(b);
  });

  it("reports the concrete seed it used", () => {
    expect(createSeededRandom(42).seed).toBe(42);
  });

  it("resolves a string GENTUI_SEED deterministically", () => {
    expect(hashStringToSeed("gentui")).toBe(hashStringToSeed("gentui"));
    expect(hashStringToSeed("gentui")).not.toBe(hashStringToSeed("other"));
  });

  it("getActiveSeed honours a numeric GENTUI_SEED override", () => {
    const prev = process.env.GENTUI_SEED;
    try {
      process.env.GENTUI_SEED = "777";
      expect(getActiveSeed()).toBe(777);
    } finally {
      if (prev === undefined) delete process.env.GENTUI_SEED;
      else process.env.GENTUI_SEED = prev;
    }
  });

  it("rejects an invalid int bound", () => {
    expect(() => createSeededRandom(1).int(0)).toThrow(RangeError);
  });
});
