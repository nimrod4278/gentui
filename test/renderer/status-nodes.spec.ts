import { describe, expect, it } from "vitest";
import { createInMemoryRenderer, FakeClock } from "gentui-testing";
import { createRuntime, DiagnosticCode, validateDocument } from "gentui";
import type { UiDocument, UiNode } from "gentui";

const render = (node: UiNode) => createInMemoryRenderer().render({
  document: { version: "1", id: "status", root: node }, profile: { columns: 24, rows: 3 },
});

describe("status nodes", () => {
  it("renders bounded progress with a semantic percentage", () => {
    for (const [value, expected] of [[0, "0%"], [0.5, "50%"], [1, "100%"]] as const) {
      const frame = render({ id: "p", type: "progress", props: { value, label: "Building" } });
      expect(frame.lines[0].trimEnd()).toBe(`Building ${expected}`);
    }
  });

  it("rejects progress outside its closed 0..1 range", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -0.01, 1.01]) {
      const result = validateDocument({
        version: "1", id: "status", root: { id: "p", type: "progress", props: { value, label: "Building" } },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.diagnostics.some((item) => item.code === DiagnosticCode.InvalidProp)).toBe(true);
    }
  });

  it("does not regress progress when stale and out-of-order updates are rejected", async () => {
    const renderer = createInMemoryRenderer();
    const runtime = createRuntime({ renderer });
    const document = (value: number): UiDocument => ({
      version: "1", id: "status", root: { id: "p", type: "progress", props: { value, label: "Building" } },
    });
    const session = await runtime.open({ document: document(0.5) });
    expect((await session.update({ sessionId: session.id, sequence: 2, document: document(0.9) })).status).toBe("rejected");
    expect(renderer.currentFrame?.lines[0]?.trimEnd()).toBe("Building 50%");
    expect((await session.update({ sessionId: session.id, sequence: 1, document: document(0.75) })).status).toBe("committed");
    expect((await session.update({ sessionId: session.id, sequence: 1, document: document(0.1) })).status).toBe("rejected");
    expect(renderer.currentFrame?.lines[0]?.trimEnd()).toBe("Building 75%");
    await session.close();
  });

  it("advances spinners on a fake clock and keeps one timer across rapid updates", () => {
    const clock = new FakeClock();
    const renderer = createInMemoryRenderer({ clock });
    const input = (label: string) => ({
      document: { version: "1" as const, id: "status", root: { id: "s", type: "spinner", props: { label } } },
      profile: { columns: 24, rows: 3 },
    });
    renderer.render(input("Loading"));
    for (let index = 0; index < 100; index++) renderer.render(input(`Loading ${index}`));
    expect(clock.pending()).toBe(1);
    const before = renderer.frames.length;
    clock.advance(80);
    expect(renderer.frames).toHaveLength(before + 1);
    expect(renderer.currentFrame?.lines[0]?.trimEnd()).toBe("Loading 99 .");
    expect(clock.pending()).toBe(1);
    renderer.cleanup();
    expect(clock.pending()).toBe(0);
  });

  it("stops spinner work on removal, cancellation, render exception, and close", async () => {
    const spinner: UiDocument = { version: "1", id: "status", root: { id: "s", type: "spinner", props: { label: "Loading" } } };
    const done: UiDocument = { version: "1", id: "status", root: { id: "e", type: "empty", props: { label: "No work" } } };

    for (const ending of ["removal", "cancellation", "exception", "close"] as const) {
      const clock = new FakeClock();
      const renderer = createInMemoryRenderer({ clock });
      const session = await createRuntime({ renderer, clock }).open({ document: spinner });
      expect(clock.pending()).toBe(1);
      if (ending === "removal") await session.update({ sessionId: session.id, sequence: 1, document: done });
      if (ending === "cancellation") renderer.dispatch({ type: "cancel-request" });
      if (ending === "exception") {
        renderer.failNextRender(new Error("render failed"));
        expect(() => session.update({ sessionId: session.id, sequence: 1, document: spinner })).toThrow("render failed");
      }
      if (ending === "close") await session.close();
      expect(clock.pending()).toBe(0);
    }
  });

  it("uses stable text and no timer in reduced-motion mode", () => {
    const clock = new FakeClock();
    const renderer = createInMemoryRenderer({ clock });
    const frame = renderer.render({
      document: { version: "1", id: "status", root: { id: "s", type: "spinner", props: { label: "Loading" } } },
      profile: { columns: 24, rows: 3, reducedMotion: true },
    });
    expect(frame.lines[0]?.trimEnd()).toBe("Loading");
    expect(clock.pending()).toBe(0);
    clock.advance(1_000);
    expect(renderer.frames).toHaveLength(1);
  });

  it("renders actionable, sanitized status details in narrow ASCII/no-color mode", () => {
    const renderer = createInMemoryRenderer();
    const profile = { columns: 40, rows: 4, asciiOnly: true, color: false };
    const error = renderer.render({
      document: { version: "1", id: "status", root: { id: "e", type: "error", props: { label: "Build failed", message: "Run npm test\u001b]52;c;secret\u0007" } } }, profile,
    });
    expect(error.lines[0]?.trimEnd()).toBe("Error: Build failed");
    expect(error.lines[1]?.trimEnd()).toBe("Run npm test]52;c;secret");
    expect(error.lines.join("\n")).not.toMatch(/[\u001b\u0007]/);
    expect(error.keyboardHelp).toEqual([]);

    const empty = renderer.render({
      document: { version: "1", id: "status", root: { id: "empty", type: "empty", props: { label: "No changes", detail: "Edit a file to begin" } } }, profile,
    });
    expect(empty.lines.slice(0, 2).map((line) => line.trimEnd())).toEqual(["Empty: No changes", "Edit a file to begin"]);
    expect(empty.keyboardHelp).toEqual([]);
  });

  it("rejects interactions on status nodes because the catalog allows none", () => {
    for (const type of ["progress", "spinner", "error", "empty"]) {
      const result = validateDocument({
        version: "1", id: "status", root: {
          id: type, type, props: type === "progress" ? { value: 0.5, label: "Work" } : type === "error" ? { message: "Failed" } : { label: "Status" },
          events: { activate: { name: "unexpected" } },
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.diagnostics.some((item) => item.code === DiagnosticCode.DisallowedEvent)).toBe(true);
    }
  });

  it("renders legacy spinner, error, and empty states as readable text", () => {
    expect(render({ id: "s", type: "spinner", props: { label: "Loading" } }).lines[0].trimEnd()).toBe("Loading");
    expect(render({ id: "e", type: "error", props: { message: "Failed\u001b[2J" } }).lines[0].trimEnd()).toBe("Failed[2J");
    expect(render({ id: "empty", type: "empty", props: { label: "Nothing here" } }).lines[0].trimEnd()).toBe("Nothing here");
  });
});
