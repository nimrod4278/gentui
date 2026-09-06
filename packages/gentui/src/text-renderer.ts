// Deterministic text-frame renderer shared by production host adapters and tests.
// It models terminal cells rather than JavaScript string lengths.

import { mergeInteractionState } from "./interaction-state.js";
import { parseDiagnostics, parseFileList, parseSelectOptions } from "./content.js";
import { sanitizeText } from "./sanitize.js";
import type { RuntimeClock, TimerId } from "./clock.js";
import type { UiNode } from "./protocol.js";
import type { InteractionState } from "./interaction-state.js";
import type {
  Frame,
  InputHandler,
  InputOutcome,
  RenderInput,
  RendererAdapter,
  RendererInput,
  RendererKey,
  KeyboardHelpLabel,
  TerminalProfile,
} from "./renderer.js";

export interface TextRendererOptions {
  /** Supplying a clock enables deterministic spinner animation. */
  clock?: RuntimeClock;
  spinnerIntervalMs?: number;
}

export interface TextRenderer extends RendererAdapter {
  readonly currentFrame: Frame | undefined;
  readonly frames: readonly Frame[];
  readonly cleanupCount: number;
  readonly currentInteractionState: InteractionState | undefined;
  /** Arm the next render() call to throw the given error (fires once). */
  failNextRender(error?: Error): void;
  /** Deliver a semantic interaction through the installed runtime handler. */
  dispatch(input: RendererInput): InputOutcome;
}

/** A test driver over an in-memory renderer that emits semantic interactions. */
interface TestRendererDriver {
  dispatch(input: RendererInput): Promise<InputOutcome>;
  activate(nodeId: string): Promise<InputOutcome>;
  requestCancel(reason?: string): Promise<InputOutcome>;
  setInteractionState(state: Partial<InteractionState>): Promise<InputOutcome>;
  press(key: RendererKey): Promise<InputOutcome>;
}

type RenderBudget = { remaining: number };
const MAX_RENDER_NODES = 1_000;
const MAX_RENDER_DEPTH = 32;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const mark = /\p{Mark}/u;
const pictograph = /\p{Extended_Pictographic}/u;

function graphemes(value: string): string[] {
  return [...segmenter.segment(value)].map(({ segment }) => segment);
}

function graphemeWidth(value: string): number {
  if ([...value].every((character) => mark.test(character))) return 0;
  if (pictograph.test(value)) return 2;
  const point = value.codePointAt(0) ?? 0;
  return point >= 0x1100 && (
    point <= 0x115f || point === 0x2329 || point === 0x232a ||
    (point >= 0x2e80 && point <= 0xa4cf && point !== 0x303f) ||
    (point >= 0xac00 && point <= 0xd7a3) ||
    (point >= 0xf900 && point <= 0xfaff) ||
    (point >= 0xfe10 && point <= 0xfe19) ||
    (point >= 0xfe30 && point <= 0xfe6f) ||
    (point >= 0xff00 && point <= 0xff60) ||
    (point >= 0xffe0 && point <= 0xffe6) ||
    (point >= 0x20000 && point <= 0x3fffd)
  ) ? 2 : 1;
}

function cellWidth(value: string): number {
  return graphemes(value).reduce((width, cluster) => width + graphemeWidth(cluster), 0);
}

/** Clip only between grapheme clusters. No partial wide cell is emitted. */
function clipCells(value: string, width: number, start = 0): string {
  if (width <= 0) return "";
  let column = 0;
  let result = "";
  for (const cluster of graphemes(value)) {
    const size = graphemeWidth(cluster);
    const end = column + size;
    if (end <= start) {
      column = end;
      continue;
    }
    if (column < start || end > start + width) {
      column = end;
      if (end > start + width) break;
      continue;
    }
    result += cluster;
    column = end;
  }
  return result;
}

function fit(value: string, width: number): string {
  const clipped = clipCells(value, width);
  return clipped + " ".repeat(Math.max(0, width - cellWidth(clipped)));
}

function asciiText(value: string): string {
  return value.normalize("NFKD").replace(/\p{Mark}/gu, "").replace(/[^\x20-\x7e]/g, "?");
}

/** Hard-wrap at terminal-cell boundaries, preferring whitespace boundaries. */
function wrapCells(value: string, width: number): string[] {
  if (width <= 0) return [];
  if (value === "") return [""];
  const result: string[] = [];
  let remaining = value;
  while (cellWidth(remaining) > width) {
    let taken = "";
    let takenWidth = 0;
    let lastSpace = -1;
    for (const cluster of graphemes(remaining)) {
      const size = graphemeWidth(cluster);
      if (takenWidth + size > width) break;
      taken += cluster;
      takenWidth += size;
      if (/\s/u.test(cluster)) lastSpace = taken.length;
    }
    if (!taken) {
      // A two-cell grapheme in a one-cell viewport degrades visibly and safely.
      result.push("?");
      remaining = remaining.slice(graphemes(remaining)[0]!.length);
      continue;
    }
    const split = lastSpace > 0 && lastSpace < taken.length ? lastSpace : taken.length;
    result.push(remaining.slice(0, split));
    remaining = remaining.slice(split);
  }
  result.push(remaining);
  return result;
}

function expandedTabs(value: string, tabSize = 4): string {
  let column = 0;
  let output = "";
  for (const cluster of graphemes(value)) {
    if (cluster === "\t") {
      const spaces = tabSize - (column % tabSize);
      output += " ".repeat(spaces);
      column += spaces;
    } else {
      output += cluster;
      column += graphemeWidth(cluster);
    }
  }
  return output;
}

function markdownLines(content: string): string[] {
  let code = false;
  return content.split("\n").flatMap((raw) => {
    const line = sanitizeText(raw);
    if (/^\s*```/.test(line)) {
      code = !code;
      return [];
    }
    if (code) return [`| ${line}`];
    const heading = line.replace(/^#{1,6}\s+/, "");
    const quote = heading.replace(/^>\s?/, "> ");
    const links = quote.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
    return [links.replace(/`([^`]*)`/g, "$1")];
  });
}

function diffLines(content: string): string[] {
  let oldLine = 0;
  let newLine = 0;
  return content.split("\n").map((raw) => {
    const line = sanitizeText(expandedTabs(raw));
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      return `@@ ${hunk[1]} -> ${hunk[2]} @@${hunk[3]}`;
    }
    if (line.startsWith("\\ No newline")) return `! ${line.slice(2)}`;
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) return line;
    if (line.startsWith("+")) return `${"".padStart(4)} ${String(newLine++).padStart(4)} + ${line.slice(1)}`;
    if (line.startsWith("-")) return `${String(oldLine++).padStart(4)} ${"".padStart(4)} - ${line.slice(1)}`;
    const rendered = `${String(oldLine++).padStart(4)} ${String(newLine++).padStart(4)}   ${line.startsWith(" ") ? line.slice(1) : line}`;
    return rendered;
  });
}

function contentLines(node: UiNode, width: number, state: InteractionState | undefined, profile: TerminalProfile): string[] {
  const content = String(node.props.content ?? node.props.label ?? "");
  let logical: string[];
  if (node.type === "markdown") logical = markdownLines(content);
  else if (node.type === "file-list") {
    const entries = parseFileList(content);
    const selected = state?.selection[node.id] ?? entries[0]?.id;
    logical = entries.map((entry) => {
      const status = entry.status === "added" ? "A added" : entry.status === "modified" ? "M modified" : entry.status === "deleted" ? "D deleted" : "R renamed";
      const rename = entry.previousPath ? ` <- ${entry.previousPath}` : "";
      return `${entry.id === selected ? ">" : " "} [${status}] ${entry.path}${rename}`;
    });
  } else if (node.type === "diff") logical = diffLines(content);
  else if (node.type === "diagnostics") {
    logical = parseDiagnostics(content).map((entry) => {
      const details = [entry.location, entry.source, entry.code].filter(Boolean).join(" ");
      return `[${entry.severity.toUpperCase()}]${details ? ` ${details}:` : ""} ${entry.message}`;
    });
  } else logical = content.split("\n").map(sanitizeText);

  return logical.flatMap((line) => {
    const safe = profile.asciiOnly ? asciiText(sanitizeText(line)) : sanitizeText(line);
    if (node.type === "markdown" && safe.startsWith("| ") && width > 2) {
      return wrapCells(safe.slice(2), width - 2).map((part) => `| ${part}`);
    }
    return wrapCells(safe, width);
  });
}

function tabLabel(node: UiNode): string {
  const candidate = node.props.title ?? node.props.label ?? node.props.content ?? node.id;
  return sanitizeText(String(candidate)).split("\n", 1)[0] || node.id;
}

function normalizedScroll(node: UiNode, lineCount: number, height: number, state?: InteractionState): number {
  const requested = Math.max(0, Math.trunc(state?.scroll[node.id] ?? 0));
  // Scroll is a logical top-line index, not a bottom-anchored offset. Keeping
  // it independent of viewport height prevents a resize from jumping upward.
  return Math.min(requested, Math.max(0, lineCount - 1));
}

function renderNode(
  node: UiNode,
  width: number,
  height: number,
  state: InteractionState | undefined,
  budget: RenderBudget,
  profile: TerminalProfile,
  depth = 1,
  spinnerFrame?: string,
): string[] {
  width = Math.max(0, Math.trunc(width));
  height = Math.max(0, Math.trunc(height));
  if (width === 0 || height === 0 || depth > MAX_RENDER_DEPTH || budget.remaining-- <= 0 || node.props.hidden === true) return [];
  const children = node.children ?? [];
  const child = (item: UiNode, childWidth = width, childHeight = height): string[] =>
    renderNode(item, childWidth, childHeight, state, budget, profile, depth + 1, spinnerFrame);

  if (node.type === "input") {
    const label = sanitizeText(String(node.props.label ?? ""));
    const value = String(state?.values[node.id] ?? node.props.value ?? "");
    const display = node.props.secret === true ? "*".repeat(graphemes(value).length) : sanitizeText(value);
    const marker = state?.focusId === node.id ? "> " : state?.focusId ? "  " : "";
    return [fit(`${marker}${label}: ${display}${node.props.disabled === true ? " [disabled]" : ""}`, width)];
  }
  if (node.type === "checkbox") {
    const checked = Boolean(state?.values[node.id] ?? node.props.checked === true);
    const marker = state?.focusId === node.id ? "> " : state?.focusId ? "  " : "";
    return [fit(`${marker}[${checked ? "x" : " "}] ${sanitizeText(String(node.props.label ?? ""))}${node.props.disabled === true ? " [disabled]" : ""}`, width)];
  }
  if (node.type === "select") {
    const options = parseSelectOptions(node.props.options);
    const selectedId = state?.selection[node.id];
    const selected = options.find((option) => option.id === selectedId) ?? options.find((option) => !option.disabled);
    const marker = state?.focusId === node.id ? "> " : state?.focusId ? "  " : "";
    const value = selected ? selected.label : options.length === 0 ? "(no options)" : "(no enabled options)";
    return [fit(`${marker}${sanitizeText(String(node.props.label ?? ""))}: ${value}${node.props.disabled === true ? " [disabled]" : ""}`, width)];
  }
  if (node.type === "confirm") {
    const values = [
      sanitizeText(String(node.props.label ?? "")),
      node.props.operation === undefined ? "" : `Operation: ${sanitizeText(String(node.props.operation))}`,
      node.props.target === undefined ? "" : `Target: ${sanitizeText(String(node.props.target))}`,
      node.props.arguments === undefined ? "" : `Arguments: ${sanitizeText(String(node.props.arguments))}`,
      node.props.risk === undefined ? "" : `Risk: ${sanitizeText(String(node.props.risk))}`,
    ].filter(Boolean);
    return values.flatMap((line) => wrapCells(profile.asciiOnly ? asciiText(line) : line, width)).map((line) => fit(line, width));
  }
  if (node.type === "progress") {
    const label = sanitizeText(String(node.props.label ?? ""));
    const value = Number(node.props.value);
    const percent = Math.round(value * 100);
    return [fit(`${label} ${percent}%`, width)];
  }
  if (node.type === "spinner") {
    const label = sanitizeText(String(node.props.label ?? ""));
    return [fit(`${label}${profile.reducedMotion || spinnerFrame === undefined ? "" : ` ${spinnerFrame}`}`, width)];
  }
  if (node.type === "error") {
    const label = node.props.label === undefined ? "" : sanitizeText(String(node.props.label));
    const message = sanitizeText(String(node.props.message ?? ""));
    const logical = label ? [`Error: ${label}`, message] : [message];
    return logical.flatMap((line) => wrapCells(profile.asciiOnly ? asciiText(line) : line, width)).map((line) => fit(line, width));
  }
  if (node.type === "empty") {
    const label = sanitizeText(String(node.props.label ?? ""));
    const detail = node.props.detail === undefined ? "" : sanitizeText(String(node.props.detail));
    const logical = detail ? [`Empty: ${label}`, detail] : [label];
    return logical.flatMap((line) => wrapCells(profile.asciiOnly ? asciiText(line) : line, width)).map((line) => fit(line, width));
  }
  if (["text", "markdown", "file-list", "diff", "diagnostics"].includes(node.type)) {
    const lines = contentLines(node, width, state, profile);
    let offset = normalizedScroll(node, lines.length, height, state);
    if (node.type === "file-list") {
      const entries = parseFileList(String(node.props.content ?? ""));
      const selectedId = state?.selection[node.id] ?? entries[0]?.id;
      const selectedIndex = Math.max(0, entries.findIndex((entry) => entry.id === selectedId));
      if (selectedIndex < offset) offset = selectedIndex;
      else if (selectedIndex >= offset + height) offset = selectedIndex - height + 1;
    }
    return lines.slice(offset, offset + height).map((line) => fit(line, width));
  }
  if (node.type === "button") {
    const label = sanitizeText(String(node.props.label ?? ""));
    const marker = state?.focusId === node.id ? "> " : state?.focusId ? "  " : "";
    return [fit(`${marker}${label}${node.props.disabled === true ? " [disabled]" : ""}`, width)];
  }

  if (node.type === "row") {
    if (children.length === 0) return [];
    // Rows need at least two cells per child. Below that exact breakpoint
    // children wrap vertically in document order instead of becoming unreachable.
    if (width < children.length * 2) {
      const all = children.flatMap((item) => child(item, width, MAX_RENDER_NODES));
      const offset = normalizedScroll(node, all.length, height, state);
      return all.slice(offset, offset + height);
    }
    // Literal policy: left-to-right equal shares, with odd remainder cells
    // assigned one at a time to the earliest children.
    const base = Math.floor(width / children.length);
    const remainder = width % children.length;
    const widths = children.map((_, index) => base + (index < remainder ? 1 : 0));
    const rendered = children.map((item, index) => child(item, widths[index]!, height));
    const rowHeight = Math.min(height, Math.max(0, ...rendered.map((lines) => lines.length)));
    return Array.from({ length: rowHeight }, (_, line) =>
      rendered.map((lines, index) => fit(lines[line] ?? "", widths[index]!)).join(""),
    );
  }

  if (node.type === "panel") {
    const border = profile.asciiOnly
      ? { vertical: "|", horizontal: "-", topLeft: "+", topRight: "+", bottomLeft: "+", bottomRight: "+" }
      : { vertical: "│", horizontal: "─", topLeft: "┌", topRight: "┐", bottomLeft: "└", bottomRight: "┘" };
    // Two columns is the exact minimum at which both vertical borders fit.
    // At one column a single vertical border is a deterministic degradation.
    if (width === 1) return Array.from({ length: Math.min(height, Math.max(1, children.length + 2)) }, () => border.vertical);
    const rawTitle = sanitizeText(String(node.props.title ?? ""));
    const title = profile.asciiOnly ? asciiText(rawTitle) : rawTitle;
    const innerWidth = width - 2;
    const bodyWidth = Math.max(0, innerWidth - 2); // one padding cell on either side
    const bodyHeight = Math.max(0, height - 2);
    const body = children.flatMap((item) => child(item, bodyWidth, MAX_RENDER_NODES));
    const offset = normalizedScroll(node, body.length, bodyHeight, state);
    const visible = body.slice(offset, offset + bodyHeight);
    const titleRoom = Math.max(0, innerWidth - 1);
    const titlePart = titleRoom > 0 && title ? `${border.horizontal}${clipCells(title, titleRoom)}` : "";
    const top = border.topLeft + titlePart + border.horizontal.repeat(Math.max(0, innerWidth - cellWidth(titlePart))) + border.topRight;
    const lines = [top];
    for (const line of visible) lines.push(border.vertical + fit(` ${clipCells(line, bodyWidth)} `, innerWidth) + border.vertical);
    if (lines.length < height) lines.push(border.bottomLeft + border.horizontal.repeat(innerWidth) + border.bottomRight);
    return lines.slice(0, height);
  }

  if (node.type === "tabs") {
    if (children.length === 0) return [];
    const requested = state?.activeTabId[node.id];
    const activeIndex = Math.max(0, children.findIndex((item) => item.id === requested));
    const tokens = children.map((item, index) => index === activeIndex ? `[${tabLabel(item)}]` : ` ${tabLabel(item)} `);
    const starts: number[] = [];
    let total = 0;
    for (const token of tokens) {
      starts.push(total);
      total += cellWidth(token);
    }
    const activeStart = starts[activeIndex]!;
    const activeEnd = activeStart + cellWidth(tokens[activeIndex]!);
    const headerOffset = Math.max(0, Math.min(activeStart, activeEnd - width, total - width));
    const header = fit(clipCells(tokens.join(""), width, headerOffset), width);
    const selected = children[activeIndex]!;
    return [header, ...child(selected, width, Math.max(0, height - 1))].slice(0, height);
  }

  const all = children.flatMap((item) => child(item, width, MAX_RENDER_NODES));
  const offset = normalizedScroll(node, all.length, height, state);
  return all.slice(offset, offset + height);
}

function keyboardHelp(
  node: UiNode,
  state?: InteractionState,
  budget: RenderBudget = { remaining: MAX_RENDER_NODES },
  depth = 1,
): KeyboardHelpLabel[] {
  if (node.props.hidden === true || depth > MAX_RENDER_DEPTH || budget.remaining-- <= 0) return [];
  const own = node.events?.activate !== undefined && node.props.disabled !== true
    ? [{
        nodeId: node.id,
        label: sanitizeText(String(node.props.label ?? node.props.title ?? node.id)),
        focusKeys: ["Tab", "Shift+Tab"] as const,
        activateKeys: ["Enter"] as const,
      }]
    : [];
  let children = node.children ?? [];
  if (node.type === "tabs" && children.length > 0) {
    const activeId = state?.activeTabId[node.id];
    children = [children.find((item) => item.id === activeId) ?? children[0]!];
  }
  return [...own, ...children.flatMap((item) => keyboardHelp(item, state, budget, depth + 1))];
}

function layout(input: RenderInput, spinnerFrame?: string): Frame {
  const columns = Math.max(0, Math.trunc(input.profile.columns));
  const rows = Math.max(0, Math.trunc(input.profile.rows));
  const rendered = renderNode(input.document.root, columns, rows, input.state, { remaining: MAX_RENDER_NODES }, input.profile, 1, spinnerFrame);
  const lines = Array.from({ length: rows }, (_, row) => fit(rendered[row] ?? "", columns));
  return { columns, rows, lines, keyboardHelp: keyboardHelp(input.document.root, input.state) };
}

function hasAnimatedSpinner(node: UiNode, profile: TerminalProfile): boolean {
  if (profile.reducedMotion || node.props.hidden === true) return false;
  return node.type === "spinner" || (node.children ?? []).some((child) => hasAnimatedSpinner(child, profile));
}

const SPINNER_FRAMES = [".", "o", "O", "o"] as const;

export function createTextRenderer(options: TextRendererOptions = {}): TextRenderer {
  const frames: Frame[] = [];
  let current: Frame | undefined;
  let cleanups = 0;
  let pendingError: Error | undefined;
  let handler: InputHandler | undefined;
  let interactionState: InteractionState | undefined;
  let latestInput: RenderInput | undefined;
  let animationTimer: TimerId | undefined;
  let spinnerIndex = -1;
  const interval = Math.max(1, Math.trunc(options.spinnerIntervalMs ?? 80));

  const stopAnimation = (): void => {
    if (animationTimer !== undefined) options.clock?.clear(animationTimer);
    animationTimer = undefined;
  };
  const scheduleAnimation = (): void => {
    if (!options.clock || animationTimer !== undefined || !latestInput || !hasAnimatedSpinner(latestInput.document.root, latestInput.profile)) return;
    animationTimer = options.clock.setTimeout(() => {
      animationTimer = undefined;
      if (!latestInput || !hasAnimatedSpinner(latestInput.document.root, latestInput.profile)) return;
      spinnerIndex = (spinnerIndex + 1) % SPINNER_FRAMES.length;
      const frame = layout(latestInput, SPINNER_FRAMES[spinnerIndex]);
      frames.push(frame);
      current = frame;
      scheduleAnimation();
    }, interval);
  };

  return {
    get currentFrame() { return current; },
    get frames() { return frames; },
    get cleanupCount() { return cleanups; },
    get currentInteractionState() { return interactionState; },
    failNextRender(error?: Error) { pendingError = error ?? new Error("in-memory renderer: forced failure"); },
    setInputHandler(next: InputHandler) { handler = next; },
    dispatch(input: RendererInput): InputOutcome {
      if (!handler) throw new Error("no input handler installed (open a session first)");
      if (input.type === "state-change") {
        interactionState = mergeInteractionState(interactionState ?? {
          scroll: {}, activeTabId: {}, selection: {}, cursor: {}, values: {},
        }, input.state);
      }
      return handler(input);
    },
    render(input: RenderInput): Frame {
      if (pendingError) {
        const error = pendingError;
        pendingError = undefined;
        throw error;
      }
      latestInput = input;
      if (!hasAnimatedSpinner(input.document.root, input.profile)) {
        stopAnimation();
        spinnerIndex = -1;
      }
      const spinnerFrame = spinnerIndex < 0 ? undefined : SPINNER_FRAMES[spinnerIndex];
      const frame = layout(input, spinnerFrame);
      interactionState = input.state;
      frames.push(frame);
      current = frame;
      scheduleAnimation();
      return frame;
    },
    cleanup(): void {
      cleanups += 1;
      stopAnimation();
      latestInput = undefined;
      current = undefined;
    },
  };
}

function createTestRenderer(): { renderer: TextRenderer; driver: TestRendererDriver } {
  const renderer = createTextRenderer();
  const driver: TestRendererDriver = {
    dispatch: (input) => Promise.resolve(renderer.dispatch(input)),
    activate: (nodeId) => Promise.resolve(renderer.dispatch({ type: "activate", nodeId })),
    requestCancel: (reason) => Promise.resolve(renderer.dispatch(reason !== undefined
      ? { type: "cancel-request", reason }
      : { type: "cancel-request" })),
    setInteractionState: (state) => Promise.resolve(renderer.dispatch({ type: "state-change", state })),
    press: (key) => Promise.resolve(renderer.dispatch({ type: "key", key })),
  };
  return { renderer, driver };
}
