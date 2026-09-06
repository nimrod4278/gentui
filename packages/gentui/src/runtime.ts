// Runtime/session lifecycle: open a document into a rendered frame, replace or
// patch it transactionally, receive interaction results through a bounded queue
// with wait/timeout/cancellation, and close cleanly.
//
// Results are produced only through the renderer -> runtime ingress seam
// (`dispatchInput`), never injected into the queue. `wait()` returns a typed
// WaitResult; `update()` returns a typed UpdateResult. Neither throws for
// protocol-level rejection.

import { randomUUID } from "node:crypto";
import type { UiDocument, UiNode, UiPatchOp, UiResult } from "./protocol.js";
import {
  emptyInteractionState,
  mergeInteractionState,
  reconcileInteractionState,
  type InteractionReset,
  type InteractionState,
} from "./interaction-state.js";
import {
  DEFAULT_PROFILE,
  type InputOutcome,
  type RendererAdapter,
  type RendererInput,
  type RendererKey,
  type TerminalProfile,
} from "./renderer.js";
import {
  ResultChannel,
  type WaitOptions,
  type WaitResult,
} from "./result-queue.js";
import { realClock, type RuntimeClock } from "./clock.js";
import { validateDocument, type ValidateOptions } from "./validate.js";
import {
  DiagnosticCode,
  DocumentInvalidError,
  type ValidationDiagnostic,
} from "./diagnostics.js";
import { DEFAULT_LIMITS, type DocumentLimits } from "./limits.js";
import { standardNodeRegistry, type NodeRegistry } from "./node-registry.js";
import { applyPatch } from "./patch.js";
import { buildCatalog, type UiCatalog } from "./catalog.js";
import { parseFileList, parseSelectOptions } from "./content.js";
import { sanitizeText } from "./sanitize.js";

export interface RuntimeOptions {
  renderer: RendererAdapter;
  profile?: TerminalProfile;
  /** Close one-shot select surfaces after a choice is submitted. */
  closeOnSelect?: boolean;
  limits?: DocumentLimits;
  /** Injectable timer source; defaults to real timers. Tests pass a fake clock. */
  clock?: RuntimeClock;
}

/** Complete-document replacement or a transactional patch batch. */
export interface UpdateInput {
  sessionId: string;
  sequence: number;
  document?: UiDocument;
  patch?: UiPatchOp[];
  reset?: InteractionReset;
}

export type UpdateResult =
  | { status: "committed"; sequence: number }
  | { status: "rejected"; reason: "validation"; sequence: number; errors: ValidationDiagnostic[] }
  | {
      status: "rejected";
      reason: "duplicate" | "stale" | "gap";
      receivedSequence: number;
      expectedSequence: number;
      lastCommittedSequence: number;
    };

export interface GentuiSession {
  readonly id: string;
  readonly results: AsyncIterable<UiResult>;
  update(input: UpdateInput): Promise<UpdateResult>;
  wait(options?: WaitOptions): Promise<WaitResult>;
  close(reason?: string): Promise<UiResult>;
}

export interface GentuiRuntime {
  catalog(): UiCatalog;
  open(input: { document: UiDocument }): Promise<GentuiSession>;
}

interface SessionContext {
  renderer: RendererAdapter;
  profile: TerminalProfile;
  closeOnSelect: boolean;
  limits: DocumentLimits;
  registry: NodeRegistry;
  validateOptions: ValidateOptions | undefined;
  clock: RuntimeClock;
}

function findNode(root: UiNode, id: string): UiNode | undefined {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}

function activeNodes(root: UiNode, state: InteractionState): UiNode[] {
  if (root.props.hidden === true) return [];
  let children = root.children ?? [];
  if (root.type === "tabs" && children.length > 0) {
    const activeId = state.activeTabId[root.id];
    children = [children.find((child) => child.id === activeId) ?? children[0]!];
  }
  return [root, ...children.flatMap((child) => activeNodes(child, state))];
}

function isFocusable(node: UiNode): boolean {
  return node.events?.activate !== undefined && node.props.disabled !== true && node.props.hidden !== true;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const graphemes = (value: string): string[] => [...segmenter.segment(value)].map(({ segment }) => segment);

function initializeTabs(document: UiDocument, state: InteractionState): InteractionState {
  const activeTabId = { ...state.activeTabId };
  const selection = { ...state.selection };
  const cursor = { ...state.cursor };
  const values = { ...state.values };
  const visit = (node: UiNode): void => {
    if (node.type === "tabs" && node.children?.length) {
      const selected = activeTabId[node.id];
      if (!node.children.some((child) => child.id === selected)) activeTabId[node.id] = node.children[0]!.id;
    }
    if (node.type === "input") {
      const value = sanitizeText(String(node.props.value ?? ""));
      values[node.id] = value;
      cursor[node.id] = graphemes(value).length;
    }
    if (node.type === "checkbox") values[node.id] = node.props.checked === true;
    if (node.type === "select") {
      const first = parseSelectOptions(node.props.options).find((option) => !option.disabled);
      if (first) selection[node.id] = first.id;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(document.root);
  return { ...state, activeTabId, selection, cursor, values };
}

function confirmationSummary(node: UiNode): string {
  return JSON.stringify([node.props.operation ?? "", node.props.target ?? "", node.props.arguments ?? "", node.props.risk ?? ""]);
}

function descendants(node: UiNode): UiNode[] {
  return [node, ...(node.children ?? []).flatMap(descendants)];
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => sameJsonValue(value, right[index]));
  }
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.hasOwn(rightRecord, key) && sameJsonValue(leftRecord[key], rightRecord[key]));
}

class Session implements GentuiSession {
  readonly id = randomUUID();
  readonly #ctx: SessionContext;
  readonly #channel: ResultChannel;
  #document: UiDocument;
  #sequence = 0; // last committed sequence; open() is the N = 0 baseline
  #closed = false;
  #state: InteractionState;
  #confirmationSummaries = new Map<string, string>();

  constructor(ctx: SessionContext, document: UiDocument) {
    this.#ctx = ctx;
    this.#document = document;
    this.#state = initializeTabs(document, emptyInteractionState());
    this.#channel = new ResultChannel({ capacity: ctx.limits.maxPendingResults, clock: ctx.clock });
  }

  renderInitial(): void {
    this.#render(this.#document, this.#state);
  }

  get results(): AsyncIterable<UiResult> {
    return this.#channel;
  }

  wait(options?: WaitOptions): Promise<WaitResult> {
    return this.#channel.wait(options);
  }

  /** Renderer -> runtime ingress: turn a semantic interaction into a result. */
  dispatchInput(input: RendererInput): InputOutcome {
    if (this.#closed) return { status: "rejected", reason: "session_closed" };

    if (input.type === "key") return this.#dispatchKey(input.key);
    if (input.type === "text" || input.type === "paste") return this.#insertText(input.text);
    if (input.type === "confirm") return this.#confirm(input.nodeId, input.approved, false);

    if (input.type === "state-change") {
      const nextState = mergeInteractionState(this.#state, input.state);
      this.#render(this.#document, nextState);
      this.#state = nextState;
      return { status: "accepted" };
    }

    if (input.type === "cancel-request") {
      const result: UiResult =
        input.reason !== undefined ? { type: "cancel", reason: input.reason } : { type: "cancel" };
      this.#channel.offerTerminal(result);
      this.#teardown();
      return { status: "accepted" };
    }

    const node = findNode(this.#document.root, input.nodeId);
    if (!node) return { status: "rejected", reason: "unknown_node" };
    const def = this.#ctx.registry[node.type];
    if (!def || !def.allowedEvents.includes("activate")) {
      return { status: "rejected", reason: "event_not_allowed" };
    }
    if (node.props.disabled === true) return { status: "rejected", reason: "node_disabled" };
    if (node.props.hidden === true) return { status: "rejected", reason: "node_hidden" };
    if (!activeNodes(this.#document.root, this.#state).some((active) => active.id === node.id)) {
      return { status: "rejected", reason: "node_inactive" };
    }
    const intent = node.events?.activate;
    if (!intent) return { status: "rejected", reason: "unbound_event" };
    if (input.intent !== undefined && input.intent !== intent.name) {
      return { status: "rejected", reason: "intent_not_allowed" };
    }
    const authorizedPayload = intent.payload ?? {};
    if (input.payload !== undefined && !sameJsonValue(input.payload, authorizedPayload)) {
      return { status: "rejected", reason: "payload_not_allowed" };
    }

    if (node.type === "input") return this.#submitInput(node, intent.name, authorizedPayload);
    if (node.type === "select") return this.#submitSelect(node, intent.name);
    if (node.type === "checkbox") return this.#toggleCheckbox(node, intent.name);
    if (node.type === "confirm") return this.#confirm(node.id, true, false);
    if (node.type === "button" && typeof node.props.form === "string") {
      return this.#submitForm(node.props.form, intent.name);
    }

    let result: UiResult;
    if (node.type === "file-list") {
      const entries = parseFileList(String(node.props.content ?? ""));
      const selectedId = this.#state.selection[node.id] ?? entries[0]?.id;
      const selected = entries.find((entry) => entry.id === selectedId);
      if (!selected) return { status: "rejected", reason: "no_selectable_item" };
      result = { type: "select", intent: intent.name, value: { ...selected, ...authorizedPayload } };
    } else {
      result = { type: "submit", intent: intent.name, values: authorizedPayload };
    }
    const offered = this.#channel.offer(result);
    if (offered.accepted) return { status: "accepted" };
    return {
      status: "backpressured",
      reason: "result_queue_full",
      pendingResults: offered.pendingResults,
      capacity: offered.capacity,
    };
  }

  #offer(result: UiResult): InputOutcome {
    const offered = this.#channel.offer(result);
    return offered.accepted ? { status: "accepted" } : {
      status: "backpressured", reason: "result_queue_full",
      pendingResults: offered.pendingResults, capacity: offered.capacity,
    };
  }

  #insertText(raw: string): InputOutcome {
    const node = this.#state.focusId ? findNode(this.#document.root, this.#state.focusId) : undefined;
    if (node?.type !== "input" || node.props.disabled === true) return { status: "rejected", reason: "no_editable_input" };
    const insertion = graphemes(sanitizeText(raw));
    const current = graphemes(String(this.#state.values[node.id] ?? node.props.value ?? ""));
    const cursor = Math.max(0, Math.min(current.length, this.#state.cursor[node.id] ?? current.length));
    const maximum = typeof node.props.maxLength === "number" ? node.props.maxLength : Number.POSITIVE_INFINITY;
    const accepted = insertion.slice(0, Math.max(0, maximum - current.length));
    const next = [...current.slice(0, cursor), ...accepted, ...current.slice(cursor)];
    const nextState = mergeInteractionState(this.#state, { values: { [node.id]: next.join("") }, cursor: { [node.id]: cursor + accepted.length } });
    this.#render(this.#document, nextState);
    this.#state = nextState;
    return accepted.length === insertion.length ? { status: "accepted" } : { status: "rejected", reason: "max_length" };
  }

  #submitInput(node: UiNode, intent: string, payload: Record<string, unknown>): InputOutcome {
    const value = String(this.#state.values[node.id] ?? node.props.value ?? "");
    const maximum = typeof node.props.maxLength === "number" ? node.props.maxLength : Number.POSITIVE_INFINITY;
    if ((node.props.required === true && value.length === 0) || graphemes(value).length > maximum) {
      const nextState = { ...this.#state, focusId: node.id };
      this.#render(this.#document, nextState);
      this.#state = nextState;
      return { status: "rejected", reason: "field_invalid" };
    }
    return this.#offer({ type: "submit", intent, values: { [String(node.props.name ?? node.id)]: value, ...payload } });
  }

  #submitSelect(node: UiNode, intent: string): InputOutcome {
    const options = parseSelectOptions(node.props.options);
    const selected = options.find((option) => option.id === this.#state.selection[node.id] && !option.disabled);
    if (!selected) return { status: "rejected", reason: "no_selectable_item" };

    // A select is a one-shot surface: once the choice is submitted, deliver
    // the result as the terminal event and release the renderer immediately.
    // Using the terminal queue path also makes wait() report a closed session
    // without allowing a second Enter to submit the same choice.
    const result = { type: "select" as const, intent, value: selected.value };
    if (this.#ctx.closeOnSelect) {
      this.#channel.offerTerminal(result);
      this.#teardown();
    } else {
      return this.#offer(result);
    }
    return { status: "accepted" };
  }

  #toggleCheckbox(node: UiNode, intent: string): InputOutcome {
    const checked = !Boolean(this.#state.values[node.id] ?? node.props.checked === true);
    const nextState = mergeInteractionState(this.#state, { values: { [node.id]: checked } });
    this.#render(this.#document, nextState);
    this.#state = nextState;
    return this.#offer({ type: "select", intent, value: checked });
  }

  #confirm(nodeId: string, approved: boolean, highRiskGesture: boolean): InputOutcome {
    const node = findNode(this.#document.root, nodeId);
    if (node?.type !== "confirm" || node.props.disabled === true || node.props.hidden === true) return { status: "rejected", reason: "confirmation_unavailable" };
    const intent = node.events?.activate;
    if (!intent) return { status: "rejected", reason: "unbound_event" };
    const baseline = this.#confirmationSummaries.get(node.id);
    if (baseline !== undefined && baseline !== confirmationSummary(node)) return { status: "rejected", reason: "stale_confirmation" };
    if (approved && String(node.props.risk ?? "").toLowerCase() === "high" && !highRiskGesture) return { status: "rejected", reason: "high_risk_gesture_required" };
    return this.#offer({ type: "confirm", intent: intent.name, approved });
  }

  #submitForm(formId: string, intent: string): InputOutcome {
    const form = findNode(this.#document.root, formId);
    if (form?.type !== "form") return { status: "rejected", reason: "unknown_form" };
    const values: Record<string, unknown> = {};
    for (const field of descendants(form)) {
      if (field.type === "input") {
        const value = String(this.#state.values[field.id] ?? field.props.value ?? "");
        const maximum = typeof field.props.maxLength === "number" ? field.props.maxLength : Number.POSITIVE_INFINITY;
        if ((field.props.required === true && value.length === 0) || graphemes(value).length > maximum) {
          const nextState = { ...this.#state, focusId: field.id };
          this.#render(this.#document, nextState); this.#state = nextState;
          return { status: "rejected", reason: "field_invalid" };
        }
        values[String(field.props.name ?? field.id)] = value;
      } else if (field.type === "checkbox") {
        values[String(field.props.name ?? field.id)] = Boolean(this.#state.values[field.id] ?? field.props.checked === true);
      } else if (field.type === "select") {
        const selected = parseSelectOptions(field.props.options).find((option) => option.id === this.#state.selection[field.id] && !option.disabled);
        if (!selected && field.props.required === true) {
          const nextState = { ...this.#state, focusId: field.id };
          this.#render(this.#document, nextState); this.#state = nextState;
          return { status: "rejected", reason: "field_invalid" };
        }
        if (selected) values[String(field.props.name ?? field.id)] = selected.value;
      }
    }
    return this.#offer({ type: "submit", intent, values });
  }

  #dispatchKey(key: RendererKey): InputOutcome {
    if (key === "Escape" || key === "Ctrl+C") {
      return this.dispatchInput({ type: "cancel-request" });
    }
    const focused = this.#state.focusId ? findNode(this.#document.root, this.#state.focusId) : undefined;
    if (focused?.type === "input") {
      const value = graphemes(String(this.#state.values[focused.id] ?? focused.props.value ?? ""));
      const cursor = Math.max(0, Math.min(value.length, this.#state.cursor[focused.id] ?? value.length));
      let nextCursor = cursor;
      let nextValue = value;
      if (key === "ArrowLeft") nextCursor = Math.max(0, cursor - 1);
      else if (key === "ArrowRight") nextCursor = Math.min(value.length, cursor + 1);
      else if (key === "Home") nextCursor = 0;
      else if (key === "End") nextCursor = value.length;
      else if (key === "Backspace" && cursor > 0) { nextValue = [...value.slice(0, cursor - 1), ...value.slice(cursor)]; nextCursor--; }
      else if (key === "Delete" && cursor < value.length) nextValue = [...value.slice(0, cursor), ...value.slice(cursor + 1)];
      else if (!["Enter", "Ctrl+Enter"].includes(key)) return { status: "rejected", reason: "key_not_handled" };
      if (!["Enter", "Ctrl+Enter"].includes(key)) {
        const nextState = mergeInteractionState(this.#state, { cursor: { [focused.id]: nextCursor }, values: { [focused.id]: nextValue.join("") } });
        this.#render(this.#document, nextState); this.#state = nextState;
        return { status: "accepted" };
      }
    }
    if (key === "Ctrl+Enter" && focused?.type === "confirm") return this.#confirm(focused.id, true, true);
    if (key === "Enter") {
      return focused && isFocusable(focused)
        ? this.dispatchInput({ type: "activate", nodeId: focused.id })
        : { status: "rejected", reason: "no_focusable_control" };
    }
    if ((key === "ArrowUp" || key === "ArrowDown") && focused?.type === "select") return this.#moveSelection(key === "ArrowDown" ? 1 : -1);
    if (key === "ArrowLeft" || key === "ArrowRight") return this.#switchTab(key === "ArrowRight" ? 1 : -1);
    if (key === "ArrowUp" || key === "ArrowDown") return this.#moveSelection(key === "ArrowDown" ? 1 : -1);
    if (key !== "Tab" && key !== "Shift+Tab") return { status: "rejected", reason: "key_not_handled" };

    const focusable = activeNodes(this.#document.root, this.#state).filter(isFocusable);
    if (focusable.length === 0) return { status: "rejected", reason: "no_focusable_control" };
    const current = this.#state.focusId ? focusable.findIndex((node) => node.id === this.#state.focusId) : -1;
    const step = key === "Tab" ? 1 : -1;
    const nextIndex = current < 0
      ? (step > 0 ? 0 : focusable.length - 1)
      : (current + step + focusable.length) % focusable.length;
    const nextState: InteractionState = { ...this.#state, focusId: focusable[nextIndex]!.id };
    const nextFocused = focusable[nextIndex]!;
    if (nextFocused.type === "confirm") this.#confirmationSummaries.set(nextFocused.id, confirmationSummary(nextFocused));
    this.#render(this.#document, nextState);
    this.#state = nextState;
    return { status: "accepted" };
  }

  #moveSelection(step: 1 | -1): InputOutcome {
    const focused = this.#state.focusId ? findNode(this.#document.root, this.#state.focusId) : undefined;
    if (focused?.type !== "file-list" && focused?.type !== "select") return { status: "rejected", reason: "no_selectable_list" };
    const entries = focused.type === "select"
      ? parseSelectOptions(focused.props.options).filter((entry) => !entry.disabled)
      : parseFileList(String(focused.props.content ?? ""));
    if (entries.length === 0) return { status: "rejected", reason: "no_selectable_item" };
    const selectedId = this.#state.selection[focused.id] ?? entries[0]!.id;
    const current = Math.max(0, entries.findIndex((entry) => entry.id === selectedId));
    const next = entries[Math.max(0, Math.min(entries.length - 1, current + step))]!;
    const nextState = mergeInteractionState(this.#state, {
      selection: { [focused.id]: next.id },
      scroll: { [focused.id]: next === entries[0] ? 0 : this.#state.scroll[focused.id] ?? 0 },
    });
    this.#render(this.#document, nextState);
    this.#state = nextState;
    return { status: "accepted" };
  }

  #switchTab(step: 1 | -1): InputOutcome {
    const visible = activeNodes(this.#document.root, this.#state);
    const focusedId = this.#state.focusId;
    const tabs = visible.filter((node) => node.type === "tabs" && (node.children?.length ?? 0) > 0);
    const container = [...tabs].reverse().find((node) => focusedId !== undefined && findNode(node, focusedId) !== undefined) ?? tabs[0];
    if (!container?.children?.length) return { status: "rejected", reason: "no_tabs" };

    const currentId = this.#state.activeTabId[container.id];
    const current = Math.max(0, container.children.findIndex((child) => child.id === currentId));
    const next = container.children[(current + step + container.children.length) % container.children.length]!;
    const nextState = mergeInteractionState(this.#state, { activeTabId: { [container.id]: next.id } });
    const firstControl = activeNodes(next, nextState).find(isFocusable);
    if (focusedId && findNode(container, focusedId) && firstControl) nextState.focusId = firstControl.id;
    this.#render(this.#document, nextState);
    this.#state = nextState;
    return { status: "accepted" };
  }

  update(input: UpdateInput): Promise<UpdateResult> {
    return Promise.resolve(this.#update(input));
  }

  #update(input: UpdateInput): UpdateResult {
    const inputErrors = this.#checkInput(input);
    if (inputErrors.length > 0) {
      return { status: "rejected", reason: "validation", sequence: input.sequence, errors: inputErrors };
    }

    const expected = this.#sequence + 1;
    if (input.sequence !== expected) {
      const reason =
        input.sequence === this.#sequence ? "duplicate" : input.sequence < this.#sequence ? "stale" : "gap";
      return {
        status: "rejected",
        reason,
        receivedSequence: input.sequence,
        expectedSequence: expected,
        lastCommittedSequence: this.#sequence,
      };
    }

    let candidate: unknown;
    if (input.document !== undefined) {
      candidate = input.document;
    } else {
      const applied = applyPatch(this.#document, input.patch!, { limits: this.#ctx.limits });
      if (!applied.ok) {
        return { status: "rejected", reason: "validation", sequence: input.sequence, errors: applied.diagnostics };
      }
      candidate = applied.document;
    }

    const validation = validateDocument(candidate, this.#ctx.validateOptions);
    if (!validation.ok) {
      return { status: "rejected", reason: "validation", sequence: input.sequence, errors: validation.diagnostics };
    }

    const nextState = reconcileInteractionState(this.#state, this.#document, validation.document, input.reset);
    this.#render(validation.document, nextState);
    this.#document = validation.document;
    this.#state = nextState;
    this.#sequence = input.sequence;
    return { status: "committed", sequence: input.sequence };
  }

  #checkInput(input: UpdateInput): ValidationDiagnostic[] {
    const errors: ValidationDiagnostic[] = [];
    if (input.sessionId !== this.id) {
      errors.push({ code: DiagnosticCode.InvalidSession, path: ["sessionId"], message: "update does not target this session" });
    }
    if (typeof input.sequence !== "number" || !Number.isSafeInteger(input.sequence) || input.sequence < 0) {
      errors.push({ code: DiagnosticCode.InvalidSequence, path: ["sequence"], message: "sequence must be a non-negative safe integer" });
    }
    const hasDocument = input.document !== undefined;
    const hasPatch = input.patch !== undefined;
    if (hasDocument === hasPatch) {
      errors.push({ code: DiagnosticCode.InvalidUpdate, path: [], message: "update must carry exactly one of document or patch" });
    }
    return errors;
  }

  #render(document: UiDocument, state: InteractionState = this.#state): void {
    try {
      this.#ctx.renderer.render({ document, profile: this.#ctx.profile, state });
    } catch (cause) {
      // Rendering is the primary failure. Cleanup is best-effort here and must
      // never replace it; an ordinary close still reports cleanup failures.
      try { this.#teardown(); } catch { /* preserve renderer failure */ }
      this.#channel.close();
      throw cause;
    }
  }

  #teardown(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#ctx.renderer.cleanup();
  }

  close(_reason?: string): Promise<UiResult> {
    const result: UiResult = { type: "close" };
    if (this.#closed) return Promise.resolve(result);
    this.#teardown();
    this.#channel.close();
    return Promise.resolve(result);
  }
}

export function createRuntime(options: RuntimeOptions): GentuiRuntime {
  const profile = options.profile ?? DEFAULT_PROFILE;
  const limits = options.limits ?? DEFAULT_LIMITS;
  const validateOptions = options.limits ? { limits: options.limits } : undefined;
  const ctx: SessionContext = {
    renderer: options.renderer,
    profile,
    closeOnSelect: options.closeOnSelect === true,
    limits,
    registry: standardNodeRegistry,
    validateOptions,
    clock: options.clock ?? realClock,
  };

  return {
    catalog(): UiCatalog {
      return buildCatalog(options.limits ? { limits: options.limits } : undefined);
    },
    async open({ document }): Promise<GentuiSession> {
      const validation = validateDocument(document, validateOptions);
      if (!validation.ok) {
        throw new DocumentInvalidError(validation.diagnostics);
      }

      const session = new Session(ctx, validation.document);
      // Install the ingress seam so the renderer (or a test driver) can deliver
      // semantic interactions back to this session.
      options.renderer.setInputHandler?.((input) => session.dispatchInput(input));
      // Session rendering owns failure teardown, including failures during the
      // initial frame. Do not clean up a second time here.
      session.renderInitial();
      return session;
    },
  };
}
