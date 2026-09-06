import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  createAgentTool,
  createPromptTerminalHost,
  createTerminalHost,
  type GentuiToolOutput,
  type SignalSource,
  type TerminalHost,
  type TerminalInput,
  type TerminalOutput,
  type UiDocument,
} from "gentui";
import { createInMemoryRenderer } from "gentui-testing";

class Input extends EventEmitter {
  isTTY = true;
  isRaw = false;
  paused = true;
  setRawMode(raw: boolean): void { this.isRaw = raw; }
  resume(): this { this.paused = false; return this; }
  pause(): this { this.paused = true; return this; }
  isPaused(): boolean { return this.paused; }
}

class Output extends EventEmitter {
  isTTY = true;
  columns = 50;
  rows = 10;
  writes: string[] = [];
  write(data: string): boolean { this.writes.push(data); return true; }
}

const initial: UiDocument = {
  version: "1",
  id: "portable",
  root: {
    id: "approve",
    type: "button",
    props: { label: "Approve" },
    events: { activate: { name: "approve", payload: { approved: true } } },
  },
};

interface Fixture {
  host: TerminalHost;
  input: Input;
  output: Output;
  lifecycle: string[];
}

type HostKind = "fullscreen" | "prompt";

function fixture(kind: HostKind, options: { supported?: boolean; signalSource?: SignalSource; abortSignal?: AbortSignal; timeoutMs?: number } = {}): Fixture {
  const input = new Input();
  const output = new Output();
  const lifecycle: string[] = [];
  const common = {
    input: input as TerminalInput,
    output: output as TerminalOutput,
    frameRenderer: createInMemoryRenderer(),
    env: { TERM: "xterm-256color", LANG: "en_US.UTF-8" },
    ...(options.signalSource ? { signalSource: options.signalSource } : {}),
    ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  };
  if (kind === "fullscreen") {
    if (options.supported === false) input.isTTY = false;
    return {
      host: createTerminalHost({
        ...common,
        host: { suspend: () => lifecycle.push("suspend-ui"), resume: () => lifecycle.push("resume-ui") },
      }),
      input, output, lifecycle,
    };
  }
  return {
    host: createPromptTerminalHost({
      ...common,
      prompt: {
        canPause: () => options.supported !== false,
        pause: () => lifecycle.push("pause-prompt"),
        resume: () => lifecycle.push("resume-prompt"),
      },
    }),
    input, output, lifecycle,
  };
}

function openedId(result: GentuiToolOutput): string {
  if (result.status !== "ok" || result.sessionId === undefined) throw new Error("expected an opened session");
  return result.sessionId;
}

async function transcript(kind: HostKind): Promise<unknown[]> {
  const { host, input } = fixture(kind);
  const tool = createAgentTool(host);
  const catalog = await tool.execute({ operation: "catalog" });
  const opened = await tool.execute({ operation: "open", document: initial });
  const sessionId = openedId(opened);
  input.emit("data", "\t");
  input.emit("data", "\r");
  const update = await tool.execute({
    operation: "update",
    sessionId,
    sequence: 1,
    update: [{ type: "replace", path: ["root", "props", "label"], value: "Approved" }],
  });
  const wait = await tool.execute({ operation: "wait", sessionId, timeoutMs: 0 });
  const close = await tool.execute({ operation: "close", sessionId, reason: "done" });
  return [catalog, { ...opened, sessionId: "<session>" }, update, wait, close];
}

const hosts: HostKind[] = ["fullscreen", "prompt"];

describe("second host portability contract", () => {
  it("runs one unchanged serialized transcript with equivalent typed outcomes in both hosts", async () => {
    expect(await transcript("prompt")).toEqual(await transcript("fullscreen"));
    expect(fixture("fullscreen").host.capabilities).toEqual({ handoff: "suspend-ui" });
    expect(fixture("prompt").host.capabilities).toEqual({ handoff: "pause-prompt" });
  });

  it.each(hosts)("%s returns unsupported without acquiring the terminal", async (kind) => {
    const { host, input, output, lifecycle } = fixture(kind, { supported: false });
    const result = await createAgentTool(host).execute({ operation: "open", document: initial });
    expect(result).toMatchObject({ status: "unsupported" });
    expect(input.isRaw).toBe(false);
    expect(input.listenerCount("data")).toBe(0);
    expect(output.writes).toEqual([]);
    expect(lifecycle).toEqual([]);
  });

  it.each(hosts)("%s keeps approval as data and preserves host authorization", async (kind) => {
    const { host, input } = fixture(kind);
    const tool = createAgentTool(host);
    const sessionId = openedId(await tool.execute({ operation: "open", document: initial }));
    input.emit("data", "\t");
    input.emit("data", "\r");
    const result = await tool.execute({ operation: "wait", sessionId, timeoutMs: 0 });
    expect(result).toMatchObject({ status: "ok", results: [{ intent: "approve", values: { approved: true } }] });
    const hostOperation = async () => ({ status: "denied" as const, reason: "host policy" });
    expect(await hostOperation()).toEqual({ status: "denied", reason: "host policy" });
  });

  it.each(hosts)("%s restores on cancellation, timeout, signal, and normal close", async (kind) => {
    for (const ending of ["cancel", "timeout", "signal", "close"] as const) {
      const signals = new EventEmitter();
      const controller = new AbortController();
      const current = fixture(kind, {
        signalSource: signals as SignalSource,
        abortSignal: controller.signal,
        ...(ending === "timeout" ? { timeoutMs: 0 } : {}),
      });
      const opened = await current.host.open({ document: initial });
      if (opened.status !== "opened") throw new Error("expected terminal support");
      if (ending === "cancel") controller.abort();
      else if (ending === "signal") signals.emit("SIGTERM");
      else if (ending === "close") await opened.session.close();
      else await new Promise((resolve) => setTimeout(resolve, 5));
      await Promise.resolve();
      expect(current.input.isRaw, ending).toBe(false);
      expect(current.lifecycle.at(-1), ending).toMatch(/^resume-/);
      expect(signals.listenerCount("SIGINT") + signals.listenerCount("SIGTERM"), ending).toBe(0);
    }
  });

  it.each(hosts)("%s rejects provider objects before they cross the runtime boundary", async (kind) => {
    const { host, lifecycle } = fixture(kind);
    const result = await createAgentTool(host).execute({
      operation: "open",
      document: { ...initial, metadata: { providerResponse: new AbortController() } },
    });
    expect(result).toMatchObject({ status: "invalid", reason: "serialization" });
    expect(lifecycle).toEqual([]);
  });
});
