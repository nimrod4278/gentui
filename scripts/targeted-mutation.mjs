#!/usr/bin/env node
// Small risk-based mutation gate. It intentionally mutates one high-risk seam
// at a time, runs the owning behavioral suite, and restores source in finally.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const mutations = [
  { name: "validation-version", file: "packages/gentui/src/validate.ts", from: 'if (input.version !== "1") {', to: "if (false) {", test: "test/validation/document-validation.spec.ts" },
  { name: "patch-atomic-copy", file: "packages/gentui/src/patch.ts", from: "const draft = structuredClone(base) as unknown;", to: "const draft = base as unknown;", test: "test/runtime/update.spec.ts" },
  { name: "event-authorization", file: "packages/gentui/src/runtime.ts", from: "if (input.intent !== undefined && input.intent !== intent.name) {", to: "if (false) {", test: "test/runtime/navigation.spec.ts" },
  { name: "sanitization", file: "packages/gentui/src/sanitize.ts", from: 'let out = "";', to: "return input;\n  let out = \"\";", test: "test/validation/sanitization.spec.ts" },
  { name: "sequence", file: "packages/gentui/src/runtime.ts", from: "if (input.sequence !== expected) {", to: "if (false) {", test: "test/runtime/update.spec.ts" },
  { name: "cleanup-state", file: "packages/gentui/src/terminal.ts", from: "acquired = false;\n      latest = undefined;", to: "acquired = true;\n      latest = undefined;", test: "test/pty/terminal-ownership.spec.ts" },
];

if (process.argv.includes("--list")) {
  for (const mutation of mutations) console.log(`${mutation.name}: ${mutation.file} -> ${mutation.test}`);
  process.exit(0);
}

const survivors = [];
for (const mutation of mutations) {
  const original = readFileSync(mutation.file, "utf8");
  if (!original.includes(mutation.from)) throw new Error(`mutation anchor drifted: ${mutation.name}`);
  try {
    writeFileSync(mutation.file, original.replace(mutation.from, mutation.to));
    const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", mutation.test], {
      cwd: process.cwd(), encoding: "utf8", env: { ...process.env, GENTUI_MUTATION: mutation.name },
    });
    if (result.status === 0) survivors.push(mutation.name);
    else console.log(`KILLED ${mutation.name}`);
  } finally {
    writeFileSync(mutation.file, original);
  }
}
if (survivors.length) {
  console.error(`SURVIVED ${survivors.join(", ")}`);
  process.exit(1);
}
console.log(`Mutation score: 100% (${mutations.length}/${mutations.length} killed)`);
