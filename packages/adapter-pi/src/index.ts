import {
  decodeKittyPrintable,
  Key,
  matchesKey,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  createAgentTool,
  createRuntime,
  createTextRenderer,
  standardCatalog,
  type GentuiSession,
  type GentuiToolOutput,
  type InputOutcome,
  type RenderInput,
  type RendererInput,
  type RendererKey,
  sanitizeText,
  type TextRenderer,
  type UiDocument,
} from "gentui";

export const PI_ADAPTER_VERSION = "0.1.0" as const;
export const ACTIVE_SURFACE_REASON = "a gentui surface is already active";

type PiComponent = { render(width: number): string[]; invalidate(): void; handleInput?(data: string): void };
type PiTui = { requestRender(): void };
export interface PiKeybindings {
  matches(data: string, binding: string): boolean;
}
export interface PiExtensionContext {
  mode: "tui" | "rpc" | "json" | "print";
  hasUI: boolean;
  ui: {
    custom<T>(factory: (tui: PiTui, theme: unknown, keybindings: PiKeybindings, done: (result: T) => void) => PiComponent): Promise<T>;
  };
}
export interface PiExtensionApi {
  registerTool(tool: {
    name: string;
    label: string;
    description: string;
    parameters: unknown;
    execute(toolCallId: string, input: unknown, signal: AbortSignal | undefined, onUpdate: unknown, ctx: PiExtensionContext): Promise<unknown>;
  }): void;
  on(event: "session_shutdown", handler: (event: { reason: string }) => void): void;
}

/** Pi-specific support policy. It is deliberately checked before UI creation. */
export function piSupport(ctx: Pick<PiExtensionContext, "mode" | "hasUI" | "ui">, env: Record<string, string | undefined> = process.env): { status: "supported" } | { status: "unsupported"; reason: string } {
  if (ctx.mode !== "tui") return { status: "unsupported", reason: `Pi ${ctx.mode} mode does not provide interactive gentui` };
  if (!ctx.hasUI || !ctx.ui || typeof ctx.ui.custom !== "function") return { status: "unsupported", reason: "Pi custom UI is unavailable" };
  if (env.TERM === "dumb") return { status: "unsupported", reason: "TERM=dumb is not an interactive terminal profile" };
  return { status: "supported" };
}

const toolParameters = Type.Object({
  operation: Type.String(),
  document: Type.Optional(Type.Unknown()),
  sessionId: Type.Optional(Type.String()),
  sequence: Type.Optional(Type.Number()),
  update: Type.Optional(Type.Unknown()),
  timeoutMs: Type.Optional(Type.Number()),
  reason: Type.Optional(Type.String()),
}, { additionalProperties: false });

function keyInput(data: string, keybindings: PiKeybindings): RendererInput | undefined {
  const configured = (binding: string, key: RendererKey): RendererInput | undefined =>
    keybindings.matches(data, binding) ? { type: "key", key } : undefined;

  // Distinct safety gestures and cancellation have precedence over ordinary
  // submit/text handling.
  if (matchesKey(data, Key.ctrl("enter"))) return { type: "key", key: "Ctrl+Enter" };
  if (matchesKey(data, Key.ctrl("c")) || keybindings.matches(data, "app.interrupt")) return { type: "key", key: "Ctrl+C" };
  if (matchesKey(data, Key.escape) || keybindings.matches(data, "tui.select.cancel")) return { type: "key", key: "Escape" };
  if (matchesKey(data, Key.shift("tab"))) return { type: "key", key: "Shift+Tab" };

  return configured("tui.input.tab", "Tab")
    ?? configured("tui.select.up", "ArrowUp")
    ?? configured("tui.select.down", "ArrowDown")
    ?? configured("tui.editor.cursorLeft", "ArrowLeft")
    ?? configured("tui.editor.cursorRight", "ArrowRight")
    ?? configured("tui.editor.cursorLineStart", "Home")
    ?? configured("tui.editor.cursorLineEnd", "End")
    ?? configured("tui.editor.deleteCharBackward", "Backspace")
    ?? configured("tui.editor.deleteCharForward", "Delete")
    ?? configured("tui.select.confirm", "Enter")
    ?? configured("tui.input.submit", "Enter")
    ?? (matchesKey(data, Key.tab) ? { type: "key", key: "Tab" } : undefined)
    ?? (matchesKey(data, Key.up) ? { type: "key", key: "ArrowUp" } : undefined)
    ?? (matchesKey(data, Key.down) ? { type: "key", key: "ArrowDown" } : undefined)
    ?? (matchesKey(data, Key.left) ? { type: "key", key: "ArrowLeft" } : undefined)
    ?? (matchesKey(data, Key.right) ? { type: "key", key: "ArrowRight" } : undefined)
    ?? (matchesKey(data, Key.home) ? { type: "key", key: "Home" } : undefined)
    ?? (matchesKey(data, Key.end) ? { type: "key", key: "End" } : undefined)
    ?? (matchesKey(data, Key.backspace) ? { type: "key", key: "Backspace" } : undefined)
    ?? (matchesKey(data, Key.delete) ? { type: "key", key: "Delete" } : undefined)
    ?? (matchesKey(data, Key.enter) ? { type: "key", key: "Enter" } : undefined);
}

/** Translate one Pi input event without comparing terminal escape sequences. */
export function translatePiInput(data: string, keybindings: PiKeybindings): RendererInput | undefined {
  const paste = /^\u001b\[200~([\s\S]*)\u001b\[201~$/.exec(data);
  if (paste) return { type: "paste", text: paste[1]! };
  const key = keyInput(data, keybindings);
  if (key) return key;
  const kittyText = decodeKittyPrintable(data);
  if (kittyText !== undefined) return { type: "text", text: kittyText };
  if (!data.includes("\u001b") && !data.includes("\u0000")) return { type: "text", text: data };
  return undefined;
}

interface ActiveSurface {
  renderer: PiRenderer;
  session?: GentuiSession;
  cancel(reason: string): void;
}

export interface PiRenderer extends TextRenderer {
  mount(ctx: PiExtensionContext, onDone: () => void): Promise<void>;
}

/** Renderer adapter whose component always renders the latest committed input. */
export function createPiRenderer(): PiRenderer {
  const frames = createTextRenderer();
  let latest: RenderInput | undefined;
  let tui: PiTui | undefined;
  let component: PiComponent | undefined;
  let done: (() => void) | undefined;
  let finished = false;

  const requestRender = (): void => {
    component?.invalidate();
    tui?.requestRender();
  };
  const baseRender = frames.render.bind(frames);
  const baseCleanup = frames.cleanup.bind(frames);

  return Object.assign(frames, {
    mount(ctx: PiExtensionContext, onDone: () => void): Promise<void> {
      let readyResolve!: () => void;
      let readyReject!: (error: unknown) => void;
      const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
      const pending = ctx.ui.custom<void>((nextTui, _theme, keybindings, finish) => {
        tui = nextTui;
        done = finish;
        component = {
          render(width: number): string[] {
            if (!latest) return [""];
            const frame = baseRender({
              ...latest,
              profile: { ...latest.profile, columns: Math.max(1, Math.trunc(width)) },
            });
            // Pi owns vertical clipping. Avoid an adapter-generated empty tail.
            const lines = [...frame.lines];
            while (lines.length > 1 && lines.at(-1)?.trim() === "") lines.pop();
            return lines.map((line) => truncateToWidth(line, width, ""));
          },
          invalidate() {},
          handleInput(data: string): void {
            const translated = translatePiInput(data, keybindings);
            if (!translated) return;
            let outcome: InputOutcome;
            try {
              outcome = frames.dispatch(translated);
            } catch {
              frames.cleanup();
              return;
            }
            if (outcome.status === "accepted" || outcome.status === "backpressured") requestRender();
          },
        };
        readyResolve();
        return component;
      });
      void pending.then(onDone, (error) => { readyReject(error); onDone(); });
      return ready;
    },
    render(input: RenderInput) {
      latest = input;
      const frame = baseRender(input);
      requestRender();
      return frame;
    },
    cleanup(): void {
      if (finished) return;
      finished = true;
      latest = undefined;
      baseCleanup();
      done?.();
      done = undefined;
      component = undefined;
      tui = undefined;
    },
  });
}

export interface PiAdapterOptions {
  env?: Record<string, string | undefined>;
}

/** Register the single deep Pi integration: one serializable gentui tool. */
export function registerGentuiPiExtension(pi: PiExtensionApi, options: PiAdapterOptions = {}): void {
  let active: ActiveSurface | undefined;
  let invocationContext: PiExtensionContext | undefined;
  let operationFailure: string | undefined;

  const host = {
    catalog: () => standardCatalog,
    async open({ document }: { document: UiDocument }) {
      const ctx = invocationContext;
      if (!ctx) throw new Error("Pi invocation context is unavailable");
      if (active) return { status: "unsupported" as const, reason: ACTIVE_SURFACE_REASON };

      const renderer = createPiRenderer();
      const surface: ActiveSurface = {
        renderer,
        cancel(reason: string) {
          const outcome = renderer.dispatch({ type: "cancel-request", reason });
          if (outcome.status === "rejected") renderer.cleanup();
        },
      };
      active = surface; // reserve ownership before any async host operation
      try {
        await renderer.mount(ctx, () => {
          if (active !== surface) return;
          try { surface.cancel("Pi custom UI closed"); } catch { renderer.cleanup(); }
          active = undefined;
        });
        const runtime = createRuntime({
          renderer,
          closeOnSelect: true,
          profile: {
            columns: 80,
            rows: 24,
            asciiOnly: !/utf-?8/i.test(`${options.env?.LC_ALL ?? process.env.LC_ALL ?? ""} ${options.env?.LANG ?? process.env.LANG ?? ""}`),
            color: (options.env ?? process.env).NO_COLOR === undefined,
            reducedMotion: (options.env ?? process.env).GENTUI_REDUCED_MOTION === "1",
          },
        });
        surface.session = await runtime.open({ document });
        // The documented initial focus is the first active control. This happens
        // only after Pi has installed the custom component, so pre-handoff Enter
        // cannot activate a cached/default node.
        renderer.dispatch({ type: "key", key: "Tab" });
        return { status: "opened" as const, session: surface.session };
      } catch (error) {
        operationFailure = sanitizeText(error instanceof Error ? error.message : String(error)).slice(0, 240);
        renderer.cleanup();
        if (active === surface) active = undefined;
        throw error;
      }
    },
  };
  const agentTool = createAgentTool(host);

  const shutdown = (reason: string): void => {
    const surface = active;
    if (!surface) return;
    try { surface.cancel(reason); } catch { surface.renderer.cleanup(); }
    if (active === surface) active = undefined;
  };

  pi.on("session_shutdown", (event) => shutdown(`Pi ${event.reason}`));
  pi.registerTool({
    name: "gentui",
    label: "Gentui",
    description: "Open, update, wait on, and close a typed interactive gentui document.",
    parameters: toolParameters,
    async execute(_toolCallId, input, signal, _onUpdate, ctx) {
      const support = piSupport(ctx, options.env ?? process.env);
      let output: GentuiToolOutput;
      if (support.status === "unsupported") {
        output = support;
      } else {
        const abort = (): void => shutdown("Pi tool aborted");
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
        invocationContext = ctx;
        try {
          operationFailure = undefined;
          output = await agentTool.execute(input);
          if (output.status === "invalid" && output.reason === "operation_failed" && operationFailure) {
            output = { ...output, errors: output.errors.map((error, index) => index === 0
              ? { ...error, message: `Pi adapter operation failed: ${operationFailure}` }
              : error) };
          }
        } finally {
          invocationContext = undefined;
          signal?.removeEventListener("abort", abort);
        }
      }
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        details: output,
      };
    },
  });
}

export default registerGentuiPiExtension;
