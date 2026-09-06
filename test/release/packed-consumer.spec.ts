import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const node = process.execPath;
const directory = mkdtempSync(join(tmpdir(), "gentui-packed-"));
let packageDirectory = "";
let packedFiles: string[] = [];

beforeAll(() => {
  execFileSync(npm, ["run", "build"], { cwd: root, stdio: "pipe" });
  const tarballs: string[] = [];
  for (const packagePath of ["packages/gentui", "packages/testing", "packages/adapter-pi"]) {
    const packed = JSON.parse(execFileSync(npm, ["pack", resolve(root, packagePath), "--json", "--pack-destination", directory], { cwd: root, encoding: "utf8" }));
    const entry = packed[0];
    packedFiles.push(...entry.files.map((file: { path: string }) => `${entry.name}:${file.path}`));
    tarballs.push(join(directory, entry.filename));
  }
  packageDirectory = join(directory, "consumer");
  writeFileSync(join(directory, "package.json"), JSON.stringify({ private: true }));
  execFileSync(npm, ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", packageDirectory, ...tarballs], { stdio: "pipe" });
}, 120_000);

afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe("packed release-candidate consumer", () => {
  it("contains only documented package metadata, skill, and dist artifacts", () => {
    expect(packedFiles.length).toBeGreaterThan(2);
    expect(packedFiles.every((entry) => {
      const path = entry.slice(entry.indexOf(":") + 1);
      return path === "package.json" || path === "README.md" || path === "LICENSE" || path.startsWith("dist/") || path === "skills/gentui/SKILL.md";
    })).toBe(true);
    expect(packedFiles.some((path) => path.endsWith("src/terminal.ts"))).toBe(false);
    expect(packedFiles.some((path) => path.includes(".pi/extensions/gentui.ts"))).toBe(false);
    const manifest = JSON.parse(readFileSync(join(packageDirectory, "node_modules/gentui-adapter-pi/package.json"), "utf8"));
    expect(manifest.pi.extensions).toEqual(["./dist/index.js"]);
    expect(manifest.pi.skills).toEqual(["./skills"]);
    expect(readFileSync(join(packageDirectory, "node_modules/gentui-adapter-pi/skills/gentui/SKILL.md"), "utf8"))
      .toBe(readFileSync(resolve(root, "skills/gentui/SKILL.md"), "utf8"));
    expect(manifest.dependencies).toEqual({ gentui: "^0.1.0" });
    expect(manifest.dependencies?.["gentui-testing"]).toBeUndefined();
  });

  it("installs in a clean ESM project and exposes only documented exports", () => {
    writeFileSync(join(packageDirectory, "package.json"), JSON.stringify({ private: true, type: "module" }));
    const script = `
      import { EventEmitter } from 'node:events';
      import { validateDocument, createRuntime, createAgentTool, createTerminalHost, createPromptTerminalHost } from 'gentui';
      const fixture=${readFileSync(resolve(root, "test/release/fixtures/protocol-v1.json"), "utf8")};
      const frames=[];
      const makeRenderer=()=>({render(input){frames.push(input.document.id);return {columns:80,rows:24,lines:['ok'],keyboardHelp:[]}},cleanup(){},setInputHandler(){}});
      const renderer=makeRenderer();
      const validation=validateDocument(fixture);
      if(!validation.ok) throw new Error('v1 fixture rejected');
      const incompatible=validateDocument({...fixture,version:'2'});
      if(incompatible.ok || incompatible.diagnostics[0].code!=='unsupported_version') throw new Error('version diagnostic missing');
      const tool=createAgentTool(createRuntime({renderer}));
      const opened=await tool.execute({operation:'open',document:fixture});
      if(opened.status!=='ok') throw new Error('packed transcript failed');
      await tool.execute({operation:'close',sessionId:opened.sessionId});
      class Input extends EventEmitter {isTTY=true;isRaw=false;paused=true;setRawMode(v){this.isRaw=v}resume(){this.paused=false}pause(){this.paused=true}isPaused(){return this.paused}}
      class Output extends EventEmitter {isTTY=true;columns=80;rows=24;write(){return true}}
      const common=()=>({input:new Input(),output:new Output(),frameRenderer:makeRenderer(),env:{TERM:'xterm',LANG:'en_US.UTF-8'}});
      const hosts=[
        createTerminalHost({...common(),host:{suspend(){},resume(){}}}),
        createPromptTerminalHost({...common(),prompt:{canPause(){return true},pause(){},resume(){}}}),
      ];
      for(const host of hosts){const result=await host.open({document:fixture});if(result.status!=='opened')throw new Error('packed host conformance failed');await result.session.close()}
      console.log('PACKED_CONFORMANCE_OK');
    `;
    const run = spawnSync(node, ["--input-type=module", "-e", script], { cwd: packageDirectory, encoding: "utf8" });
    expect(run.stderr).toBe("");
    expect(run.stdout).toContain("PACKED_CONFORMANCE_OK");
    expect(run.status).toBe(0);

    const hidden = spawnSync(node, ["--input-type=module", "-e", "import 'gentui/internal/private-registry'"], { cwd: packageDirectory, encoding: "utf8" });
    expect(hidden.status).not.toBe(0);
    expect(hidden.stderr).toContain("ERR_PACKAGE_PATH_NOT_EXPORTED");
  });

  it("compiles a TypeScript ESM consumer against packed declarations", () => {
    const source = `import { validateDocument, type UiDocument } from 'gentui';\nimport { createInMemoryRenderer } from 'gentui-testing';\nimport adapter from 'gentui-adapter-pi';\nconst doc: UiDocument = {version:'1',id:'typed',root:{id:'root',type:'text',props:{content:'ok'}}};\ncreateInMemoryRenderer();\nvoid adapter;\nif (!validateDocument(doc).ok) throw new Error('invalid');\n`;
    writeFileSync(join(packageDirectory, "consumer.ts"), source);
    const tsc = resolve(root, "node_modules/typescript/bin/tsc");
    const result = spawnSync(node, [tsc, "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "consumer.ts"], { cwd: packageDirectory, encoding: "utf8" });
    expect(result.stdout + result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
