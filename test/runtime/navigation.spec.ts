import { describe, expect, it } from "vitest";
import { createRuntime } from "gentui";
import type { UiDocument } from "gentui";
import { createTestRenderer } from "gentui-testing";

const doc: UiDocument = {
  version: "1", id: "keys", root: { id: "root", type: "stack", props: {}, children: [
    { id: "first", type: "button", props: { label: "First" }, events: { activate: { name: "first" } } },
    { id: "disabled", type: "button", props: { label: "Disabled", disabled: true }, events: { activate: { name: "disabled" } } },
    { id: "last", type: "button", props: { label: "Last" }, events: { activate: { name: "last" } } },
  ] },
};

describe("keyboard navigation and event safety", () => {
  it("Tab and Shift+Tab traverse enabled controls and wrap", async () => {
    const { renderer, driver } = createTestRenderer();
    const session = await createRuntime({ renderer }).open({ document: doc });

    expect(await driver.press("Tab")).toEqual({ status: "accepted" });
    expect(renderer.currentInteractionState?.focusId).toBe("first");
    await driver.press("Tab");
    expect(renderer.currentInteractionState?.focusId).toBe("last");
    await driver.press("Tab");
    expect(renderer.currentInteractionState?.focusId).toBe("first");
    await driver.press("Shift+Tab");
    expect(renderer.currentInteractionState?.focusId).toBe("last");
    await session.close();
  });

  it("disabled, hidden, removed, and background-tab controls cannot emit stale results", async () => {
    const tabDoc: UiDocument = {
      version: "1", id: "tabs", root: { id: "tabs", type: "tabs", props: {}, children: [
        { id: "front", type: "button", props: { label: "Front" }, events: { activate: { name: "front" } } },
        { id: "back", type: "button", props: { label: "Back" }, events: { activate: { name: "back" } } },
      ] },
    };
    const { renderer, driver } = createTestRenderer();
    const session = await createRuntime({ renderer }).open({ document: doc });

    expect(await driver.activate("disabled")).toEqual({ status: "rejected", reason: "node_disabled" });
    await session.update({
      sessionId: session.id,
      sequence: 1,
      document: { ...doc, root: { ...doc.root, children: [doc.root.children![0]!, { ...doc.root.children![2]!, props: { label: "Last", hidden: true } }] } },
    });
    expect(await driver.activate("last")).toEqual({ status: "rejected", reason: "node_hidden" });
    await session.update({ sessionId: session.id, sequence: 2, document: { ...doc, root: { ...doc.root, children: [doc.root.children![0]!] } } });
    expect(await driver.activate("last")).toEqual({ status: "rejected", reason: "unknown_node" });
    await session.close();

    const tabs = await createRuntime({ renderer }).open({ document: tabDoc });
    expect(await driver.activate("back")).toEqual({ status: "rejected", reason: "node_inactive" });
    expect(await tabs.wait({ timeoutMs: 0 })).toEqual({ status: "timeout" });
    await tabs.close();
  });

  it("rejects forged intent and payload, and emits only the committed payload", async () => {
    const bound: UiDocument = {
      version: "1", id: "bound", root: {
        id: "save", type: "button", props: { label: "Save" },
        events: { activate: { name: "save", payload: { revision: 3 } } },
      },
    };
    const { renderer, driver } = createTestRenderer();
    const session = await createRuntime({ renderer }).open({ document: bound });

    expect(await driver.dispatch({ type: "activate", nodeId: "save", intent: "delete" })).toEqual({ status: "rejected", reason: "intent_not_allowed" });
    expect(await driver.dispatch({ type: "activate", nodeId: "save", intent: "save", payload: { revision: 4 } })).toEqual({ status: "rejected", reason: "payload_not_allowed" });
    expect(await driver.activate("save")).toEqual({ status: "accepted" });
    expect(await session.wait()).toEqual({
      status: "results", sessionState: "open",
      results: [{ type: "submit", intent: "save", values: { revision: 3 } }],
    });
    await session.close();
  });

  it.each(["Escape", "Ctrl+C"] as const)("%s cancels from normal, editing, and confirmation focus", async (key) => {
    for (const node of [
      doc.root.children![0]!,
      { id: "editor", type: "input", props: { label: "Name" }, events: { activate: { name: "submit" } } },
      { id: "confirmation", type: "confirm", props: { label: "Continue?" }, events: { activate: { name: "confirm" } } },
    ]) {
      const { renderer, driver } = createTestRenderer();
      const session = await createRuntime({ renderer }).open({ document: { version: "1", id: "cancel", root: node } });
      await driver.setInteractionState({ focusId: node.id });
      expect(await driver.press(key)).toEqual({ status: "accepted" });
      expect(await session.wait()).toEqual({ results: [{ type: "cancel" }], status: "results", sessionState: "closed" });
      expect(await driver.press(key)).toEqual({ status: "rejected", reason: "session_closed" });
      await session.close();
    }
  });

  it("publishes accessible labels and keyboard paths for every focusable control", async () => {
    const controls: UiDocument = {
      version: "1", id: "controls", root: { id: "root", type: "stack", props: {}, children: [
        { id: "input", type: "input", props: { label: "Name" }, events: { activate: { name: "input" } } },
        { id: "select", type: "select", props: { label: "Branch" }, events: { activate: { name: "select" } } },
        { id: "checkbox", type: "checkbox", props: { label: "Include tests" }, events: { activate: { name: "checkbox" } } },
        { id: "confirm", type: "confirm", props: { label: "Continue?" }, events: { activate: { name: "confirm" } } },
        { id: "button", type: "button", props: { label: "Save" }, events: { activate: { name: "button" } } },
      ] },
    };
    const { renderer } = createTestRenderer();
    const runtime = createRuntime({ renderer });
    const session = await runtime.open({ document: controls });

    expect(renderer.currentFrame?.keyboardHelp).toEqual([
      { nodeId: "input", label: "Name", focusKeys: ["Tab", "Shift+Tab"], activateKeys: ["Enter"] },
      { nodeId: "select", label: "Branch", focusKeys: ["Tab", "Shift+Tab"], activateKeys: ["Enter"] },
      { nodeId: "checkbox", label: "Include tests", focusKeys: ["Tab", "Shift+Tab"], activateKeys: ["Enter"] },
      { nodeId: "confirm", label: "Continue?", focusKeys: ["Tab", "Shift+Tab"], activateKeys: ["Enter"] },
      { nodeId: "button", label: "Save", focusKeys: ["Tab", "Shift+Tab"], activateKeys: ["Enter"] },
    ]);
    expect(runtime.catalog().components.filter((component) => component.keyboard !== undefined).every(
      (component) => component.accessibleLabelProp === "label" && component.keyboard?.includes("Enter"),
    )).toBe(true);
    await session.close();
  });

  it("rejects an empty or whitespace-only accessible label before rendering", async () => {
    const { renderer } = createTestRenderer();
    await expect(createRuntime({ renderer }).open({
      document: { version: "1", id: "bad-label", root: { id: "b", type: "button", props: { label: "  " }, events: { activate: { name: "go" } } } },
    })).rejects.toThrow(/rejected/i);
    expect(renderer.frames).toHaveLength(0);
  });
});
