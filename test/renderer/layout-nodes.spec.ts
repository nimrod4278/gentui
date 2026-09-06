import { describe, expect, it } from "vitest";
import { createRuntime, emptyInteractionState } from "gentui";
import type { InteractionState, UiDocument, UiNode } from "gentui";
import { createInMemoryRenderer, createTestRenderer } from "gentui-testing";

const document = (root: UiNode): UiDocument => ({ version: "1", id: "layout", root });
const render = (root: UiNode, columns = 12, rows = 4, state?: InteractionState) =>
  createInMemoryRenderer().render({ document: document(root), profile: { columns, rows }, state });
const text = (id: string, content: string): UiNode => ({ id, type: "text", props: { content } });
const button = (id: string, label = id): UiNode => ({
  id, type: "button", props: { label }, events: { activate: { name: id } },
});
const state = (partial: Partial<InteractionState> = {}): InteractionState => ({ ...emptyInteractionState(), ...partial });

// Test-only cell measurement, intentionally independent of the renderer's
// allocation code. These fixtures contain ASCII, combining text, CJK, and emoji.
const cells = (value: string): number => {
  let width = 0;
  for (const character of value.normalize("NFC")) {
    if (/\p{Mark}/u.test(character)) continue;
    width += /\p{Extended_Pictographic}/u.test(character) || /[界漢字]/u.test(character) ? 2 : 1;
  }
  return width;
};

const layouts: Array<{ name: string; root: UiNode; minimum: number }> = [
  { name: "stack", minimum: 1, root: { id: "layout", type: "stack", props: {}, children: [text("child", "e\u0301界🙂")] } },
  { name: "row", minimum: 1, root: { id: "layout", type: "row", props: {}, children: [text("child", "e\u0301界🙂")] } },
  { name: "panel", minimum: 2, root: { id: "layout", type: "panel", props: { title: "e\u0301界🙂" }, children: [text("child", "e\u0301界🙂")] } },
  { name: "tabs", minimum: 1, root: { id: "layout", type: "tabs", props: {}, children: [text("child", "e\u0301界🙂")] } },
];

describe.each(layouts)("$name shared layout contract", ({ root, minimum }) => {
  it("has a literal minimum-width frame and degrades safely one column below", () => {
    const atMinimum = render(root, minimum, 3);
    const below = render(root, minimum - 1, 3);
    expect(atMinimum).toMatchObject({ columns: minimum, rows: 3 });
    expect(atMinimum.lines.every((line) => cells(line) === minimum)).toBe(true);
    expect(below.lines.every((line) => cells(line) === minimum - 1)).toBe(true);
    if (root.type === "panel") expect(below.lines).toEqual(["│", "│", "│"]);
  });

  it("never paints outside a resized viewport or splits graphemes", () => {
    for (const [columns, rows] of [[3, 1], [5, 2], [9, 4]] as const) {
      const frame = render(root, columns, rows);
      expect(frame.lines).toHaveLength(rows);
      expect(frame.lines.every((line) => cells(line) === columns)).toBe(true);
      for (const line of frame.lines) {
        const markIndex = line.indexOf("\u0301");
        if (markIndex >= 0) expect(line[markIndex - 1]).toBe("e");
      }
    }
    const hostileChild = text("hostile", "\u001b[31me\u0301界🙂\u001b[0m");
    const hostile = { ...root, props: root.type === "panel" ? { title: "\u001b[31me\u0301界🙂\u001b[0m" } : root.props, children: [hostileChild] };
    expect(render(hostile, 5, 3).lines.join("")).not.toContain("\u001b");
  });

  it("is deterministic and preserves child/focus order", () => {
    const ordered: UiNode = { ...root, children: [button("first"), button("second")] };
    const first = render(ordered, 30, 6);
    const second = render(ordered, 30, 6);
    expect(second).toEqual(first);
    const expectedFocus = root.type === "tabs" ? ["first"] : ["first", "second"];
    expect(first.keyboardHelp.map((help) => help.nodeId)).toEqual(expectedFocus);
    expect(first.lines.join("\n")).toContain("first");
    if (root.type !== "tabs") {
      expect(first.lines.join("\n").indexOf("first")).toBeLessThan(first.lines.join("\n").indexOf("second"));
    }
  });

  it("has a bounded empty and deeply nested state", () => {
    const empty = render({ ...root, children: [] }, 8, 3);
    expect(empty.lines).toHaveLength(3);
    expect(empty.lines.every((line) => cells(line) === 8)).toBe(true);

    let nested: UiNode = text("leaf", "safe");
    for (let index = 0; index < 80; index += 1) {
      nested = { id: `nested-${index}`, type: root.type, props: root.props, children: [nested] };
    }
    expect(() => render(nested, 8, 3)).not.toThrow();
    expect(render(nested, 8, 3).lines).toHaveLength(3);
  });
});

describe("stack layout", () => {
  const stack: UiNode = { id: "stack", type: "stack", props: {}, children: [text("a", "A"), text("b", "B"), text("c", "C")] };

  it("stacks known-height children and clips overflow without overwriting rows", () => {
    expect(render(stack, 6, 2).lines).toEqual(["A     ", "B     "]);
    expect(render(stack, 6, 2, state({ scroll: { stack: 1 } })).lines).toEqual(["B     ", "C     "]);
  });

  it("preserves focused child and logical top line while resizing", () => {
    const interaction = state({ focusId: "b", scroll: { stack: 1 } });
    const controls: UiNode = { ...stack, children: [button("a", "A"), button("b", "B"), button("c", "C")] };
    expect(render(controls, 6, 1, interaction).lines).toEqual(["> B   "]);
    const taller = render(controls, 6, 3, interaction);
    expect(taller.lines).toEqual(["> B   ", "  C   ", "      "]);
    expect(taller.keyboardHelp.map((item) => item.nodeId)).toContain("b");
  });
});

describe("row layout", () => {
  it("allocates an odd 21 columns as literal 11/10 left-to-right shares", () => {
    const frame = render({ id: "row", type: "row", props: {}, children: [text("left", "left"), text("right", "right")] }, 21, 2);
    expect(frame.lines[0]).toBe("left".padEnd(11) + "right".padEnd(10));
  });

  it("wraps below two cells per child and keeps every child reachable", () => {
    const row: UiNode = { id: "row", type: "row", props: {}, children: [text("a", "A"), text("b", "B")] };
    expect(render(row, 4, 2).lines[0]).toBe("A B ");
    expect(render(row, 3, 2).lines).toEqual(["A  ", "B  "]);
  });

  it("does not drift after wide and combining graphemes", () => {
    const row: UiNode = { id: "row", type: "row", props: {}, children: [text("wide", "界X"), text("mark", "e\u0301Y")] };
    const line = render(row, 8, 1).lines[0]!;
    expect(line).toBe("界X ".concat("e\u0301Y  "));
    expect(cells(line)).toBe(8);
  });
});

describe("panel layout", () => {
  it("renders title, border, one-cell padding, and child at normal and minimum widths", () => {
    const panel: UiNode = { id: "panel", type: "panel", props: { title: "Info" }, children: [text("body", "Body")] };
    expect(render(panel, 12, 4).lines.slice(0, 3)).toEqual(["┌─Info─────┐", "│ Body     │", "└──────────┘"]);
    expect(render(panel, 2, 2).lines).toEqual(["┌┐", "└┘"]);
    expect(render(panel, 1, 3).lines).toEqual(["│", "│", "│"]);
  });

  it("sanitizes hostile titles and clips long titles without damaging borders", () => {
    const panel: UiNode = { id: "panel", type: "panel", props: { title: "\u001b]52;c;stolen\u0007 Very long 界🙂" }, children: [] };
    const top = render(panel, 10, 2).lines[0]!;
    expect(top.startsWith("┌")).toBe(true);
    expect(top.endsWith("┐")).toBe(true);
    expect(top).not.toContain("\u001b");
    expect(cells(top)).toBe(10);
  });

  it("keeps nested borders and content inside the viewport", () => {
    const nested: UiNode = { id: "outer", type: "panel", props: { title: "Outer" }, children: [
      { id: "inner", type: "panel", props: { title: "Inner" }, children: [text("body", "界界界 overflow")] },
    ] };
    const frame = render(nested, 14, 6);
    expect(frame.lines.every((line) => cells(line) === 14)).toBe(true);
    expect(frame.lines[0]?.startsWith("┌")).toBe(true);
    expect(frame.lines.some((line) => line.includes("Inner"))).toBe(true);
  });
});

describe("tabs layout and interaction", () => {
  const tabs = (children: UiNode[], events?: UiNode["events"]): UiDocument => ({
    version: "1", id: "tabs-document", root: { id: "tabs", type: "tabs", props: events ? { label: "Views" } : {}, children, ...(events ? { events } : {}) },
  });

  it("activates tabs with arrow keys without emitting a result", async () => {
    const { renderer, driver } = createTestRenderer();
    const session = await createRuntime({ renderer }).open({ document: tabs([text("one", "One"), text("two", "Two")]) });
    expect(await driver.press("ArrowRight")).toEqual({ status: "accepted" });
    expect(renderer.currentInteractionState?.activeTabId.tabs).toBe("two");
    expect(renderer.currentFrame?.lines[1]?.trim()).toBe("Two");
    expect(await session.wait({ timeoutMs: 0 })).toEqual({ status: "timeout" });
    await session.close();
  });

  it("emits only an explicitly configured tabs intent", async () => {
    const paired = createTestRenderer();
    const session = await createRuntime({ renderer: paired.renderer }).open({ document: tabs([text("one", "One")], { activate: { name: "choose-view", payload: { view: "one" } } }) });
    await paired.driver.setInteractionState({ focusId: "tabs" });
    expect(await paired.driver.press("Enter")).toEqual({ status: "accepted" });
    expect(await session.wait()).toMatchObject({ results: [{ type: "submit", intent: "choose-view", values: { view: "one" } }] });
    await session.close();
  });

  it("hides inactive content from focus and event dispatch", async () => {
    const { renderer, driver } = createTestRenderer();
    const session = await createRuntime({ renderer }).open({ document: tabs([button("front"), button("back")]) });
    expect(renderer.currentFrame?.keyboardHelp.map((item) => item.nodeId)).toEqual(["front"]);
    expect(await driver.activate("back")).toEqual({ status: "rejected", reason: "node_inactive" });
    await driver.press("ArrowRight");
    expect(renderer.currentFrame?.keyboardHelp.map((item) => item.nodeId)).toEqual(["back"]);
    await session.close();
  });

  it("preserves active ID after reorder and falls forward then backward after removal", async () => {
    const { renderer, driver } = createTestRenderer();
    const session = await createRuntime({ renderer }).open({ document: tabs([text("a", "A"), text("b", "B"), text("c", "C")]) });
    await driver.press("ArrowRight");
    await session.update({ sessionId: session.id, sequence: 1, document: tabs([text("c", "C"), text("b", "B"), text("a", "A")]) });
    expect(renderer.currentInteractionState?.activeTabId.tabs).toBe("b");
    await session.update({ sessionId: session.id, sequence: 2, document: tabs([text("c", "C"), text("a", "A")]) });
    expect(renderer.currentInteractionState?.activeTabId.tabs).toBe("a");
    await session.update({ sessionId: session.id, sequence: 3, document: tabs([text("c", "C")]) });
    expect(renderer.currentInteractionState?.activeTabId.tabs).toBe("c");
    await session.close();
  });

  it("keeps every tab reachable when all labels exceed the header width", async () => {
    const { renderer, driver } = createTestRenderer();
    const session = await createRuntime({ renderer, profile: { columns: 9, rows: 3 } }).open({
      document: tabs([text("alpha", "Alpha"), text("bravo", "Bravo"), text("charlie", "Charlie")]),
    });
    for (const [id, label] of [["alpha", "Alpha"], ["bravo", "Bravo"], ["charlie", "Charlie"]] as const) {
      expect(renderer.currentInteractionState?.activeTabId.tabs ?? "alpha").toBe(id);
      expect(renderer.currentFrame?.lines[1]?.trim()).toBe(label);
      expect(cells(renderer.currentFrame?.lines[0] ?? "")).toBe(9);
      await driver.press("ArrowRight");
    }
    await session.close();
  });
});
