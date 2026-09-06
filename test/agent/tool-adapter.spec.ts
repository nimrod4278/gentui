import { EventEmitter } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createAgentTool,
  createRuntime,
  createTerminalHost,
  type GentuiToolOutput,
  type TerminalInput,
  type TerminalOutput,
  type UiDocument,
} from "gentui";
import { createTestRenderer } from "gentui-testing";

const document = (content = "Choose"): UiDocument => ({
  version: "1",
  id: "tool-screen",
  root: {
    id: "choice",
    type: "button",
    props: { label: content },
    events: { activate: { name: "choose", payload: { value: "yes" } } },
  },
});

function setup() {
  const rendered = createTestRenderer();
  const tool = createAgentTool(createRuntime({ renderer: rendered.renderer }));
  return { ...rendered, tool };
}

function jsonRoundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sessionId(output: GentuiToolOutput): string {
  if (output.status !== "ok" || output.sessionId === undefined) throw new Error("session did not open");
  return output.sessionId;
}

describe("serializable agent-tool adapter", () => {
  it("runs a literal catalog/open/update/wait/close transcript with JSON-only outputs", async () => {
    const { tool, driver } = setup();
    const catalog = await tool.execute({ operation: "catalog" });
    expect(jsonRoundTrip(catalog)).toEqual(catalog);
    expect(catalog).toMatchObject({ status: "ok", catalog: { protocolVersion: "1" } });

    const opened = await tool.execute({ operation: "open", document: document() });
    const id = sessionId(opened);
    expect(jsonRoundTrip(opened)).toEqual(opened);

    await driver.activate("choice");
    const updated = await tool.execute({ operation: "update", sessionId: id, sequence: 1, update: document("Updated") });
    expect(updated).toEqual({
      status: "ok",
      update: { status: "committed", sequence: 1 },
      results: [{ type: "submit", intent: "choose", values: { value: "yes" } }],
    });
    expect(await tool.execute({ operation: "wait", sessionId: id, timeoutMs: 0 })).toEqual({ status: "ok", results: [] });
    expect(await tool.execute({ operation: "close", sessionId: id, reason: "done" })).toEqual({ status: "closed", result: { type: "close" } });
  });

  it("returns distinct typed outcomes for unknown operations, malformed calls, unknown sessions, and closed sessions", async () => {
    const { tool } = setup();
    expect(await tool.execute({ operation: "explode" })).toMatchObject({ status: "invalid", reason: "unknown_operation", errors: [{ code: "unknown_operation", path: ["operation"] }] });
    expect(await tool.execute({ operation: "wait", timeoutMs: "soon" })).toMatchObject({ status: "invalid", reason: "malformed_input", errors: [{ code: "malformed_tool_input" }] });
    expect(await tool.execute({ operation: "wait", sessionId: "missing" })).toEqual({ status: "unknown_session", sessionId: "missing" });

    const id = sessionId(await tool.execute({ operation: "open", document: document() }));
    await tool.execute({ operation: "close", sessionId: id });
    expect(await tool.execute({ operation: "update", sessionId: id, sequence: 1, update: document() })).toEqual({ status: "closed", sessionId: id });
  });

  it("validates before the real host handoff and restores the host after open or render failure", async () => {
    class Input extends EventEmitter {
      isTTY = true; isRaw = false; paused = true;
      setRawMode(raw: boolean) { this.isRaw = raw; }
      resume() { this.paused = false; return this; }
      pause() { this.paused = true; return this; }
      isPaused() { return this.paused; }
    }
    class Output extends EventEmitter {
      isTTY = true; columns = 40; rows = 8;
      write() { return true; }
    }
    const calls: string[] = [];
    const frameRenderer = createTestRenderer().renderer;
    const terminalHost = createTerminalHost({
      input: new Input() as TerminalInput,
      output: new Output() as TerminalOutput,
      frameRenderer,
      host: { suspend: () => calls.push("suspend"), resume: () => calls.push("resume") },
      env: { TERM: "xterm", LANG: "en_US.UTF-8" },
    });
    const tool = createAgentTool(terminalHost);

    expect(await tool.execute({ operation: "open", document: { ...document(), version: "2" } })).toMatchObject({ status: "invalid", reason: "malformed_input" });
    expect(calls).toEqual([]);

    const id = sessionId(await tool.execute({ operation: "open", document: document() }));
    expect(calls).toEqual(["suspend"]);
    await tool.execute({ operation: "close", sessionId: id });
    expect(calls).toEqual(["suspend", "resume"]);

    frameRenderer.failNextRender(new Error("render failed"));
    expect(await tool.execute({ operation: "open", document: document() })).toMatchObject({ status: "invalid", reason: "operation_failed" });
    expect(calls.slice(-2)).toEqual(["suspend", "resume"]);
  });

  it("returns results generated while the agent works exactly once on update or wait", async () => {
    const { tool, driver } = setup();
    const id = sessionId(await tool.execute({ operation: "open", document: document() }));
    await driver.activate("choice");
    expect(await tool.execute({ operation: "wait", sessionId: id, timeoutMs: 0 })).toMatchObject({ status: "ok", results: [{ intent: "choose" }] });
    expect(await tool.execute({ operation: "wait", sessionId: id, timeoutMs: 0 })).toEqual({ status: "ok", results: [] });
    await driver.activate("choice");
    expect(await tool.execute({ operation: "update", sessionId: id, sequence: 1, update: document("next") })).toMatchObject({ status: "ok", results: [{ intent: "choose" }] });
    expect(await tool.execute({ operation: "wait", sessionId: id, timeoutMs: 0 })).toEqual({ status: "ok", results: [] });

    // A rejected update still returns, rather than consumes and loses, anything
    // the user produced while the agent was working.
    await driver.activate("choice");
    expect(await tool.execute({ operation: "update", sessionId: id, sequence: 1, update: document("duplicate") })).toMatchObject({
      status: "invalid", reason: "update_rejected", results: [{ intent: "choose" }],
    });
    expect(await tool.execute({ operation: "wait", sessionId: id, timeoutMs: 0 })).toEqual({ status: "ok", results: [] });
    await tool.execute({ operation: "close", sessionId: id });
  });

  it("allows only one of two racing calls with the same sequence to commit", async () => {
    const { tool } = setup();
    const id = sessionId(await tool.execute({ operation: "open", document: document() }));
    const calls = await Promise.all([
      tool.execute({ operation: "update", sessionId: id, sequence: 1, update: document("first") }),
      tool.execute({ operation: "update", sessionId: id, sequence: 1, update: document("second") }),
    ]);
    expect(calls.filter((result) => result.status === "ok")).toHaveLength(1);
    expect(calls.filter((result) => result.status === "invalid")).toMatchObject([{ reason: "update_rejected", update: { reason: "duplicate" } }]);
    await tool.execute({ operation: "close", sessionId: id });
  });

  it.each([
    ["function", () => undefined],
    ["symbol", Symbol("not-json")],
    ["capability object", new AbortController()],
  ])("rejects %s values instead of silently coercing them", async (_name, value) => {
    const { tool } = setup();
    expect(await tool.execute({ operation: "open", document: { ...document(), extra: value } })).toMatchObject({ status: "invalid", reason: "serialization" });
  });

  it("rejects cyclic input and capability-bearing output", async () => {
    const { tool } = setup();
    const cyclic: Record<string, unknown> = { operation: "catalog" };
    cyclic.self = cyclic;
    expect(await tool.execute(cyclic)).toMatchObject({ status: "invalid", reason: "serialization" });

    const unsafe = createAgentTool({ catalog: () => new AbortController() as never, open: async () => { throw new Error("unused"); } });
    expect(await unsafe.execute({ operation: "catalog" })).toMatchObject({ status: "invalid", reason: "serialization" });
  });

  it("performs the complete transcript without creating files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gentui-tool-"));
    try {
      const before = await readdir(directory);
      const { tool } = setup();
      const id = sessionId(await tool.execute({ operation: "open", document: document() }));
      await tool.execute({ operation: "update", sessionId: id, sequence: 1, update: document("safe") });
      await tool.execute({ operation: "wait", sessionId: id, timeoutMs: 0 });
      await tool.execute({ operation: "close", sessionId: id });
      expect(await readdir(directory)).toEqual(before);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
