import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Harness self-tests. Each spawns a deliberately broken
// fixture in a real subprocess and asserts the harness (or Node's own exports
// enforcement) rejects it. Proving the harness *can fail* is the whole point.

const ROOT = resolve(import.meta.dirname, "..");
const VITEST = resolve(ROOT, "node_modules/vitest/vitest.mjs");
const TSC = resolve(ROOT, "node_modules/typescript/bin/tsc");
const GENTUI_DIST = resolve(ROOT, "packages/gentui/dist/index.js");

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  combined: string;
}

function run(
  args: string[],
  opts: { env?: Record<string, string> } = {},
): RunResult {
  const res = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, ...opts.env },
  });
  const stdout = res.stdout ?? "";
  const stderr = res.stderr ?? "";
  return { status: res.status, stdout, stderr, combined: `${stdout}\n${stderr}` };
}

function runSelftest(filter: string, env?: Record<string, string>): RunResult {
  return run([VITEST, "run", "--config", "vitest.selftest.config.ts", filter], { env });
}

beforeAll(() => {
  // The package-consumer test needs `gentui` resolvable (workspace symlink)
  // and built (dist entry) so a real Node subprocess can import it.
  if (!existsSync(resolve(ROOT, "node_modules/gentui"))) {
    const install = run(["node_modules/.bin/npm", "install"]);
    if (install.status !== 0) {
      throw new Error(`npm install failed:\n${install.combined}`);
    }
  }
  if (!existsSync(GENTUI_DIST)) {
    const build = run([TSC, "-p", "packages/gentui/tsconfig.json"]);
    if (build.status !== 0) {
      throw new Error(`gentui build failed:\n${build.combined}`);
    }
  }
}, 120_000);

describe("harness proves it can fail", () => {
  it("1. a failing assertion makes the test command exit non-zero", () => {
    const r = runSelftest("failing-assertion");
    expect(r.status).not.toBe(0);
    // Output identifies the fixture that failed.
    expect(r.combined).toMatch(/failing-assertion/);
  });

  it("2. an unclosed timer is reported as a leak and fails the run", () => {
    const r = runSelftest("leaked-timer");
    expect(r.status).not.toBe(0);
    expect(r.combined).toMatch(/leaked timer/i);
  });

  it("3. re-running a seeded generated test replays the same cases and reports the seed", () => {
    const env = { GENTUI_SEED: "4242" };
    const first = runSelftest("seeded-generation", env);
    const second = runSelftest("seeded-generation", env);

    expect(first.status).toBe(0);
    expect(second.status).toBe(0);

    const casesOf = (r: RunResult): string => {
      const match = r.combined.match(/GEN_CASES=(\[[^\]]*\])/);
      if (!match) throw new Error(`no GEN_CASES in output:\n${r.combined}`);
      return match[1] as string;
    };

    expect(casesOf(first)).toBe(casesOf(second));
    expect(first.combined).toMatch(/GEN_SEED=4242/);
  });

  it("4. importing an unexported internal path fails; the public entry resolves", () => {
    const r = run(["test/harness/internal-import.selftest.mjs"]);
    expect(r.stdout).toMatch(/PUBLIC_IMPORT_OK/);
    expect(r.combined).toMatch(/ERR_PACKAGE_PATH_NOT_EXPORTED/);
    expect(r.status).toBe(1);
  });
});
