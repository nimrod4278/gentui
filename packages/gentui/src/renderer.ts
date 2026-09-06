// Renderer seam: a renderer turns a committed document + terminal profile into
// a deterministic frame, and cleans up on close. Tested primarily with the
// in-memory adapter in gentui-testing and a shared adapter contract.

import type { UiDocument } from "./protocol.js";
import type { InteractionState, InteractionStateUpdate } from "./interaction-state.js";

export interface TerminalProfile {
  columns: number;
  rows: number;
  /** Restrict frames to printable ASCII while retaining semantic markers. */
  asciiOnly?: boolean;
  /** Renderers may add theme color when true. Meaning never depends on it. */
  color?: boolean;
  /** Disable non-essential animation while retaining stable status text. */
  reducedMotion?: boolean;
}

export interface KeyboardHelpLabel {
  nodeId: string;
  label: string;
  focusKeys: readonly RendererKey[];
  activateKeys: readonly RendererKey[];
}

export interface Frame {
  columns: number;
  rows: number;
  lines: readonly string[];
  /** Accessible control names and their complete keyboard path for this frame. */
  keyboardHelp: readonly KeyboardHelpLabel[];
}

export interface RenderInput {
  document: UiDocument;
  profile: TerminalProfile;
  state?: InteractionState;
}

/**
 * A semantic interaction attempt delivered from the renderer (or a test driver)
 * to the runtime. Host adapters map raw keyboard or mouse events into these
 * same shapes.
 */
export type RendererKey = "Tab" | "Shift+Tab" | "Enter" | "Ctrl+Enter" | "Escape" | "Ctrl+C" | "Backspace" | "Delete" | "Home" | "End" | "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

export type RendererInput =
  | { type: "key"; key: RendererKey }
  | { type: "text"; text: string }
  | { type: "paste"; text: string }
  | { type: "confirm"; nodeId: string; approved: boolean }
  | { type: "activate"; nodeId: string; intent?: string; payload?: Record<string, unknown> }
  | { type: "cancel-request"; reason?: string }
  | { type: "state-change"; state: InteractionStateUpdate };

/** The runtime's answer to a dispatched interaction attempt. */
export type InputOutcome =
  | { status: "accepted" }
  | { status: "rejected"; reason: string }
  | {
      status: "backpressured";
      reason: "result_queue_full";
      pendingResults: number;
      capacity: number;
    };

export type InputHandler = (input: RendererInput) => InputOutcome;

export interface RendererAdapter {
  /** Render a committed document into a frame. May throw on failure. */
  render(input: RenderInput): Frame;
  /** Release any acquired resources. Safe to call more than once. */
  cleanup(): void;
  /**
   * The runtime installs its input handler here so the renderer can deliver
   * semantic interactions back through a single production seam.
   */
  setInputHandler?(handler: InputHandler): void;
}

export const DEFAULT_PROFILE: TerminalProfile = { columns: 80, rows: 24 };
