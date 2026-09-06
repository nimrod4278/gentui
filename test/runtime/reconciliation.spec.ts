import { describe, expect, it } from "vitest";
import { createRuntime } from "gentui";
import type { UiDocument } from "gentui";
import { createTestRenderer } from "gentui-testing";

const documentWith = (children: UiDocument["root"]["children"]): UiDocument => ({
  version: "1",
  id: "reconcile",
  root: { id: "root", type: "stack", props: {}, children },
});

const button = (id: string) => ({
  id,
  type: "button" as const,
  props: { label: id },
  events: { activate: { name: id } },
});

describe("state-preserving reconciliation", () => {
  it("preserves focus on the same id when siblings are inserted, removed, or reordered", async () => {
    const { renderer, driver } = createTestRenderer();
    const session = await createRuntime({ renderer }).open({
      document: documentWith([button("a"), button("b"), button("c")]),
    });

    expect(await driver.setInteractionState({ focusId: "b" })).toEqual({ status: "accepted" });
    const result = await session.update({
      sessionId: session.id,
      sequence: 1,
      document: documentWith([button("new"), button("c"), button("b"), button("a")]),
    });

    expect(result).toEqual({ status: "committed", sequence: 1 });
    expect(renderer.currentInteractionState?.focusId).toBe("b");
    await session.close();
  });

  it("preserves scroll, tab, selection, cursor, and form values by compatible stable id", async () => {
    const { renderer, driver } = createTestRenderer();
    const initial = documentWith([button("control"), { id: "content", type: "text", props: { content: "old" } }]);
    const session = await createRuntime({ renderer }).open({ document: initial });
    await driver.setInteractionState({
      focusId: "control",
      scroll: { content: 12 },
      activeTabId: { content: "tab-b" },
      selection: { content: "option-b" },
      cursor: { content: 3 },
      values: { content: "typed" },
    });

    await session.update({
      sessionId: session.id,
      sequence: 1,
      document: documentWith([button("control"), { id: "content", type: "text", props: { content: "new" } }]),
    });
    expect(renderer.currentInteractionState).toMatchObject({
      focusId: "control", scroll: { content: 12 }, activeTabId: { content: "tab-b" },
      selection: { content: "option-b" }, cursor: { content: 3 }, values: { content: "typed" },
    });
    await session.close();
  });

  it("falls back to the next, previous, then container when focused controls disappear", async () => {
    const { renderer, driver } = createTestRenderer();
    const session = await createRuntime({ renderer }).open({ document: documentWith([button("a"), button("b"), button("c")]) });
    await driver.setInteractionState({ focusId: "b" });
    await session.update({ sessionId: session.id, sequence: 1, document: documentWith([button("a"), button("c")]) });
    expect(renderer.currentInteractionState?.focusId).toBe("c");
    await session.update({ sessionId: session.id, sequence: 2, document: documentWith([button("a")]) });
    expect(renderer.currentInteractionState?.focusId).toBe("a");
    await session.update({ sessionId: session.id, sequence: 3, document: documentWith([]) });
    expect(renderer.currentInteractionState?.focusId).toBe("root");
    await session.close();
  });

  it("skips disabled fallback nodes", async () => {
    const { renderer, driver } = createTestRenderer();
    const session = await createRuntime({ renderer }).open({ document: documentWith([button("a"), button("b"), button("c")]) });
    await driver.setInteractionState({ focusId: "b" });
    await session.update({
      sessionId: session.id,
      sequence: 1,
      document: documentWith([button("a"), { ...button("c"), props: { label: "c", disabled: true } }]),
    });
    expect(renderer.currentInteractionState?.focusId).toBe("a");
    await session.close();
  });

  it("drops only local state for an id whose node type changes", async () => {
    const { renderer, driver } = createTestRenderer();
    const session = await createRuntime({ renderer }).open({ document: documentWith([button("x")]) });
    await driver.setInteractionState({ focusId: "x", values: { x: "secret" }, cursor: { x: 2 }, scroll: { x: 4 } });
    await session.update({ sessionId: session.id, sequence: 1, document: documentWith([{ id: "x", type: "text", props: { content: "changed" } }]) });
    expect(renderer.currentInteractionState?.values).toEqual({});
    expect(renderer.currentInteractionState?.cursor).toEqual({});
    expect(renderer.currentInteractionState?.scroll).toEqual({});
    expect(renderer.currentInteractionState?.focusId).toBe("root");
    await session.close();
  });

  it("rejects duplicate ids and does not merge their state", async () => {
    const { renderer, driver } = createTestRenderer();
    const session = await createRuntime({ renderer }).open({ document: documentWith([button("x")]) });
    await driver.setInteractionState({ focusId: "x", values: { x: "kept" } });
    const result = await session.update({ sessionId: session.id, sequence: 1, document: documentWith([button("x"), button("x")]) });
    expect(result.status).toBe("rejected");
    expect(renderer.currentInteractionState?.values).toEqual({ x: "kept" });
    await session.close();
  });

  it("clears only explicitly reset local state", async () => {
    const { renderer, driver } = createTestRenderer();
    const session = await createRuntime({ renderer }).open({ document: documentWith([{ id: "field", type: "text", props: { content: "x" } }]) });
    await driver.setInteractionState({ values: { field: "typed" }, cursor: { field: 4 }, scroll: { field: 8 } });
    await session.update({ sessionId: session.id, sequence: 1, document: documentWith([{ id: "field", type: "text", props: { content: "updated" } }]), reset: { nodeIds: ["field"], fields: ["values"] } });
    expect(renderer.currentInteractionState?.values).toEqual({});
    expect(renderer.currentInteractionState?.cursor).toEqual({ field: 4 });
    expect(renderer.currentInteractionState?.scroll).toEqual({ field: 8 });
    await session.close();
  });
});
