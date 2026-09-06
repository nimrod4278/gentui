import { describe, expect, it } from "vitest";
import { createRuntime, validateDocument, type InputHandler, type RendererAdapter, type UiDocument, type UiPatchOp } from "gentui";
import { createInMemoryRenderer, createSeededRandom } from "gentui-testing";

const extended = process.env.GENTUI_FUZZ === "extended";
const fuzzCases = extended ? 5_000 : 200;

const document = (value = 0): UiDocument => ({
  version: "1",
  id: "robustness",
  root: {
    id: "root",
    type: "stack",
    props: {},
    children: [
      { id: "status", type: "text", props: { content: `update ${value}` } },
      { id: "action", type: "button", props: { label: "Continue" }, events: { activate: { name: "continue", payload: { value } } } },
    ],
  },
});

describe("seeded extended protocol robustness", () => {
  it(`covers ${fuzzCases} document, patch, input, resize-profile, and lifecycle interleavings`, async () => {
    const random = createSeededRandom();
    for (let index = 0; index < fuzzCases; index++) {
      const profile = {
        columns: random.pick([1, 20, 40, 120]),
        rows: random.pick([1, 5, 24]),
        asciiOnly: random.next() < 0.5,
        color: random.next() < 0.5,
        reducedMotion: random.next() < 0.5,
      };
      const renderer = createInMemoryRenderer();
      const runtime = createRuntime({ renderer, profile });
      const session = await runtime.open({ document: document(index) });
      const patch: UiPatchOp[] = random.next() < 0.8
        ? [{ type: "replace", path: ["root", "children", 0, "props", "content"], value: `seed-${random.seed}-${index}` }]
        : [{ type: "remove", path: ["root", "children", 99] }];
      const update = session.update({ sessionId: session.id, sequence: 1, patch });
      if (random.next() < 0.5) renderer.dispatch({ type: "key", key: "Tab" });
      if (random.next() < 0.5) renderer.dispatch({ type: "activate", nodeId: "action" });
      const result = await update;
      expect(["committed", "rejected"]).toContain(result.status);
      expect(renderer.currentFrame?.lines.length ?? 0).toBeLessThanOrEqual(profile.rows);
      if (random.next() < 0.25) {
        await Promise.allSettled([session.close("race-a"), session.close("race-b"), session.wait({ timeoutMs: 0 })]);
      } else {
        await session.close();
      }
      expect(renderer.cleanupCount).toBeGreaterThanOrEqual(1);
    }
  });

  it("keeps a simulated 30-minute maximum-rate workload bounded", async () => {
    const configuredMinutes = Number(process.env.GENTUI_SOAK_MINUTES ?? (extended ? 30 : 0.05));
    const updatesPerSecond = 20;
    const iterations = Math.max(1, Math.round(configuredMinutes * 60 * updatesPerSecond));
    let renders = 0;
    let renderDurationMs = 0;
    let inputHandler: InputHandler | undefined;
    let maximumInputLatencyMs = 0;
    let maximumResultBatch = 0;
    const heapBefore = process.memoryUsage().heapUsed;
    const renderer: RendererAdapter = {
      render(input) {
        const started = performance.now();
        renders++;
        const frame = { columns: input.profile.columns, rows: input.profile.rows, lines: ["ok"], keyboardHelp: [] };
        renderDurationMs += performance.now() - started;
        return frame;
      },
      cleanup() {},
      setInputHandler(handler) { inputHandler = handler; },
    };
    const runtime = createRuntime({ renderer });
    const session = await runtime.open({ document: document() });
    for (let sequence = 1; sequence <= iterations; sequence++) {
      const result = await session.update({ sessionId: session.id, sequence, document: document(sequence) });
      if (result.status !== "committed") throw new Error(`soak update ${sequence} failed`);
      const inputStarted = performance.now();
      inputHandler?.({ type: "activate", nodeId: "action" });
      maximumInputLatencyMs = Math.max(maximumInputLatencyMs, performance.now() - inputStarted);
      const drained = await session.wait({ timeoutMs: 0 });
      if (drained.status === "results") maximumResultBatch = Math.max(maximumResultBatch, drained.results.length);
    }
    await session.close();
    const heapGrowth = Math.max(0, process.memoryUsage().heapUsed - heapBefore);
    expect(renders).toBe(iterations + 1);
    expect(maximumResultBatch).toBeLessThanOrEqual(1);
    expect(heapGrowth).toBeLessThan(128 * 1024 * 1024);
    expect(renderDurationMs / renders).toBeLessThan(10);
    expect(maximumInputLatencyMs).toBeLessThan(100);
    expect(validateDocument(document(iterations)).ok).toBe(true);
  }, extended ? 120_000 : 30_000);
});
