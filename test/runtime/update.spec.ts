import { describe, it, expect } from "vitest";
import { createRuntime, applyPatch, DiagnosticCode } from "gentui";
import type { UiDocument, UiNode, UiPatchOp } from "gentui";
import { createInMemoryRenderer } from "gentui-testing";

// Behaviors for session.update(): atomic complete-document
// replacement and transactional set/replace/remove patch batches, gated by
// session identity and monotonically increasing sequence numbers. Exercised only
// through the public runtime interface plus the in-memory renderer adapter.

const doc = (id: string, ...texts: string[]): UiDocument => ({
  version: "1",
  id,
  root: {
    id: "root",
    type: "stack",
    props: {},
    children: texts.map((content, i) => ({
      id: `t${i}`,
      type: "text",
      props: { content },
    })),
  },
});

// The in-memory renderer surfaces the first non-empty text in DFS order, so the
// first child's content is the observable frame content.
const firstLine = (renderer: { currentFrame?: { lines: readonly string[] } }): string =>
  (renderer.currentFrame?.lines[0] ?? "").trimEnd();

describe("session.update() — atomic replacement and patching", () => {
  it("1. a valid replacement produces one new complete frame and advances sequence once", async () => {
    const renderer = createInMemoryRenderer();
    const runtime = createRuntime({ renderer });
    const session = await runtime.open({ document: doc("d", "one") });

    expect(renderer.frames).toHaveLength(1);
    expect(firstLine(renderer)).toBe("one");

    const result = await session.update({
      sessionId: session.id,
      sequence: 1,
      document: doc("d", "two"),
    });

    expect(result).toEqual({ status: "committed", sequence: 1 });
    expect(renderer.frames).toHaveLength(2);
    expect(firstLine(renderer)).toBe("two");

    await session.close();
  });

  it("2. a multi-operation patch produces one commit; no intermediate frame is observable", async () => {
    const renderer = createInMemoryRenderer();
    const runtime = createRuntime({ renderer });
    const session = await runtime.open({ document: doc("d", "one", "two", "three") });

    const result = await session.update({
      sessionId: session.id,
      sequence: 1,
      patch: [
        { type: "set", path: ["root", "children", 0, "props", "content"], value: "ONE" },
        { type: "remove", path: ["root", "children", 2] },
      ],
    });

    expect(result.status).toBe("committed");
    expect(renderer.frames).toHaveLength(2); // exactly one new frame for the batch
    expect(firstLine(renderer)).toBe("ONE");
    await session.close();
  });

  it("3. if operation 2 of 3 is invalid, operation 1 is not visible and the old document remains active", async () => {
    const renderer = createInMemoryRenderer();
    const runtime = createRuntime({ renderer });
    const session = await runtime.open({ document: doc("d", "one", "two") });

    const result = await session.update({
      sessionId: session.id,
      sequence: 1,
      patch: [
        { type: "set", path: ["root", "children", 0, "props", "content"], value: "ONE" },
        { type: "remove", path: ["root", "children", 9] }, // out of range
        { type: "set", path: ["root", "children", 1, "props", "content"], value: "TWO" },
      ],
    });

    expect(result.status).toBe("rejected");
    expect(renderer.frames).toHaveLength(1); // no commit at all
    expect(firstLine(renderer)).toBe("one"); // op 1 never became visible

    // The sequence did not advance: the same number 1 is still expected.
    const retry = await session.update({ sessionId: session.id, sequence: 1, document: doc("d", "fixed") });
    expect(retry.status).toBe("committed");
    expect(firstLine(renderer)).toBe("fixed");
    await session.close();
  });

  it("4. a structurally valid patch whose final document is invalid is rolled back entirely", async () => {
    const renderer = createInMemoryRenderer();
    const runtime = createRuntime({ renderer });
    const session = await runtime.open({ document: doc("d", "one") });

    // The assignment succeeds structurally, but an unknown node type fails
    // whole-document validation, so nothing is committed.
    const result = await session.update({
      sessionId: session.id,
      sequence: 1,
      patch: [{ type: "set", path: ["root", "children", 0, "type"], value: "bogus" }],
    });

    expect(result.status).toBe("rejected");
    if (result.status === "rejected" && result.reason === "validation") {
      expect(result.errors.some((e) => e.code === DiagnosticCode.UnknownNodeType)).toBe(true);
    } else {
      throw new Error("expected a validation rejection");
    }
    expect(renderer.frames).toHaveLength(1);
    expect(firstLine(renderer)).toBe("one");
    await session.close();
  });

  it("5. stale, duplicate, gap, and out-of-order sequence numbers return distinct outcomes without mutation", async () => {
    const renderer = createInMemoryRenderer();
    const runtime = createRuntime({ renderer });
    const session = await runtime.open({ document: doc("d", "base") });

    // Gap: expected 1 but received 2.
    const gap = await session.update({ sessionId: session.id, sequence: 2, document: doc("d", "gap") });
    expect(gap).toEqual({
      status: "rejected",
      reason: "gap",
      receivedSequence: 2,
      expectedSequence: 1,
      lastCommittedSequence: 0,
    });
    expect(firstLine(renderer)).toBe("base");
    expect(renderer.frames).toHaveLength(1);

    // Commit 1, then 2.
    expect((await session.update({ sessionId: session.id, sequence: 1, document: doc("d", "v1") })).status).toBe("committed");
    // Duplicate: 1 equals the last committed sequence.
    const dup = await session.update({ sessionId: session.id, sequence: 1, document: doc("d", "dup") });
    expect(dup).toMatchObject({ status: "rejected", reason: "duplicate", receivedSequence: 1, lastCommittedSequence: 1 });
    expect(firstLine(renderer)).toBe("v1");

    expect((await session.update({ sessionId: session.id, sequence: 2, document: doc("d", "v2") })).status).toBe("committed");
    // Stale / out-of-order: 1 arrives after 2 committed.
    const stale = await session.update({ sessionId: session.id, sequence: 1, document: doc("d", "stale") });
    expect(stale).toMatchObject({ status: "rejected", reason: "stale", receivedSequence: 1, lastCommittedSequence: 2 });
    expect(firstLine(renderer)).toBe("v2");
    expect(renderer.frames).toHaveLength(3); // only the two real commits added frames

    // Malformed sequence numbers are input-validation errors, not stale/gap.
    for (const seq of [-1, 1.5, Number.NaN]) {
      const bad = await session.update({ sessionId: session.id, sequence: seq, document: doc("d", "x") });
      expect(bad).toMatchObject({ status: "rejected", reason: "validation" });
      if (bad.status === "rejected" && bad.reason === "validation") {
        expect(bad.errors.some((e) => e.code === DiagnosticCode.InvalidSequence)).toBe(true);
      }
    }
    expect(firstLine(renderer)).toBe("v2");
    await session.close();
  });

  it("6. an update targeting another session cannot read or alter the active session", async () => {
    const renderer = createInMemoryRenderer();
    const runtime = createRuntime({ renderer });
    const session = await runtime.open({ document: doc("d", "safe") });

    const result = await session.update({ sessionId: "someone-elses-session", sequence: 1, document: doc("d", "hijack") });
    expect(result.status).toBe("rejected");
    if (result.status === "rejected" && result.reason === "validation") {
      expect(result.errors.some((e) => e.code === DiagnosticCode.InvalidSession)).toBe(true);
    } else {
      throw new Error("expected a validation rejection");
    }
    expect(firstLine(renderer)).toBe("safe");
    expect(renderer.frames).toHaveLength(1);

    // The session is untouched: a correctly targeted update at sequence 1 works.
    expect((await session.update({ sessionId: session.id, sequence: 1, document: doc("d", "ok") })).status).toBe("committed");
    await session.close();
  });

  it("7. array removal at first, middle, and last positions has literal results; out-of-range is rejected", () => {
    const base = doc("d", "a", "b", "c");
    const children = (d: UiDocument): string[] => (d.root.children ?? []).map((c: UiNode) => String(c.props.content));

    const first = applyPatch(base, [{ type: "remove", path: ["root", "children", 0] }]);
    const middle = applyPatch(base, [{ type: "remove", path: ["root", "children", 1] }]);
    const last = applyPatch(base, [{ type: "remove", path: ["root", "children", 2] }]);
    if (!first.ok || !middle.ok || !last.ok) throw new Error("expected removals to succeed");
    expect(children(first.document)).toEqual(["b", "c"]);
    expect(children(middle.document)).toEqual(["a", "c"]);
    expect(children(last.document)).toEqual(["a", "b"]);

    const outOfRange = applyPatch(base, [{ type: "remove", path: ["root", "children", 3] }]);
    expect(outOfRange.ok).toBe(false);
    // The base document is never mutated by a failed (or successful) patch.
    expect(children(base)).toEqual(["a", "b", "c"]);
  });

  it("8. prototype-pollution paths are rejected and do not alter global objects", async () => {
    const renderer = createInMemoryRenderer();
    const runtime = createRuntime({ renderer });
    const session = await runtime.open({ document: doc("d", "clean") });

    for (const key of ["__proto__", "constructor", "prototype"]) {
      const result = await session.update({
        sessionId: session.id,
        sequence: 1,
        patch: [{ type: "set", path: ["root", key, "polluted"], value: "yes" }],
      });
      expect(result.status).toBe("rejected");
    }
    // No global prototype was touched.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
    expect(firstLine(renderer)).toBe("clean");
    await session.close();
  });

  it("9. maximum patch count is accepted; maximum + 1 is rejected before applying work", () => {
    const base = doc("d", "x");
    const noop: UiPatchOp = { type: "set", path: ["root", "props"], value: {} };

    const atMax = applyPatch(base, Array.from({ length: 256 }, () => noop));
    expect(atMax.ok).toBe(true);

    const overMax = applyPatch(base, Array.from({ length: 257 }, () => noop));
    expect(overMax.ok).toBe(false);
    if (!overMax.ok) {
      expect(overMax.diagnostics.some((d) => d.code === DiagnosticCode.MaxPatchOpsExceeded)).toBe(true);
    }
  });

  it("9b. the runtime honors a configured maxPatchOps limit", async () => {
    const renderer = createInMemoryRenderer();
    const runtime = createRuntime({
      renderer,
      limits: { maxBytes: 65_536, maxDepth: 32, maxNodes: 1_000, maxTextLength: 4_096, maxPatchOps: 2, maxPendingResults: 100 },
    });
    const session = await runtime.open({ document: doc("d", "x") });
    const noop: UiPatchOp = { type: "set", path: ["root", "props"], value: {} };

    const overMax = await session.update({ sessionId: session.id, sequence: 1, patch: [noop, noop, noop] });
    expect(overMax.status).toBe("rejected");
    if (overMax.status === "rejected" && overMax.reason === "validation") {
      expect(overMax.errors.some((d) => d.code === DiagnosticCode.MaxPatchOpsExceeded)).toBe(true);
    } else {
      throw new Error("expected a validation rejection");
    }
    expect(renderer.frames).toHaveLength(1); // rejected before any commit
    await session.close();
  });

  it("10. an update must carry exactly one of document or patch", async () => {
    const renderer = createInMemoryRenderer();
    const runtime = createRuntime({ renderer });
    const session = await runtime.open({ document: doc("d", "x") });

    const neither = await session.update({ sessionId: session.id, sequence: 1 });
    const both = await session.update({
      sessionId: session.id,
      sequence: 1,
      document: doc("d", "y"),
      patch: [{ type: "set", path: ["root", "props"], value: {} }],
    });

    for (const r of [neither, both]) {
      expect(r.status).toBe("rejected");
      if (r.status === "rejected" && r.reason === "validation") {
        expect(r.errors.some((e) => e.code === DiagnosticCode.InvalidUpdate)).toBe(true);
      } else {
        throw new Error("expected a validation rejection");
      }
    }
    expect(renderer.frames).toHaveLength(1);
    await session.close();
  });
});
