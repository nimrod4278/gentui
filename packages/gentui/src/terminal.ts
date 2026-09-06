import type { UiCatalog } from "./catalog.js";
import { DocumentInvalidError } from "./diagnostics.js";
import type { UiDocument, UiResult } from "./protocol.js";
import { validateDocument } from "./validate.js";
import {
  createRuntime,
  type GentuiSession,
  type RuntimeOptions,
} from "./runtime.js";
import type {
  Frame,
  InputHandler,
  RenderInput,
  RendererAdapter,
  RendererInput,
  RendererKey,
  TerminalProfile,
} from "./renderer.js";

/** Minimal stream surfaces required by the terminal adapter (Node TTY streams satisfy these). */
export interface TerminalInput {
  readonly isTTY?: boolean;
  readonly isRaw?: boolean;
  setRawMode?(raw: boolean): void;
  resume(): void;
  pause(): void;
  isPaused?(): boolean;
  on(event: "data", listener: (data: Uint8Array | string) => void): unknown;
  off(event: "data", listener: (data: Uint8Array | string) => void): unknown;
}

export interface TerminalOutput {
  readonly isTTY?: boolean;
  readonly columns?: number;
  readonly rows?: number;
  write(data: string): unknown;
  on(event: "resize", listener: () => void): unknown;
  off(event: "resize", listener: () => void): unknown;
}

export interface SignalSource {
  on(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  off(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

export interface TerminalCapabilities {
  profile: TerminalProfile;
  rawInput: true;
  alternateScreen: true;
}

export type TerminalSupport =
  | { status: "supported"; capabilities: TerminalCapabilities }
  | { status: "unsupported"; reason: string };

/** Pure capability check. It never reads from stdin, writes ANSI, or changes tty mode. */
export function detectTerminalCapabilities(options: {
  input: TerminalInput;
  output: TerminalOutput;
  env?: Record<string, string | undefined>;
}): TerminalSupport {
  const { input, output } = options;
  if (input.isTTY !== true) return { status: "unsupported", reason: "stdin is not a TTY" };
  if (output.isTTY !== true) return { status: "unsupported", reason: "stdout is not a TTY" };
  if (typeof input.setRawMode !== "function") return { status: "unsupported", reason: "stdin cannot enter raw mode" };
  if (typeof output.write !== "function" || typeof output.on !== "function" || typeof output.off !== "function") {
    return { status: "unsupported", reason: "stdout cannot be acquired" };
  }
  const columns = Math.trunc(output.columns ?? 0);
  const rows = Math.trunc(output.rows ?? 0);
  if (columns < 1 || rows < 1) return { status: "unsupported", reason: "terminal size is unavailable" };
  const env = options.env ?? process.env;
  if (env.TERM === "dumb") return { status: "unsupported", reason: "TERM=dumb has no interactive screen support" };
  return {
    status: "supported",
    capabilities: {
      rawInput: true,
      alternateScreen: true,
      profile: {
        columns,
        rows,
        asciiOnly: !/utf-?8/i.test(`${env.LC_ALL ?? ""} ${env.LC_CTYPE ?? ""} ${env.LANG ?? ""}`),
        color: env.NO_COLOR === undefined && env.TERM !== "dumb",
        reducedMotion: env.GENTUI_REDUCED_MOTION === "1",
      },
    },
  };
}

const ENTER_ALT = "\u001b[?1049h";
const LEAVE_ALT = "\u001b[?1049l";
const HIDE_CURSOR = "\u001b[?25l";
const SHOW_CURSOR = "\u001b[?25h";
const CLEAR_HOME = "\u001b[H\u001b[2J";
const RESET = "\u001b[0m";

export interface TerminalRendererOptions {
  input: TerminalInput;
  output: TerminalOutput;
  /** Deterministic semantic frame renderer; terminal ownership stays in this adapter. */
  frameRenderer: RendererAdapter;
  signalSource?: SignalSource;
  /** Recorded host state, for hosts already using alternate screen or a hidden cursor. */
  initialScreen?: { alternateScreen: boolean; cursorVisible: boolean };
  onRelease?: () => void;
  onError?: (error: unknown) => void;
}

export interface TerminalRenderer extends RendererAdapter {
  readonly acquired: boolean;
  acquire(): void;
}

function decodeInput(data: Uint8Array | string): RendererInput[] {
  const value = typeof data === "string" ? data : Buffer.from(data).toString("utf8");
  const exact: Record<string, RendererKey> = {
    "\u0003": "Ctrl+C", "\r": "Enter", "\n": "Enter", "\t": "Tab", "\u001b": "Escape",
    "\u001b[Z": "Shift+Tab", "\u001b[A": "ArrowUp", "\u001b[B": "ArrowDown",
    "\u001b[C": "ArrowRight", "\u001b[D": "ArrowLeft", "\u001b[H": "Home", "\u001b[F": "End",
    "\u007f": "Backspace", "\u001b[3~": "Delete",
  };
  const key = exact[value];
  if (key) return [{ type: "key", key }];
  // A chunk may contain Ctrl+C beside ordinary bytes. Preserve ordering.
  return value.split("\u0003").flatMap((part, index, all) => {
    const result: RendererInput[] = [];
    if (part) result.push({ type: "text", text: part });
    if (index < all.length - 1) result.push({ type: "key", key: "Ctrl+C" });
    return result;
  });
}

export function createTerminalRenderer(options: TerminalRendererOptions): TerminalRenderer {
  let acquired = false;
  let cleaned = false;
  let handler: InputHandler | undefined;
  let latest: RenderInput | undefined;
  let rawBefore = false;
  let pausedBefore = true;
  const screenBefore = options.initialScreen ?? { alternateScreen: false, cursorVisible: true };

  const report = (error: unknown): void => { options.onError?.(error); };
  const onData = (data: Uint8Array | string): void => {
    try {
      for (const input of decodeInput(data)) handler?.(input);
    } catch (error) {
      renderer.cleanup();
      report(error);
    }
  };
  const draw = (input: RenderInput): Frame => {
    const profile = { ...input.profile, columns: Math.max(1, Math.trunc(options.output.columns ?? input.profile.columns)), rows: Math.max(1, Math.trunc(options.output.rows ?? input.profile.rows)) };
    const adjusted = { ...input, profile };
    const frame = options.frameRenderer.render(adjusted);
    latest = adjusted;
    options.output.write(CLEAR_HOME + frame.lines.join("\n"));
    return frame;
  };
  const onResize = (): void => {
    if (!acquired || !latest) return;
    try { draw(latest); } catch (error) { renderer.cleanup(); report(error); }
  };
  const onSigint = (): void => {
    try { handler?.({ type: "key", key: "Ctrl+C" }); } catch (error) { renderer.cleanup(); report(error); }
  };
  const onSigterm = (): void => {
    try { handler?.({ type: "cancel-request", reason: "SIGTERM" }); } catch (error) { renderer.cleanup(); report(error); }
  };

  const renderer: TerminalRenderer = {
    get acquired() { return acquired; },
    acquire(): void {
      if (acquired) return;
      cleaned = false;
      rawBefore = Boolean(options.input.isRaw);
      pausedBefore = options.input.isPaused?.() ?? true;
      // Mark ownership before the first mutation so a partially failed acquire
      // is still fully unwound by cleanup.
      acquired = true;
      // Listeners are installed only after host suspension and immediately before
      // stdin is resumed, so transition bytes have exactly one owner.
      options.input.setRawMode!(true);
      options.input.on("data", onData);
      options.output.on("resize", onResize);
      options.signalSource?.on("SIGINT", onSigint);
      options.signalSource?.on("SIGTERM", onSigterm);
      if (!screenBefore.alternateScreen) options.output.write(ENTER_ALT);
      if (screenBefore.cursorVisible) options.output.write(HIDE_CURSOR);
      options.input.resume();
    },
    setInputHandler(next: InputHandler): void { handler = next; },
    render(input: RenderInput): Frame {
      if (!acquired) throw new Error("terminal renderer must be acquired before rendering");
      return draw(input);
    },
    cleanup(): void {
      if (cleaned) return;
      cleaned = true;
      let firstError: unknown;
      const attempt = (operation: () => void): void => {
        try { operation(); } catch (error) { firstError ??= error; }
      };
      if (acquired) {
        // Stop input first; no byte can be delivered while ownership returns.
        attempt(() => { options.input.off("data", onData); });
        attempt(() => { options.output.off("resize", onResize); });
        attempt(() => { options.signalSource?.off("SIGINT", onSigint); });
        attempt(() => { options.signalSource?.off("SIGTERM", onSigterm); });
        if (pausedBefore) attempt(() => { options.input.pause(); });
        attempt(() => { options.input.setRawMode!(rawBefore); });
        attempt(() => { options.output.write(RESET + (screenBefore.cursorVisible ? SHOW_CURSOR : HIDE_CURSOR) + (screenBefore.alternateScreen ? "" : LEAVE_ALT)); });
      }
      acquired = false;
      latest = undefined;
      attempt(() => { options.frameRenderer.cleanup(); });
      attempt(() => { options.onRelease?.(); });
      if (firstError !== undefined) throw firstError;
    },
  };
  return renderer;
}

export interface TerminalHostController {
  suspend(): void;
  resume(): void;
}

export interface TerminalHostOptions extends Omit<TerminalRendererOptions, "onRelease"> {
  host: TerminalHostController;
  env?: Record<string, string | undefined>;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  runtime?: Omit<RuntimeOptions, "renderer" | "profile">;
}

/** Controller used by line-oriented CLI hosts whose prompt can be paused only at a safe boundary. */
export interface PromptHostController {
  canPause(): boolean;
  pause(): void;
  resume(): void;
}

export interface PromptTerminalHostOptions extends Omit<TerminalHostOptions, "host"> {
  prompt: PromptHostController;
}

export type TerminalOpenResult =
  | { status: "unsupported"; reason: string }
  | { status: "opened"; session: GentuiSession };

export interface TerminalHost {
  /** Documents the host-specific edge while keeping the agent protocol identical. */
  readonly capabilities: { handoff: "suspend-ui" | "pause-prompt" };
  catalog(): UiCatalog;
  open(input: { document: UiDocument }): Promise<TerminalOpenResult>;
}

interface HandoffController {
  readonly mode: TerminalHost["capabilities"]["handoff"];
  support(): { status: "supported" } | { status: "unsupported"; reason: string };
  suspend(): void;
  resume(): void;
}

/** Shared lifecycle extracted from the fullscreen and prompt host integrations. */
function createHandoffTerminalHost(options: Omit<TerminalHostOptions, "host">, handoff: HandoffController): TerminalHost {
  let active = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  let session: GentuiSession | undefined;
  const releaseHost = (): void => {
    if (!active) return;
    active = false;
    if (timeout !== undefined) clearTimeout(timeout);
    timeout = undefined;
    if (abortListener) options.abortSignal?.removeEventListener("abort", abortListener);
    abortListener = undefined;
    handoff.resume();
  };
  const renderer = createTerminalRenderer({
    input: options.input,
    output: options.output,
    frameRenderer: options.frameRenderer,
    ...(options.signalSource ? { signalSource: options.signalSource } : {}),
    ...(options.initialScreen ? { initialScreen: options.initialScreen } : {}),
    ...(options.onError ? { onError: options.onError } : {}),
    onRelease: releaseHost,
  });

  const runtime = createRuntime({
    renderer,
    ...(options.runtime ?? {}),
    profile: { columns: 1, rows: 1 }, // renderer replaces these with live dimensions
  });
  return {
    capabilities: { handoff: handoff.mode },
    catalog: () => runtime.catalog(),
    async open({ document }): Promise<TerminalOpenResult> {
      const terminalSupport = detectTerminalCapabilities({ input: options.input, output: options.output, ...(options.env ? { env: options.env } : {}) });
      if (terminalSupport.status === "unsupported") return terminalSupport;
      const hostSupport = handoff.support();
      if (hostSupport.status === "unsupported") return hostSupport;
      if (active) throw new Error("terminal host already has an active session");
      // Reject untrusted documents before suspending the host. Runtime performs
      // the same check at its trust boundary; this early check protects the
      // terminal-handoff ordering guarantee.
      const validation = validateDocument(document, options.runtime?.limits ? { limits: options.runtime.limits } : undefined);
      if (!validation.ok) throw new DocumentInvalidError(validation.diagnostics);
      handoff.suspend();
      active = true;
      try {
        renderer.acquire();
        session = await runtime.open({ document });
        const cancel = (reason: string): void => {
          if (renderer.acquired) renderer.setInputHandler?.(() => ({ status: "rejected", reason: "closing" }));
          void session?.close(reason).catch(options.onError ?? (() => {}));
        };
        if (options.abortSignal) {
          abortListener = () => cancel("host cancellation");
          options.abortSignal.addEventListener("abort", abortListener, { once: true });
          if (options.abortSignal.aborted) abortListener();
        }
        if (options.timeoutMs !== undefined) timeout = setTimeout(() => cancel("timeout"), Math.max(0, options.timeoutMs));
        return { status: "opened", session };
      } catch (error) {
        try { renderer.cleanup(); } catch { /* preserve acquisition/render failure */ }
        releaseHost();
        throw error;
      }
    },
  };
}

/** Fullscreen CLI integration: suspend the host UI while gentui owns the terminal. */
export function createTerminalHost(options: TerminalHostOptions): TerminalHost {
  const { host, ...shared } = options;
  return createHandoffTerminalHost(shared, {
    mode: "suspend-ui",
    support: () => ({ status: "supported" }),
    suspend: () => host.suspend(),
    resume: () => host.resume(),
  });
}

/** Second CLI integration: pause and restore a line-oriented prompt at a safe boundary. */
export function createPromptTerminalHost(options: PromptTerminalHostOptions): TerminalHost {
  const { prompt, ...shared } = options;
  return createHandoffTerminalHost(shared, {
    mode: "pause-prompt",
    support: () => prompt.canPause()
      ? { status: "supported" }
      : { status: "unsupported", reason: "host prompt cannot be paused safely" },
    suspend: () => prompt.pause(),
    resume: () => prompt.resume(),
  });
}

/** Useful for hosts that need an explicitly typed unsupported result. */
export function unsupportedTerminal(reason: string): UiResult {
  return { type: "unsupported", reason };
}
