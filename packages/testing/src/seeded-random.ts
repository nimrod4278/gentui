// Deterministic, seeded pseudo-random generation for property/fuzz tests.
//
// The seed is resolved once from the environment (or a fixed default) so that
// re-running a generated test replays the exact same cases, and the seed is
// always reportable so a failure is reproducible.

const DEFAULT_SEED = 0x9e3779b9 >>> 0;

/** FNV-1a hash so a human-readable seed string maps to a 32-bit seed. */
export function hashStringToSeed(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Resolve the active seed from `GENTUI_SEED` (number or string) or the default. */
export function getActiveSeed(): number {
  const raw = process.env.GENTUI_SEED;
  if (raw !== undefined && raw !== "") {
    const asNumber = Number(raw);
    if (Number.isFinite(asNumber)) return asNumber >>> 0;
    return hashStringToSeed(raw);
  }
  return DEFAULT_SEED;
}

/** mulberry32 PRNG: tiny, fast, deterministic. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeededRandom {
  /** The concrete seed used, so it can be printed on failure. */
  readonly seed: number;
  /** Next float in [0, 1). */
  next(): number;
  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Pick one element from a non-empty array. */
  pick<T>(items: readonly T[]): T;
}

export function createSeededRandom(seed: number = getActiveSeed()): SeededRandom {
  const resolved = seed >>> 0;
  const next = mulberry32(resolved);
  return {
    seed: resolved,
    next,
    int(maxExclusive: number): number {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new RangeError(`maxExclusive must be a positive integer, got ${maxExclusive}`);
      }
      return Math.floor(next() * maxExclusive);
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new RangeError("cannot pick from an empty array");
      return items[Math.floor(next() * items.length)] as T;
    },
  };
}
