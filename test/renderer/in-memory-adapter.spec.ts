import { describe, it, expect } from "vitest";
import { createInMemoryRenderer, STANDARD_PROFILE } from "gentui-testing";
import type { UiDocument } from "gentui";

// The in-memory renderer must satisfy the initial slice of the shared
// renderer-adapter contract: deterministic frames, one commit per render,
// idempotent cleanup, and failure handling.

const doc: UiDocument = {
  version: "1",
  id: "d",
  root: { id: "root", type: "text", props: { content: "Hi" } },
};

describe("in-memory renderer adapter contract", () => {
  it("produces a deterministic frame for a fixed document and profile", () => {
    const a = createInMemoryRenderer();
    const b = createInMemoryRenderer();
    const frameA = a.render({ document: doc, profile: STANDARD_PROFILE });
    const frameB = b.render({ document: doc, profile: STANDARD_PROFILE });
    expect(frameA).toEqual(frameB);
  });

  it("records one committed frame per render", () => {
    const renderer = createInMemoryRenderer();
    renderer.render({ document: doc, profile: STANDARD_PROFILE });
    expect(renderer.frames).toHaveLength(1);
    expect(renderer.currentFrame).toEqual(renderer.frames[0]);
  });

  it("cleanup removes the current frame and is safe to repeat", () => {
    const renderer = createInMemoryRenderer();
    renderer.render({ document: doc, profile: STANDARD_PROFILE });
    renderer.cleanup();
    renderer.cleanup();
    expect(renderer.currentFrame).toBeUndefined();
    expect(renderer.cleanupCount).toBe(2);
  });

  it("throws the armed error on the next render, then renders normally", () => {
    const renderer = createInMemoryRenderer();
    renderer.failNextRender(new Error("kaboom"));
    expect(() => renderer.render({ document: doc, profile: STANDARD_PROFILE })).toThrow(/kaboom/);
    const frame = renderer.render({ document: doc, profile: STANDARD_PROFILE });
    expect(frame.lines[0]).toBe("Hi".padEnd(80));
  });

  it("renders text at the top-left, padded within profile bounds", () => {
    const renderer = createInMemoryRenderer();
    const frame = renderer.render({ document: doc, profile: { columns: 10, rows: 3 } });
    expect(frame.lines).toEqual(["Hi".padEnd(10), " ".repeat(10), " ".repeat(10)]);
  });
});
