import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  createTerminalHost,
  createTerminalRenderer,
  detectTerminalCapabilities,
  type TerminalInput,
  type TerminalOutput,
  type UiDocument,
} from "gentui";
import { createInMemoryRenderer, STANDARD_PROFILE } from "gentui-testing";

const doc: UiDocument = { version: "1", id: "terminal", root: { id: "root", type: "text", props: { content: "Hello" } } };

class Input extends EventEmitter {
  isTTY = true;
  isRaw = false;
  paused = true;
  readonly log: string[];
  constructor(log: string[] = []) { super(); this.log = log; }
  setRawMode(raw: boolean): void { this.isRaw = raw; this.log.push(`raw:${raw}`); }
  resume(): this { this.paused = false; this.log.push("input:resume"); return this; }
  pause(): this { this.paused = true; this.log.push("input:pause"); return this; }
  isPaused(): boolean { return this.paused; }
}
class Output extends EventEmitter {
  isTTY = true;
  columns = 20;
  rows = 4;
  readonly writes: string[] = [];
  write(data: string): boolean { this.writes.push(data); return true; }
}
const streams = (log: string[] = []) => ({ input: new Input(log) as TerminalInput, output: new Output() as TerminalOutput });
const host = (log: string[]) => ({ suspend: () => { log.push("host:suspend"); }, resume: () => { log.push("host:resume"); } });

function setup(log: string[] = [], extra: Record<string, unknown> = {}) {
  const pair = streams(log);
  const frameRenderer = createInMemoryRenderer();
  const terminalHost = createTerminalHost({ ...pair, frameRenderer, host: host(log), env: { TERM: "xterm-256color", LANG: "en_US.UTF-8" }, ...extra });
  return { ...pair, frameRenderer, terminalHost };
}

describe("real terminal renderer and host ownership", () => {
  it("passes the shared deterministic frame and repeatable-cleanup renderer contract", () => {
    const expectedRenderer = createInMemoryRenderer();
    const expected = expectedRenderer.render({ document: doc, profile: STANDARD_PROFILE });
    const pair = streams();
    (pair.output as Output).columns = STANDARD_PROFILE.columns;
    (pair.output as Output).rows = STANDARD_PROFILE.rows;
    const selected = createTerminalRenderer({ ...pair, frameRenderer: createInMemoryRenderer() });
    selected.acquire();
    expect(selected.render({ document: doc, profile: STANDARD_PROFILE })).toEqual(expected);
    selected.cleanup();
    selected.cleanup();
    expect(selected.acquired).toBe(false);
  });

  it("returns unsupported without output, raw mode, or host suspension for non-TTY streams", async () => {
    const log: string[] = [];
    const pair = streams(log);
    (pair.input as Input).isTTY = false;
    const frameRenderer = createInMemoryRenderer();
    const terminalHost = createTerminalHost({ ...pair, frameRenderer, host: host(log) });
    expect(detectTerminalCapabilities(pair)).toEqual({ status: "unsupported", reason: "stdin is not a TTY" });
    expect(await terminalHost.open({ document: doc })).toEqual({ status: "unsupported", reason: "stdin is not a TTY" });
    expect(log).toEqual([]);
    expect((pair.output as Output).writes).toEqual([]);
  });

  it("suspends the host before acquiring stdin and restores every recorded state on close", async () => {
    const log: string[] = [];
    const { terminalHost, input, output } = setup(log);
    const opened = await terminalHost.open({ document: doc });
    expect(opened.status).toBe("opened");
    expect(log.indexOf("host:suspend")).toBeLessThan(log.indexOf("raw:true"));
    expect(log.indexOf("raw:true")).toBeLessThan(log.indexOf("input:resume"));
    expect((output as Output).writes.join("")).toContain("\u001b[?1049h\u001b[?25l");
    await (opened as Extract<typeof opened, { status: "opened" }>).session.close();
    expect((input as Input).isRaw).toBe(false);
    expect((input as Input).paused).toBe(true);
    expect((output as Output).writes.at(-1)).toBe("\u001b[0m\u001b[?25h\u001b[?1049l");
    expect(log.at(-1)).toBe("host:resume");
  });

  it("redraws at live resize bounds and gives resize back exclusively to the host after close", async () => {
    const { terminalHost, frameRenderer, output } = setup();
    const opened = await terminalHost.open({ document: doc });
    if (opened.status !== "opened") throw new Error("expected support");
    (output as Output).columns = 7; (output as Output).rows = 2; (output as Output).emit("resize");
    expect(frameRenderer.currentFrame).toMatchObject({ columns: 7, rows: 2 });
    const count = frameRenderer.frames.length;
    await opened.session.close();
    (output as Output).columns = 3; (output as Output).emit("resize");
    expect(frameRenderer.frames).toHaveLength(count);
    expect((output as Output).listenerCount("resize")).toBe(0);
  });

  it("routes Ctrl+C consistently and restores from text entry, navigation, and confirmation", async () => {
    for (const root of [
      { id: "i", type: "input", props: { label: "Name" }, events: { activate: { name: "submit" } } },
      { id: "b", type: "button", props: { label: "Next" }, events: { activate: { name: "next" } } },
      { id: "c", type: "confirm", props: { label: "Sure?", risk: "high" }, events: { activate: { name: "approve" } } },
    ]) {
      const log: string[] = [];
      const { terminalHost, input } = setup(log);
      const opened = await terminalHost.open({ document: { ...doc, root } });
      if (opened.status !== "opened") throw new Error("expected support");
      (input as Input).emit("data", Buffer.from("\t"));
      (input as Input).emit("data", Buffer.from("\u0003"));
      expect(await opened.session.wait()).toMatchObject({ status: "results", results: [{ type: "cancel" }], sessionState: "closed" });
      expect((input as Input).isRaw).toBe(false);
      expect(log.at(-1)).toBe("host:resume");
    }
  });

  it("preserves a renderer failure over cleanup failure and releases after initial/later/event errors", async () => {
    const phases = ["initial", "later", "event"] as const;
    for (const phase of phases) {
      const log: string[] = [];
      const pair = streams(log);
      const base = createInMemoryRenderer();
      let failCleanup = true;
      const renderer = {
        render: base.render,
        setInputHandler: base.setInputHandler,
        cleanup() { base.cleanup(); if (failCleanup) { failCleanup = false; throw new Error("cleanup boom"); } },
      };
      if (phase === "initial") base.failNextRender(new Error("initial boom"));
      const terminalHost = createTerminalHost({ ...pair, frameRenderer: renderer, host: host(log), env: { TERM: "xterm", LANG: "C.UTF-8" } });
      const opening = terminalHost.open({ document: phase === "event" ? { ...doc, root: { id: "b", type: "button", props: { label: "Go" }, events: { activate: { name: "go" } } } } : doc });
      if (phase === "initial") {
        await expect(opening).rejects.toThrow("initial boom");
      } else {
        const opened = await opening;
        if (opened.status !== "opened") throw new Error("expected support");
        base.failNextRender(new Error(`${phase} boom`));
        if (phase === "later") expect(() => opened.session.update({ sessionId: opened.session.id, sequence: 1, document: { ...doc, title: "updated" } })).toThrow("later boom");
        else (pair.input as Input).emit("data", Buffer.from("\t"));
      }
      expect(log).toContain("host:resume");
      expect((pair.input as Input).isRaw).toBe(false);
    }
  });

  it("restores on SIGINT, SIGTERM, host cancellation, timeout, and normal close", async () => {
    for (const ending of ["SIGINT", "SIGTERM", "abort", "timeout", "close"] as const) {
      const signals = new EventEmitter();
      const controller = new AbortController();
      const log: string[] = [];
      const { terminalHost, input } = setup(log, { signalSource: signals, abortSignal: controller.signal, ...(ending === "timeout" ? { timeoutMs: 0 } : {}) });
      const opened = await terminalHost.open({ document: doc });
      if (opened.status !== "opened") throw new Error("expected support");
      if (ending === "SIGINT" || ending === "SIGTERM") signals.emit(ending);
      else if (ending === "abort") controller.abort();
      else if (ending === "close") await opened.session.close();
      if (ending === "timeout") await new Promise((resolve) => setTimeout(resolve, 5));
      await Promise.resolve();
      expect((input as Input).isRaw, ending).toBe(false);
      expect(log.at(-1), ending).toBe("host:resume");
      expect(signals.listenerCount("SIGINT") + signals.listenerCount("SIGTERM")).toBe(0);
    }
  });

  it("survives fifty cycles without input/listener growth, stale frames, or hidden cursor", async () => {
    const log: string[] = [];
    const { terminalHost, input, output, frameRenderer } = setup(log);
    for (let index = 0; index < 50; index++) {
      const opened = await terminalHost.open({ document: { ...doc, root: { ...doc.root, props: { content: `frame-${index}` } } } });
      if (opened.status !== "opened") throw new Error("expected support");
      expect(frameRenderer.currentFrame?.lines[0]).toContain(`frame-${index}`);
      await opened.session.close();
      expect((input as Input).listenerCount("data")).toBe(0);
      expect((output as Output).listenerCount("resize")).toBe(0);
      expect((input as Input).isRaw).toBe(false);
    }
    expect((output as Output).writes.at(-1)).toContain("\u001b[?25h\u001b[?1049l");
  });

  it("installs gentui input only after suspension, so transition input cannot reach both owners", () => {
    const log: string[] = [];
    const pair = streams(log);
    let hostReads = 0; let gentuiReads = 0;
    const hostListener = () => { hostReads++; };
    (pair.input as Input).on("data", hostListener);
    const renderer = createTerminalRenderer({ ...pair, frameRenderer: createInMemoryRenderer() });
    renderer.setInputHandler(() => { gentuiReads++; return { status: "accepted" }; });
    (pair.input as Input).emit("data", "before");
    (pair.input as Input).off("data", hostListener); // host.suspend()
    renderer.acquire();
    (pair.input as Input).emit("data", "after");
    renderer.cleanup();
    expect({ hostReads, gentuiReads }).toEqual({ hostReads: 1, gentuiReads: 1 });
  });
});
