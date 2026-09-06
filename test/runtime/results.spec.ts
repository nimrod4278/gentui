import { describe, it, expect } from "vitest";
import { createRuntime, DEFAULT_LIMITS, MAX_WAIT_MS } from "gentui";
import type { DocumentLimits, UiDocument } from "gentui";
import { createTestRenderer, FakeClock } from "gentui-testing";

const submit = (intent: string): { type: "submit"; intent: string; values: Record<string, unknown> } => ({
  type: "submit",
  intent,
  values: {},
});

const withLimits = (over: Partial<DocumentLimits>): DocumentLimits => ({ ...DEFAULT_LIMITS, ...over });

const flush = (): Promise<void> => Promise.resolve();

// Result queue, wait, cancellation, and timeout. Results are produced
// only through the real renderer->runtime ingress seam (a button `activate`
// tracer), never injected directly into the queue.

const buttonDoc = (id: string, intent: string): UiDocument => ({
  version: "1",
  id: "doc",
  root: {
    id,
    type: "button",
    props: { label: "Continue" },
    events: { activate: { name: intent } },
  },
});

describe("result ingress and wait()", () => {
  it("A. a button activation becomes exactly one queued submit result drained by wait()", async () => {
    const { renderer, driver } = createTestRenderer();
    const runtime = createRuntime({ renderer });
    const session = await runtime.open({ document: buttonDoc("continue", "continue") });

    const outcome = await driver.dispatch({ type: "activate", nodeId: "continue" });
    expect(outcome).toEqual({ status: "accepted" });

    const waited = await session.wait();
    expect(waited).toEqual({
      status: "results",
      results: [{ type: "submit", intent: "continue", values: {} }],
      sessionState: "open",
    });

    await session.close();
  });

  it("1. three results are returned in FIFO order and never returned again", async () => {
    const { renderer, driver } = createTestRenderer();
    const session = await createRuntime({ renderer }).open({ document: buttonDoc("b", "go") });

    await driver.activate("b");
    await driver.activate("b");
    await driver.activate("b");

    const drained = await session.wait();
    expect(drained).toEqual({ status: "results", results: [submit("go"), submit("go"), submit("go")], sessionState: "open" });

    // Nothing is re-delivered; a second non-blocking poll times out.
    expect(await session.wait({ timeoutMs: 0 })).toEqual({ status: "timeout" });
    await session.close();
  });

  it("2. wait() blocks under fake time until a result arrives, then returns immediately", async () => {
    const clock = new FakeClock();
    const { renderer, driver } = createTestRenderer();
    const session = await createRuntime({ renderer, clock }).open({ document: buttonDoc("b", "go") });

    let resolved = false;
    const p = session.wait({ timeoutMs: 1000 }).then((r) => {
      resolved = true;
      return r;
    });

    await flush();
    expect(resolved).toBe(false);
    clock.advance(500);
    await flush();
    expect(resolved).toBe(false);

    await driver.activate("b");
    expect(await p).toEqual({ status: "results", results: [submit("go")], sessionState: "open" });
    expect(resolved).toBe(true);
    await session.close();
  });

  it("3. timeout returns {status:'timeout'} without closing the session or consuming a later result", async () => {
    const clock = new FakeClock();
    const { renderer, driver } = createTestRenderer();
    const session = await createRuntime({ renderer, clock }).open({ document: buttonDoc("b", "go") });

    const p = session.wait({ timeoutMs: 1000 });
    clock.advance(1000);
    expect(await p).toEqual({ status: "timeout" });

    // Session is still open and a later result is not lost.
    await driver.activate("b");
    expect(await session.wait()).toEqual({ status: "results", results: [submit("go")], sessionState: "open" });
    await session.close();
  });

  it("4. the timeout boundary has a deterministic winner and never drops the loser's result", async () => {
    const clock = new FakeClock();
    const { renderer, driver } = createTestRenderer();
    const runtime = createRuntime({ renderer, clock });

    // Result processed before the timer fires -> results (the timer is cleared).
    const s1 = await runtime.open({ document: buttonDoc("b", "go") });
    const p1 = s1.wait({ timeoutMs: 1000 });
    await driver.activate("b");
    clock.advance(1000);
    expect(await p1).toEqual({ status: "results", results: [submit("go")], sessionState: "open" });
    await s1.close();

    // Timer fires first -> timeout, and the later result survives for the next wait.
    const s2 = await runtime.open({ document: buttonDoc("b", "go") });
    const p2 = s2.wait({ timeoutMs: 1000 });
    clock.advance(1000);
    expect(await p2).toEqual({ status: "timeout" });
    await driver.activate("b");
    expect((await s2.wait()).status).toBe("results");
    await s2.close();
  });

  it("5. close wakes a pending waiter with {status:'closed'}", async () => {
    const { renderer } = createTestRenderer();
    const session = await createRuntime({ renderer }).open({ document: buttonDoc("b", "go") });

    const p = session.wait();
    await flush();
    await session.close();
    expect(await p).toEqual({ status: "closed" });
  });

  it("6. user cancellation drains a terminal {type:'cancel'} then closes the session", async () => {
    const { renderer, driver } = createTestRenderer();
    const session = await createRuntime({ renderer }).open({ document: buttonDoc("b", "go") });

    const p = session.wait();
    await flush();
    expect(await driver.requestCancel("user cancelled")).toEqual({ status: "accepted" });

    expect(await p).toEqual({
      status: "results",
      results: [{ type: "cancel", reason: "user cancelled" }],
      sessionState: "closed",
    });
    // The terminal is delivered once; the session is now closed.
    expect(await session.wait()).toEqual({ status: "closed" });
    expect(renderer.currentFrame).toBeUndefined();
  });

  it("7. capacity is enforced with backpressure; existing results and a terminal are still delivered", async () => {
    const { renderer, driver } = createTestRenderer();
    const session = await createRuntime({ renderer, limits: withLimits({ maxPendingResults: 2 }) }).open({
      document: buttonDoc("b", "go"),
    });

    expect(await driver.activate("b")).toEqual({ status: "accepted" });
    expect(await driver.activate("b")).toEqual({ status: "accepted" }); // == capacity
    const over = await driver.activate("b");
    expect(over).toEqual({ status: "backpressured", reason: "result_queue_full", pendingResults: 2, capacity: 2 });

    // A reserved slot always admits a terminal, even when normal results are full.
    expect(await driver.requestCancel()).toEqual({ status: "accepted" });

    const drained = await session.wait();
    expect(drained.status).toBe("results");
    if (drained.status !== "results") throw new Error("unreachable");
    expect(drained.results).toEqual([submit("go"), submit("go"), { type: "cancel" }]);
    expect(drained.sessionState).toBe("closed");
    // The rejected attempt is reported once, value-free, then cleared.
    expect(drained.notices).toEqual([{ code: "result_backpressure", rejectedAttempts: 1 }]);
  });

  it("7b. draining relieves backpressure and re-enables acceptance; the notice is not repeated", async () => {
    const { renderer, driver } = createTestRenderer();
    const session = await createRuntime({ renderer, limits: withLimits({ maxPendingResults: 1 }) }).open({
      document: buttonDoc("b", "go"),
    });

    expect((await driver.activate("b")).status).toBe("accepted");
    expect((await driver.activate("b")).status).toBe("backpressured");

    const first = await session.wait();
    if (first.status !== "results") throw new Error("unreachable");
    expect(first.notices).toEqual([{ code: "result_backpressure", rejectedAttempts: 1 }]);

    // Capacity is free again; a new result is accepted and carries no stale notice.
    expect((await driver.activate("b")).status).toBe("accepted");
    const second = await session.wait();
    if (second.status !== "results") throw new Error("unreachable");
    expect(second.notices).toBeUndefined();
    await session.close();
  });

  it("8. a slow agent does not block ingress: dispatch accepts synchronously with no waiter", async () => {
    const { renderer } = createTestRenderer();
    const session = await createRuntime({ renderer }).open({ document: buttonDoc("b", "go") });

    // No wait() is pending; dispatch returns synchronously (not blocked on polling).
    const o1 = renderer.dispatch({ type: "activate", nodeId: "b" });
    const o2 = renderer.dispatch({ type: "activate", nodeId: "b" });
    expect(o1).toEqual({ status: "accepted" });
    expect(o2).toEqual({ status: "accepted" });

    const drained = await session.wait();
    expect(drained).toEqual({ status: "results", results: [submit("go"), submit("go")], sessionState: "open" });
    await session.close();
  });

  it("rejects unknown, disallowed-event, and unbound interactions without producing a result", async () => {
    const { renderer, driver } = createTestRenderer();
    const doc: UiDocument = {
      version: "1",
      id: "doc",
      root: {
        id: "root",
        type: "stack",
        props: {},
        children: [
          { id: "label", type: "text", props: { content: "hi" } },
          { id: "unbound", type: "button", props: { label: "No intent" } },
        ],
      },
    };
    const session = await createRuntime({ renderer }).open({ document: doc });

    expect(await driver.activate("missing")).toEqual({ status: "rejected", reason: "unknown_node" });
    expect(await driver.activate("label")).toEqual({ status: "rejected", reason: "event_not_allowed" });
    expect(await driver.activate("unbound")).toEqual({ status: "rejected", reason: "unbound_event" });

    // No result was queued by any rejected attempt.
    expect(await session.wait({ timeoutMs: 0 })).toEqual({ status: "timeout" });
    await session.close();
  });

  it("abort: pre-aborted returns interrupted; aborting a pending wait leaves the session and queue intact", async () => {
    const { renderer, driver } = createTestRenderer();
    const session = await createRuntime({ renderer }).open({ document: buttonDoc("b", "go") });

    const pre = new AbortController();
    pre.abort();
    expect(await session.wait({ signal: pre.signal })).toEqual({ status: "interrupted", reason: "aborted" });

    const ctrl = new AbortController();
    const p = session.wait({ signal: ctrl.signal });
    await flush();
    ctrl.abort();
    expect(await p).toEqual({ status: "interrupted", reason: "aborted" });

    // Session stayed open; a result arriving after the abort is delivered on the next wait.
    await driver.activate("b");
    expect(await session.wait()).toEqual({ status: "results", results: [submit("go")], sessionState: "open" });
    await session.close();
  });

  it("rejects malformed timeoutMs as a caller error", async () => {
    const { renderer } = createTestRenderer();
    const session = await createRuntime({ renderer }).open({ document: buttonDoc("b", "go") });

    for (const bad of [-1, 1.5, MAX_WAIT_MS + 1]) {
      expect(() => session.wait({ timeoutMs: bad })).toThrow(RangeError);
    }
    await session.close();
  });
});
