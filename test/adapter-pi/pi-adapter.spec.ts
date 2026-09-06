import { describe, expect, it } from "vitest";
import { matchesKey } from "@earendil-works/pi-tui";
import {
  ACTIVE_SURFACE_REASON,
  piSupport,
  registerGentuiPiExtension,
  translatePiInput,
} from "gentui-adapter-pi";
import { standardCatalog, type UiDocument } from "gentui";

const choice: UiDocument = {
  version: "1",
  id: "choices",
  root: {
    id: "choice",
    type: "select",
    props: {
      label: "Choose",
      options: [
        { id: "one", label: "Option 1", value: "option-1" },
        { id: "two", label: "Option 2", value: "option-2" },
      ],
    },
    events: { activate: { name: "choose-option" } },
  },
};

function fixture(mode: "tui" | "rpc" | "json" | "print" = "tui", hasUI = true) {
  let tool: any;
  const handlers = new Map<string, (event: any, ctx: any) => void>();
  let component: any;
  let customCalls = 0;
  let renders = 0;
  let finish: (() => void) | undefined;
  const keybindings = { matches: (data: string, _binding: string) => false };
  const ctx: any = {
    mode,
    hasUI,
    ui: {
      custom(factory: any) {
        customCalls++;
        return new Promise<void>((resolve) => {
          finish = resolve;
          component = factory({ requestRender: () => renders++ }, {}, keybindings, resolve);
        });
      },
    },
  };
  const pi: any = {
    registerTool(next: any) { tool = next; },
    on(name: string, handler: any) { handlers.set(name, handler); },
  };
  registerGentuiPiExtension(pi, { env: { TERM: "xterm-256color", LANG: "en_US.UTF-8" } });
  const execute = async (input: unknown, signal = new AbortController().signal) => {
    const result = await tool.execute("call", input, signal, undefined, ctx);
    return result.details;
  };
  return {
    execute,
    handlers,
    get component() { return component; },
    get customCalls() { return customCalls; },
    get renders() { return renders; },
    finish: () => finish?.(),
  };
}

function id(output: any): string {
  expect(output).toMatchObject({ status: "ok", sessionId: expect.any(String) });
  return output.sessionId;
}

describe("gentui-adapter-pi", () => {
  it("registers one tool and delegates catalog plus the complete live transcript", async () => {
    const host = fixture();
    expect(await host.execute({ operation: "catalog" })).toEqual({ status: "ok", catalog: standardCatalog });

    const sessionId = id(await host.execute({ operation: "open", document: choice }));
    expect(host.customCalls).toBe(1);
    expect(host.component.render(30).join("\n")).toContain("Option 1");

    host.component.handleInput("\u001b[B");
    expect(host.component.render(30).join("\n")).toContain("Option 2");
    host.component.handleInput("\r");
    expect(await host.execute({ operation: "wait", sessionId, timeoutMs: 0 })).toEqual({
      status: "ok",
      results: [{ type: "select", intent: "choose-option", value: "option-2" }],
    });
    expect(await host.execute({ operation: "wait", sessionId, timeoutMs: 0 })).toEqual({ status: "closed", sessionId });
    expect(await host.execute({ operation: "update", sessionId, sequence: 1, update: choice })).toEqual({ status: "closed", sessionId });
    expect(await host.execute({ operation: "close", sessionId })).toMatchObject({ status: "closed" });
  });

  it.each(["print", "json", "rpc"] as const)("rejects %s mode before installing UI", async (mode) => {
    const host = fixture(mode);
    expect(await host.execute({ operation: "open", document: choice })).toMatchObject({ status: "unsupported" });
    expect(host.customCalls).toBe(0);
  });

  it("rejects unavailable and unsupported UI before creating a session", async () => {
    const missing = fixture("tui", false);
    expect(await missing.execute({ operation: "open", document: choice })).toMatchObject({ status: "unsupported" });
    expect(missing.customCalls).toBe(0);
    expect(piSupport({ mode: "tui", hasUI: true, ui: {} as any }, { TERM: "dumb" })).toMatchObject({ status: "unsupported" });
  });

  it("keeps the first surface when a second open is rejected", async () => {
    const host = fixture();
    const first = id(await host.execute({ operation: "open", document: choice }));
    expect(await host.execute({ operation: "open", document: choice })).toEqual({ status: "unsupported", reason: ACTIVE_SURFACE_REASON });
    expect(host.customCalls).toBe(1);
    host.component.handleInput("\u001b[B");
    host.component.handleInput("\r");
    expect(await host.execute({ operation: "wait", sessionId: first, timeoutMs: 0 })).toMatchObject({ status: "ok", results: [{ value: "option-2" }] });
    await host.execute({ operation: "close", sessionId: first });
  });

  it("cleans up idempotently on cancel, abort, reload, replacement, and shutdown", async () => {
    for (const reason of ["reload", "new", "resume", "fork", "quit"] as const) {
      const host = fixture();
      await host.execute({ operation: "open", document: choice });
      host.handlers.get("session_shutdown")?.({ reason }, {});
      host.handlers.get("session_shutdown")?.({ reason }, {});
      expect(host.customCalls).toBe(1);
      expect(host.component).toBeDefined();
    }

    const cancelled = fixture();
    const sessionId = id(await cancelled.execute({ operation: "open", document: choice }));
    cancelled.component.handleInput("\u001b");
    expect(await cancelled.execute({ operation: "wait", sessionId, timeoutMs: 0 })).toMatchObject({ status: "ok", results: [{ type: "cancel" }] });

    const aborted = fixture();
    await aborted.execute({ operation: "open", document: choice });
    const controller = new AbortController();
    controller.abort();
    await aborted.execute({ operation: "wait", sessionId: "unknown", timeoutMs: 0 }, controller.signal);
    expect(aborted.customCalls).toBe(1);
  });

  it("survives fifty open, navigate, select, and close cycles without stale input", async () => {
    const host = fixture();
    for (let cycle = 0; cycle < 50; cycle++) {
      const sessionId = id(await host.execute({ operation: "open", document: choice }));
      host.component.handleInput("\u001b[B");
      host.component.handleInput("\r");
      expect(await host.execute({ operation: "wait", sessionId, timeoutMs: 0 })).toMatchObject({ results: [{ value: "option-2" }] });
      expect(await host.execute({ operation: "wait", sessionId, timeoutMs: 0 })).toEqual({ status: "closed", sessionId });
      await host.execute({ operation: "close", sessionId });
    }
    expect(host.customCalls).toBe(50);
  });

  it("uses Pi key utilities for editing, safety keys, text, and sanitized paste", () => {
    const bindings: any = { matches: (data: string, binding: string) => binding === "tui.select.down" && matchesKey(data, "down") };
    expect(translatePiInput("\u001b[B", bindings)).toEqual({ type: "key", key: "ArrowDown" });
    expect(translatePiInput("\u001b[Z", bindings)).toEqual({ type: "key", key: "Shift+Tab" });
    expect(translatePiInput("\u001b[13;5u", bindings)).toEqual({ type: "key", key: "Ctrl+Enter" });
    expect(translatePiInput("hello", { matches: () => false } as any)).toEqual({ type: "text", text: "hello" });
    expect(translatePiInput("\u001b[200~safe\u0000text\u001b[201~", { matches: () => false } as any)).toEqual({ type: "paste", text: "safe\u0000text" });
  });
});
