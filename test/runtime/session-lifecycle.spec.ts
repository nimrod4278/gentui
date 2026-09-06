import { describe, it, expect } from "vitest";
import { createRuntime } from "gentui";
import type { UiDocument } from "gentui";
import { createInMemoryRenderer } from "gentui-testing";

// Session-lifecycle behaviors exercised only through the public runtime
// interface plus the in-memory renderer adapter (no internal mocks).

const helloDoc: UiDocument = {
  version: "1",
  id: "doc-hello",
  root: { id: "root", type: "text", props: { content: "Hello" } },
};

describe("session lifecycle", () => {
  it("1. renders the exact known frame `Hello` at 80x24", async () => {
    const renderer = createInMemoryRenderer();
    const runtime = createRuntime({ renderer });

    await runtime.open({ document: helloDoc });

    const frame = renderer.currentFrame;
    expect(frame).toBeDefined();
    expect(frame!.columns).toBe(80);
    expect(frame!.rows).toBe(24);
    expect(frame!.lines).toHaveLength(24);
    expect(frame!.lines[0]).toBe("Hello".padEnd(80));
    expect(frame!.lines.every((line) => line.length === 80)).toBe(true);
    expect(frame!.lines.slice(1).every((line) => line.trim() === "")).toBe(true);
  });

  it("2. close returns {type:'close'}, terminates results iteration, and removes the frame", async () => {
    const renderer = createInMemoryRenderer();
    const runtime = createRuntime({ renderer });
    const session = await runtime.open({ document: helloDoc });

    const collected: unknown[] = [];
    const drained = (async () => {
      for await (const result of session.results) collected.push(result);
    })();

    const result = await session.close();
    expect(result).toEqual({ type: "close" });

    await drained; // must not hang: iteration terminates on close
    expect(collected).toEqual([]);
    expect(renderer.currentFrame).toBeUndefined();
  });

  it("3. closing twice is idempotent and cleans up exactly once", async () => {
    const renderer = createInMemoryRenderer();
    const runtime = createRuntime({ renderer });
    const session = await runtime.open({ document: helloDoc });

    const first = await session.close();
    const second = await session.close();

    expect(first).toEqual({ type: "close" });
    expect(second).toEqual({ type: "close" });
    expect(renderer.cleanupCount).toBe(1);
  });

  it("4. opening after a prior session closes carries no prior state", async () => {
    const renderer = createInMemoryRenderer();
    const runtime = createRuntime({ renderer });

    const first = await runtime.open({ document: helloDoc });
    await first.close();

    const worldDoc: UiDocument = {
      version: "1",
      id: "doc-world",
      root: { id: "root", type: "text", props: { content: "World" } },
    };
    const second = await runtime.open({ document: worldDoc });

    expect(second.id).not.toBe(first.id);
    expect(renderer.currentFrame?.lines[0]).toBe("World".padEnd(80));
  });

  it("5. a renderer failure during open rejects and leaves no active session", async () => {
    const renderer = createInMemoryRenderer();
    renderer.failNextRender(new Error("boom"));
    const runtime = createRuntime({ renderer });

    await expect(runtime.open({ document: helloDoc })).rejects.toThrow(/boom/);
    expect(renderer.currentFrame).toBeUndefined();
    expect(renderer.cleanupCount).toBe(1);

    // The runtime remains usable: a fresh open succeeds.
    const session = await runtime.open({ document: helloDoc });
    expect(renderer.currentFrame?.lines[0]).toBe("Hello".padEnd(80));
    await session.close();
  });
});
