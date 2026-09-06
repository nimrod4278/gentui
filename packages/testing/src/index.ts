// Public surface of gentui-testing.

export {
  createSeededRandom,
  getActiveSeed,
  hashStringToSeed,
  mulberry32,
  type SeededRandom,
} from "./seeded-random.js";
export { FakeClock } from "./fake-clock.js";
export { TimerLeakDetector } from "./timer-leak.js";
export {
  TerminalStateGuard,
  type TtyLike,
  type TerminalSnapshot,
} from "./terminal-state.js";
export {
  createInMemoryRenderer,
  createTestRenderer,
  type InMemoryRenderer,
  type InMemoryRendererOptions,
  type TestRendererDriver,
} from "./in-memory-renderer.js";
export { STANDARD_PROFILE, NARROW_PROFILE, WIDE_PROFILE } from "./profiles.js";
export {
  runInPty,
  type PtyAction,
  type PtyObservation,
  type PtyRunOptions,
} from "./pty-fixture.js";
