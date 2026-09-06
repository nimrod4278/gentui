import { describe, expect, it } from "vitest";
import { createInMemoryRenderer, createTestRenderer } from "gentui-testing";
import { createRuntime, validateDocument } from "gentui";
import type { UiDocument, UiNode } from "gentui";

const render = (node: UiNode) => createInMemoryRenderer().render({
  document: { version: "1", id: "input", root: node }, profile: { columns: 30, rows: 2 },
});

describe("input and action nodes", () => {
  it("renders accessible labels for input controls", () => {
    expect(render({ id: "i", type: "input", props: { label: "Name", value: "Ada" } }).lines[0].trimEnd()).toBe("Name: Ada");
    expect(render({ id: "c", type: "checkbox", props: { label: "Ready", checked: true } }).lines[0].trimEnd()).toBe("[x] Ready");
    expect(render({ id: "b", type: "button", props: { label: "Submit" } }).lines[0].trimEnd()).toBe("Submit");
  });

  it("masks secret input values", () => {
    expect(render({ id: "i", type: "input", props: { label: "Token", value: "secret", secret: true } }).lines[0].trimEnd()).toBe("Token: ******");
  });

  it("edits input at grapheme boundaries and enforces max length on paste and submit", async () => {
    const { renderer, driver } = createTestRenderer();
    const document: UiDocument = { version: "1", id: "d", root: { id: "i", type: "input", props: { label: "Name", value: "A界🙂", maxLength: 4, required: true }, events: { activate: { name: "save" } } } };
    const session = await createRuntime({ renderer }).open({ document });
    await driver.setInteractionState({ focusId: "i" });
    await driver.press("ArrowLeft");
    await driver.press("Backspace");
    await driver.dispatch({ type: "text", text: "e\u0301" });
    expect(renderer.currentInteractionState?.values.i).toBe("Aé🙂");
    expect(renderer.currentInteractionState?.cursor.i).toBe(2);
    await driver.press("Delete");
    expect(renderer.currentInteractionState?.values.i).toBe("Aé");
    await expect(driver.dispatch({ type: "paste", text: "X\u001b[2JYZ" })).resolves.toMatchObject({ status: "rejected", reason: "max_length" });
    expect(renderer.currentInteractionState?.values.i).toBe("AéX[");
    expect(renderer.currentFrame?.lines.join("\n")).not.toContain("\u001b");
    await driver.press("Enter");
    expect(await session.wait()).toMatchObject({ results: [{ type: "submit", intent: "save", values: { i: "AéX[" } }] });
    await session.close();
  });

  it("preserves local input and cursor across unrelated updates and resets only explicitly", async () => {
    const { renderer, driver } = createTestRenderer();
    const doc = (label: string): UiDocument => ({ version: "1", id: "d", root: { id: "i", type: "input", props: { label, value: "model" }, events: { activate: { name: "save" } } } });
    const session = await createRuntime({ renderer }).open({ document: doc("Name") });
    await driver.setInteractionState({ focusId: "i", values: { i: "local" }, cursor: { i: 2 } });
    await session.update({ sessionId: session.id, sequence: 1, document: doc("Display name") });
    expect(renderer.currentInteractionState).toMatchObject({ values: { i: "local" }, cursor: { i: 2 } });
    await session.update({ sessionId: session.id, sequence: 2, document: doc("Display name"), reset: { nodeIds: ["i"], fields: ["values", "cursor"] } });
    expect(renderer.currentInteractionState?.values.i).toBeUndefined();
    expect(renderer.currentInteractionState?.cursor.i).toBeUndefined();
    await session.close();
  });

  it("never exposes a locally edited secret in frames", async () => {
    const { renderer, driver } = createTestRenderer();
    const session = await createRuntime({ renderer }).open({ document: { version: "1", id: "d", root: { id: "i", type: "input", props: { label: "Token", secret: true } } } });
    await driver.setInteractionState({ focusId: "i" });
    await driver.dispatch({ type: "paste", text: "top-secret" });
    expect(renderer.frames.every((frame) => !frame.lines.join("\n").includes("top-secret"))).toBe(true);
    await session.close();
  });

  it("navigates typed select options, skips disabled entries, and rejects forged selections", async () => {
    const options = [
      { id: "a", label: "Alpha", value: 1 }, { id: "b", label: "Blocked", value: 2, disabled: true }, { id: "c", label: "Charlie", value: { code: 3 } },
    ];
    const { renderer, driver } = createTestRenderer();
    const doc = (items: unknown[]): UiDocument => ({ version: "1", id: "d", root: { id: "s", type: "select", props: { label: "Choice", options: items }, events: { activate: { name: "choose" } } } });
    const session = await createRuntime({ renderer }).open({ document: doc(options) });
    await driver.setInteractionState({ focusId: "s" });
    await driver.press("ArrowDown");
    expect(renderer.currentInteractionState?.selection.s).toBe("c");
    await driver.press("Enter");
    expect(await session.wait()).toMatchObject({ results: [{ type: "select", intent: "choose", value: { code: 3 } }] });
    await session.update({ sessionId: session.id, sequence: 1, document: doc([options[0]!]) });
    await driver.setInteractionState({ selection: { s: "forged" } });
    expect(await driver.press("Enter")).toMatchObject({ status: "rejected", reason: "no_selectable_item" });
    await session.close();
  });

  it("preserves select ID across reorder, falls back positionally on removal, and handles unavailable options", async () => {
    const { renderer, driver } = createTestRenderer();
    const node = (options: unknown[]): UiDocument => ({ version: "1", id: "d", root: { id: "s", type: "select", props: { label: "Choice", options }, events: { activate: { name: "choose" } } } });
    const a = { id: "a", label: "A", value: "a" }, b = { id: "b", label: "B", value: "b" }, c = { id: "c", label: "C", value: "c" };
    const session = await createRuntime({ renderer }).open({ document: node([a, b, c]) });
    await driver.setInteractionState({ focusId: "s", selection: { s: "b" } });
    await session.update({ sessionId: session.id, sequence: 1, document: node([c, b, a]) });
    expect(renderer.currentInteractionState?.selection.s).toBe("b");
    await session.update({ sessionId: session.id, sequence: 2, document: node([c, a]) });
    expect(renderer.currentInteractionState?.selection.s).toBe("a");
    await session.update({ sessionId: session.id, sequence: 3, document: node([]) });
    expect(await driver.press("ArrowDown")).toMatchObject({ status: "rejected", reason: "no_selectable_item" });
    await session.update({ sessionId: session.id, sequence: 4, document: node([{ ...a, disabled: true }]) });
    expect(await driver.press("ArrowDown")).toMatchObject({ status: "rejected", reason: "no_selectable_item" });
    await session.close();
  });

  it("toggles checkbox once per Enter, emits booleans, preserves state, and renders disabled state without color", async () => {
    const { renderer, driver } = createTestRenderer();
    const doc = (label: string, disabled = false): UiDocument => ({ version: "1", id: "d", root: { id: "c", type: "checkbox", props: { label, checked: false, disabled }, events: { activate: { name: "toggle" } } } });
    const session = await createRuntime({ renderer, profile: { columns: 40, rows: 2, asciiOnly: true, color: false } }).open({ document: doc("Ready") });
    await driver.setInteractionState({ focusId: "c" });
    await driver.press("Enter");
    expect(await session.wait()).toMatchObject({ results: [{ type: "select", value: true }] });
    await session.update({ sessionId: session.id, sequence: 1, document: doc("Still ready") });
    expect(renderer.currentInteractionState?.values.c).toBe(true);
    await session.update({ sessionId: session.id, sequence: 2, document: doc("Still ready"), reset: { nodeIds: ["c"], fields: ["values"] } });
    expect(renderer.currentInteractionState?.values.c).toBeUndefined();
    await session.update({ sessionId: session.id, sequence: 3, document: doc("Still ready", true) });
    expect(renderer.currentFrame?.lines[0]).toContain("[disabled]");
    expect(await driver.activate("c")).toMatchObject({ status: "rejected", reason: "node_disabled" });
    await session.close();
  });

  it("shows complete confirmation context, requires high-risk gesture, and returns data only", async () => {
    const { renderer, driver } = createTestRenderer();
    const confirm = (operation: string): UiDocument => ({ version: "1", id: "d", root: { id: "c", type: "confirm", props: { label: "Approve?", operation, target: "prod", arguments: "--force", risk: "high" }, events: { activate: { name: "approval" } } } });
    const session = await createRuntime({ renderer, profile: { columns: 40, rows: 6, asciiOnly: true, color: false } }).open({ document: confirm("deploy") });
    expect(renderer.currentFrame?.lines.map((line) => line.trimEnd()).slice(0, 5)).toEqual(["Approve?", "Operation: deploy", "Target: prod", "Arguments: --force", "Risk: high"]);
    await driver.setInteractionState({ focusId: "c" });
    expect(await driver.press("Enter")).toMatchObject({ status: "rejected", reason: "high_risk_gesture_required" });
    expect(await driver.press("Ctrl+Enter")).toMatchObject({ status: "accepted" });
    expect(await session.wait()).toMatchObject({ results: [{ type: "confirm", intent: "approval", approved: true }] });
    expect(await driver.dispatch({ type: "confirm", nodeId: "c", approved: false })).toMatchObject({ status: "accepted" });
    expect(await session.wait()).toMatchObject({ results: [{ type: "confirm", approved: false }] });
    await session.close();
  });

  it("rejects a pending confirmation after its operation summary changes", async () => {
    const { renderer, driver } = createTestRenderer();
    const doc = (target: string): UiDocument => ({ version: "1", id: "d", root: { id: "c", type: "confirm", props: { label: "Approve?", operation: "delete", target, risk: "low" }, events: { activate: { name: "approval" } } } });
    const session = await createRuntime({ renderer }).open({ document: doc("a") });
    await driver.press("Tab");
    await session.update({ sessionId: session.id, sequence: 1, document: doc("b") });
    expect(await driver.press("Enter")).toMatchObject({ status: "rejected", reason: "stale_confirmation" });
    await session.close();
  });

  it("activates a focused button exactly once with only bound payload and visible focus", async () => {
    const { renderer, driver } = createTestRenderer();
    const session = await createRuntime({ renderer }).open({ document: { version: "1", id: "d", root: { id: "b", type: "button", props: { label: "Save" }, events: { activate: { name: "save", payload: { scope: "safe" } } } } } });
    await driver.press("Tab");
    expect(renderer.currentFrame?.lines[0]?.trimEnd()).toBe("> Save");
    await driver.press("Enter");
    expect(await session.wait()).toMatchObject({ results: [{ type: "submit", intent: "save", values: { scope: "safe" } }] });
    expect(await driver.dispatch({ type: "activate", nodeId: "b", payload: { scope: "forged" } })).toMatchObject({ status: "rejected", reason: "payload_not_allowed" });
    await session.close();
  });

  it("submits only its form, focuses the first invalid field, and preserves values across label updates", async () => {
    const { renderer, driver } = createTestRenderer();
    const doc = (firstLabel: string, required = true): UiDocument => ({ version: "1", id: "d", root: { id: "root", type: "stack", props: {}, children: [
      { id: "f1", type: "form", props: {}, children: [
        { id: "a1", type: "input", props: { label: firstLabel, name: "name", required } },
        { id: "a2", type: "input", props: { label: "Second", name: "other", required } },
        { id: "submit1", type: "button", props: { label: "Submit one", form: "f1" }, events: { activate: { name: "submit-one" } } },
      ] },
      { id: "f2", type: "form", props: {}, children: [
        { id: "b1", type: "input", props: { label: "Also name", name: "name", value: "form-two" } },
        { id: "submit2", type: "button", props: { label: "Submit two", form: "f2" }, events: { activate: { name: "submit-two" } } },
      ] },
    ] } });
    const session = await createRuntime({ renderer }).open({ document: doc("First") });
    expect(await driver.activate("submit1")).toMatchObject({ status: "rejected", reason: "field_invalid" });
    expect(renderer.currentInteractionState?.focusId).toBe("a1");
    await driver.setInteractionState({ values: { a1: "local-a", a2: "local-b" } });
    await session.update({ sessionId: session.id, sequence: 1, document: doc("Renamed") });
    expect(renderer.currentInteractionState?.values).toMatchObject({ a1: "local-a", a2: "local-b", b1: "form-two" });
    await driver.activate("submit1");
    expect(await session.wait()).toMatchObject({ results: [{ type: "submit", intent: "submit-one", values: { name: "local-a", other: "local-b" } }] });
    await session.close();
  });

  it("uses only the renderer/result seam when a capability-denial adapter is installed", async () => {
    const base = createInMemoryRenderer();
    const denied = new Proxy(base, {
      get(target, property, receiver) {
        if (["filesystem", "network", "process", "model"].includes(String(property))) throw new Error(`forbidden capability: ${String(property)}`);
        return Reflect.get(target, property, receiver);
      },
    });
    const controls: UiNode[] = [
      { id: "i", type: "input", props: { label: "Input" }, events: { activate: { name: "input" } } },
      { id: "s", type: "select", props: { label: "Select", options: [{ id: "one", label: "One", value: 1 }] }, events: { activate: { name: "select" } } },
      { id: "c", type: "checkbox", props: { label: "Check" }, events: { activate: { name: "check" } } },
      { id: "confirm", type: "confirm", props: { label: "Confirm", risk: "low" }, events: { activate: { name: "confirm" } } },
      { id: "b", type: "button", props: { label: "Button" }, events: { activate: { name: "button" } } },
    ];
    const session = await createRuntime({ renderer: denied }).open({ document: { version: "1", id: "d", root: { id: "root", type: "stack", props: {}, children: controls } } });
    for (const control of controls) expect(base.dispatch({ type: "activate", nodeId: control.id }).status).not.toBe("rejected");
    const result = await session.wait();
    expect(result.results.length).toBe(5);
    await session.close();
  });

  it("validates control constraints and keeps disabled controls out of keyboard reach", () => {
    const invalid = validateDocument({ version: "1", id: "d", root: { id: "i", type: "input", props: { label: "Name", maxLength: -1 } } });
    expect(invalid.ok).toBe(false);
    const frame = render({ id: "i", type: "input", props: { label: "Name", disabled: true }, events: { activate: { name: "save" } } });
    expect(frame.keyboardHelp).toEqual([]);
  });
});
