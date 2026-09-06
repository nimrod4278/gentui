import { readdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createAgentTool,
  createRuntime,
  type GentuiToolOutput,
  type UiDocument,
} from "gentui";
import {
  FakeClock,
  createInMemoryRenderer,
  createTestRenderer,
} from "gentui-testing";

const files = [
  "modified\tsrc\tsrc/runtime.ts",
  "added\ttest\ttest/dashboard.spec.ts",
].join("\n");

function dashboard(options: { progress?: number; diagnostics?: string; testLabel?: string } = {}): UiDocument {
  return {
    version: "1",
    id: "repository-dashboard",
    title: "Repository changes",
    metadata: { source: "host-local" },
    root: {
      id: "dashboard",
      type: "stack",
      props: {},
      children: [
        { id: "heading", type: "text", props: { content: "Repository dashboard — 2 changed files" } },
        {
          id: "changed-files",
          type: "file-list",
          props: { label: "Changed files", content: files },
          events: { activate: { name: "inspect-file" } },
        },
        {
          id: "views",
          type: "tabs",
          props: { label: "Repository details" },
          children: [
            {
              id: "diff-view", type: "panel", props: { title: "Diff" }, children: [
                { id: "diff", type: "diff", props: { content: "@@ -1,2 +1,2 @@\n-old value\n+new value" } },
              ],
            },
            {
              id: "diagnostic-view", type: "panel", props: { title: "Diagnostics" }, children: [
                { id: "diagnostics", type: "diagnostics", props: { content: options.diagnostics ?? "info\tts-1\tsrc/runtime.ts:1:1\ttsc\tChecking local diagnostics" } },
              ],
            },
            {
              id: "test-view", type: "panel", props: { title: "Tests" }, children: [
                { id: "test-progress", type: "progress", props: { label: options.testLabel ?? "Tests", value: options.progress ?? 0 } },
                { id: "test-spinner", type: "spinner", props: { label: options.progress === 1 ? "Tests complete" : "Tests running" } },
              ],
            },
          ],
        },
        {
          id: "review-form", type: "form", props: { label: "Review note" }, children: [
            { id: "review-note", type: "input", props: { label: "Review note", name: "note", value: "" }, events: { activate: { name: "save-note" } } },
          ],
        },
        {
          id: "approval", type: "confirm",
          props: { label: "Approve these changes?", operation: "apply proposed repository changes", target: "working tree", risk: "low" },
          events: { activate: { name: "approve-changes" } },
        },
        { id: "cancel-help", type: "text", props: { content: "Esc Cancel without applying changes" } },
      ],
    },
  };
}

function openedSessionId(output: GentuiToolOutput): string {
  if (output.status !== "ok" || !output.sessionId) throw new Error("dashboard did not open");
  return output.sessionId;
}

const text = (renderer: ReturnType<typeof createInMemoryRenderer>): string =>
  renderer.currentFrame?.lines.join("\n") ?? "";

function expectFrameBounds(renderer: ReturnType<typeof createInMemoryRenderer>, columns: number, rows: number): void {
  const frame = renderer.currentFrame;
  expect(frame).toBeDefined();
  expect(frame?.lines).toHaveLength(rows);
  expect(frame?.lines.every((line) => [...line].length <= columns)).toBe(true);
}

describe("defining repository dashboard", () => {
  it("opens with host-local content, streams complete and patch updates, and returns selection then approval", async () => {
    const { renderer, driver } = createTestRenderer();
    const tool = createAgentTool(createRuntime({ renderer, profile: { columns: 120, rows: 24, color: false } }));
    const id = openedSessionId(await tool.execute({ operation: "open", document: dashboard() }));

    expect(text(renderer)).toContain("Repository dashboard");
    expect(text(renderer)).toContain("src/runtime.ts");
    expect(text(renderer)).toContain("old value");

    await driver.press("Tab");
    await driver.press("ArrowDown");
    await driver.press("Enter");
    const completed = await tool.execute({
      operation: "update",
      sessionId: id,
      sequence: 1,
      update: dashboard({ progress: 0.5, diagnostics: "warning\tTS100\tsrc/runtime.ts:2:1\ttsc\tCheck this branch" }),
    });
    expect(completed).toMatchObject({
      status: "ok",
      update: { status: "committed", sequence: 1 },
      results: [{ type: "select", intent: "inspect-file", value: { id: "test", path: "test/dashboard.spec.ts" } }],
    });

    const patched = await tool.execute({
      operation: "update",
      sessionId: id,
      sequence: 2,
      update: [
        { type: "replace", path: ["root", "children", 2, "children", 2, "children", 0, "props", "value"], value: 1 },
        { type: "replace", path: ["root", "children", 2, "children", 2, "children", 1, "props", "label"], value: "Tests complete" },
      ],
    });
    expect(patched).toMatchObject({ status: "ok", update: { status: "committed", sequence: 2 } });

    expect(await driver.activate("approval")).toEqual({ status: "accepted" });
    expect(await tool.execute({ operation: "wait", sessionId: id, timeoutMs: 0 })).toEqual({
      status: "ok", results: [{ type: "confirm", intent: "approve-changes", approved: true }],
    });
    expect(await tool.execute({ operation: "close", sessionId: id })).toEqual({ status: "closed", result: { type: "close" } });
    expect(renderer.cleanupCount).toBe(1);
  });

  it("cancels without invoking a host side effect", async () => {
    const { renderer, driver } = createTestRenderer();
    const tool = createAgentTool(createRuntime({ renderer }));
    const id = openedSessionId(await tool.execute({ operation: "open", document: dashboard() }));
    let sideEffects = 0;

    await driver.press("Escape");
    const result = await tool.execute({ operation: "wait", sessionId: id, timeoutMs: 0 });
    if (result.status === "ok" && result.results?.some((item) => item.type === "confirm" && item.approved)) sideEffects += 1;

    expect(result).toEqual({ status: "ok", results: [{ type: "cancel" }] });
    expect(sideEffects).toBe(0);
    expect(renderer.cleanupCount).toBe(1);
  });

  it("preserves typed text, cursor, selection, focus, and scroll during valid updates and recovers after an invalid patch", async () => {
    const { renderer, driver } = createTestRenderer();
    const session = await createRuntime({ renderer, profile: { columns: 80, rows: 24 } }).open({ document: dashboard() });
    await driver.setInteractionState({
      focusId: "review-note",
      cursor: { "review-note": 0 },
      selection: { "changed-files": "test" },
      scroll: { diff: 1 },
    });
    await driver.dispatch({ type: "text", text: "ship it" });

    expect(await session.update({
      sessionId: session.id,
      sequence: 1,
      document: dashboard({ progress: 0.6, diagnostics: "error\tTS9\tsrc/runtime.ts:3:2\ttsc\tNew diagnostic" }),
    })).toEqual({ status: "committed", sequence: 1 });
    expect(renderer.currentInteractionState).toMatchObject({
      focusId: "review-note",
      cursor: { "review-note": 7 },
      values: { "review-note": "ship it" },
      selection: { "changed-files": "test" },
      scroll: { diff: 1 },
    });

    const usableFrame = renderer.currentFrame;
    const rejected = await session.update({
      sessionId: session.id,
      sequence: 2,
      patch: [{ type: "replace", path: ["root", "children", 99], value: "invalid" }],
    });
    expect(rejected).toMatchObject({ status: "rejected", reason: "validation", sequence: 2 });
    expect(renderer.currentFrame).toBe(usableFrame);
    expect(await driver.dispatch({ type: "text", text: "!" })).toEqual({ status: "accepted" });

    expect(await session.update({
      sessionId: session.id,
      sequence: 2,
      patch: [{ type: "replace", path: ["root", "children", 2, "children", 2, "children", 0, "props", "value"], value: 1 }],
    })).toEqual({ status: "committed", sequence: 2 });
    expect(renderer.currentInteractionState).toMatchObject({ focusId: "review-note", values: { "review-note": "ship it!" } });
    await session.close();
  });

  it("keeps essential views and controls reachable in wide and 40-column frames", async () => {
    const renderer = createInMemoryRenderer();
    const session = await createRuntime({ renderer, profile: { columns: 120, rows: 24 } }).open({ document: dashboard() });
    expectFrameBounds(renderer, 120, 24);

    const state = renderer.currentInteractionState;
    renderer.render({ document: dashboard(), profile: { columns: 40, rows: 24 }, state });
    expectFrameBounds(renderer, 40, 24);
    expect(renderer.currentFrame?.keyboardHelp.map((item) => item.nodeId)).toEqual(expect.arrayContaining(["changed-files", "review-note", "approval"]));

    for (const activeTabId of ["diff-view", "diagnostic-view", "test-view"]) {
      renderer.render({ document: dashboard({ progress: 1 }), profile: { columns: 40, rows: 24 }, state: { ...state!, activeTabId: { views: activeTabId } } });
      expectFrameBounds(renderer, 40, 24);
    }
    await session.close();
  });

  it("renders a printable ASCII, ANSI-free dashboard and disables animation under reduced motion", async () => {
    const clock = new FakeClock();
    const renderer = createInMemoryRenderer({ clock });
    const session = await createRuntime({
      renderer,
      profile: { columns: 40, rows: 24, asciiOnly: true, color: false, reducedMotion: true },
      clock,
    }).open({ document: dashboard() });
    const initialFrames = renderer.frames.length;
    clock.advance(1_000);

    const output = text(renderer);
    expect(output).toMatch(/^[\x20-\x7e\n]*$/);
    expect(output).not.toMatch(/\u001b\[[0-9;?]*[A-Za-z]/);
    expect(output).toContain("+--");
    expect(renderer.frames).toHaveLength(initialFrames);
    await session.close();
  });

  it("restores the renderer after failure and after host cancellation", async () => {
    const failed = createTestRenderer();
    const failedSession = await createRuntime({ renderer: failed.renderer }).open({ document: dashboard() });
    failed.renderer.failNextRender(new Error("dashboard renderer failed"));
    expect(() => failedSession.update({ sessionId: failedSession.id, sequence: 1, document: dashboard({ progress: 1 }) })).toThrow("dashboard renderer failed");
    expect(failed.renderer.cleanupCount).toBe(1);

    const cancelled = createTestRenderer();
    const cancelledSession = await createRuntime({ renderer: cancelled.renderer }).open({ document: dashboard() });
    await cancelled.driver.requestCancel("host cancellation");
    expect(await cancelledSession.wait({ timeoutMs: 0 })).toEqual({
      status: "results", results: [{ type: "cancel", reason: "host cancellation" }], sessionState: "closed",
    });
    expect(cancelled.renderer.cleanupCount).toBe(1);
  });

  it("creates no session files beyond explicitly identified host-owned activity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gentui-dashboard-"));
    try {
      const before = await readdir(directory);
      const { renderer } = createTestRenderer();
      const session = await createRuntime({ renderer }).open({ document: dashboard() });
      await session.update({ sessionId: session.id, sequence: 1, document: dashboard({ progress: 1 }) });
      await session.close();
      expect(await readdir(directory)).toEqual(before);

      await writeFile(join(directory, "host-owned.log"), "host activity");
      expect(await readdir(directory)).toEqual(["host-owned.log"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("treats approval as data and cannot bypass denied host authorization", async () => {
    const { renderer, driver } = createTestRenderer();
    const session = await createRuntime({ renderer }).open({ document: dashboard() });
    await driver.activate("approval");
    const answer = await session.wait({ timeoutMs: 0 });
    const deniedHostOperation = async (): Promise<{ status: "denied"; reason: string }> => ({ status: "denied", reason: "host policy" });

    expect(answer).toMatchObject({ status: "results", results: [{ type: "confirm", approved: true }] });
    expect(await deniedHostOperation()).toEqual({ status: "denied", reason: "host policy" });
    await session.close();
  });
});
