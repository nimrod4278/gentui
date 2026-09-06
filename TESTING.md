# Testing guide

The test harness is built on [Vitest](https://vitest.dev) over a TypeScript,
ESM-first npm workspace. Deterministic helpers (seeded random, a fake clock,
timer-leak and terminal-state guards) live in `gentui-testing`
(`packages/testing/src`).

## Commands

| Intent | Command |
| --- | --- |
| Install | `npm install` |
| Build `gentui` (needed by the package-consumer test) | `npm run build` |
| Type-check the whole workspace | `npm run typecheck` |
| Run everything (PR / CI) | `npm test` |
| Watch mode | `npm run test:watch` |
| One test file | `npx vitest run test/harness.spec.ts` |
| One test by name | `npx vitest run -t "reported as a leak"` |
| One package | `npx vitest run packages/testing` |
| Defining dashboard acceptance | `npx vitest run test/acceptance/dashboard.spec.ts` |
| Two-host portability contract | `npx vitest run test/agent/host-portability.spec.ts` |
| Pi adapter contract | `npx vitest run test/adapter-pi/pi-adapter.spec.ts` |
| Pseudo-terminal suite | `npm run test:pty` |
| Release-candidate tarballs | `npm run test:release` |
| Extended fuzzing | `npm run test:fuzz` |
| Virtual 30-minute soak | `npm run test:soak` |
| Targeted mutation gate | `npm run test:mutation` |
| Live model evaluation | `GENTUI_EVAL_COMMAND=... npm run eval:live` |

CI runs `npm run typecheck && npm test` across Node.js 20, 22, and 24 on Linux, macOS, and Windows. Release jobs additionally run packed-artifact, extended-fuzz, virtual-soak, mutation, and production dependency-audit gates. See [`EVALUATION.md`](EVALUATION.md) for thresholds and the provider-neutral live-model bridge.

## Determinism and reproducibility

- **Random seed.** Generated/property tests use `createSeededRandom()` from
  `gentui-testing`, which resolves its seed from `GENTUI_SEED` (a number or a
  string) or a fixed default. The active seed is printed at the start of every
  run, so any failure is reproducible with:

  ```bash
  GENTUI_SEED=<seed-from-output> npm test
  ```

- **Fake clock.** Time-dependent behavior (spinners, waits, timeouts) uses
  `FakeClock` and is advanced explicitly — tests never sleep.

## Leak and terminal-state detection

- `TimerLeakDetector` tracks timers created but never cleared within a scoped
  window and fails the test if any remain.
- `TerminalStateGuard` captures a tty-like descriptor and asserts its mode
  (e.g. raw mode) is restored. `runInPty()` drives real POSIX pseudo-terminals;
  restoration, resize, stdin, screen/cursor, signal, and subprocess crash
  scenarios live in `test/pty/`.
- The primary suite installs a global guard (`test/setup/global-guards.ts`)
  that turns an unhandled promise rejection into a hard failure.

## Defining dashboard acceptance

`test/acceptance/dashboard.spec.ts` composes the v1 repository dashboard and
covers the approval and cancellation journeys, immediate host-local content,
complete and patch streaming, interaction-state preservation, invalid-update
recovery, viewport bounds, ASCII/no-color/reduced-motion profiles, cleanup,
filesystem manifests, and host authorization separation. The complementary
terminal ownership and real PTY evidence lives in `test/pty/`.

## Host portability

`test/agent/host-portability.spec.ts` runs one serialized catalog/open/update/input/wait/close transcript unchanged through both the fullscreen-TUI and line-prompt hosts. The parameterized contract also covers unsupported handoff, authorization separation, cancellation, timeout, signals, restoration, and rejection of provider-specific capability objects. Host differences are exposed through `TerminalHost.capabilities`; core documents and results do not branch by host.

## Pi adapter

`test/adapter-pi/pi-adapter.spec.ts` drives the installed tool edge through Pi-compatible contexts, the live custom component, configured key translation, current-frame updates, cancellation, single-surface ownership, and exactly-once waits. The packed-consumer suite additionally audits the `pi.extensions` manifest and production dependency boundary.

## Release robustness

`test/release/packed-consumer.spec.ts` builds and packs both public packages, installs their tarballs into a clean ESM project, compiles a TypeScript consumer, checks package exports, and runs committed protocol-v1/runtime conformance without workspace aliases. `test/release/extended-robustness.spec.ts` covers seeded patch/input/profile/lifecycle interleavings and the maximum-rate virtual soak. `scripts/targeted-mutation.mjs` restores each source file in `finally` and fails if any high-risk mutant survives.

## Self-tests: proving the harness can fail

`test/harness/*.selftest.*` are **deliberately broken** fixtures. They are
excluded from the primary suite (`*.selftest.*`) and are executed only by the
meta-tests in `test/harness.spec.ts`, which spawn each fixture in a real
subprocess and assert the harness rejects it:

1. a failing assertion exits non-zero;
2. an unclosed timer is reported as a leak;
3. a seeded generated test replays identical cases and reports its seed;
4. importing an unexported internal package path fails
   (`ERR_PACKAGE_PATH_NOT_EXPORTED`) while the public entry resolves.

To watch a self-test fail on its own:

```bash
npx vitest run --config vitest.selftest.config.ts failing-assertion
```
