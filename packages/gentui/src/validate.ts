// Complete-document validation. Untrusted input is checked for version, node
// identity, allowed types/props, child policy, allowed events, and document
// limits before it can reach the renderer.
//
// Traversal descends at most `maxDepth + 1` levels so pathologically deep input
// yields a diagnostic instead of overflowing the call stack.

import { DEFAULT_LIMITS, type DocumentLimits } from "./limits.js";
import {
  DiagnosticCode,
  type DiagnosticPath,
  type ValidationDiagnostic,
  type ValidationResult,
} from "./diagnostics.js";
import {
  standardNodeRegistry,
  type NodeDefinition,
  type NodeRegistry,
} from "./node-registry.js";
import type { UiDocument } from "./protocol.js";

export interface ValidateOptions {
  limits?: DocumentLimits;
  registry?: NodeRegistry;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function codePointLength(value: string): number {
  let count = 0;
  for (const _ of value) count++;
  return count;
}

function isJsonValue(value: unknown): boolean {
  const seen = new Set<object>();
  const valid = (candidate: unknown): boolean => {
    if (candidate === null || typeof candidate === "string" || typeof candidate === "boolean") return true;
    if (typeof candidate === "number") return Number.isFinite(candidate);
    if (typeof candidate !== "object") return false;
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    if (Array.isArray(candidate)) return candidate.every(valid);
    const prototype = Object.getPrototypeOf(candidate);
    return (prototype === Object.prototype || prototype === null) && Object.values(candidate).every(valid);
  };
  return valid(value);
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && isJsonValue(value);
}

export function validateDocument(
  input: unknown,
  options: ValidateOptions = {},
): ValidationResult<UiDocument> {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const registry = options.registry ?? standardNodeRegistry;
  const diagnostics: ValidationDiagnostic[] = [];
  const push = (code: DiagnosticCode, path: DiagnosticPath, message: string): void => {
    diagnostics.push({ code, path, message });
  };

  if (!isRecord(input)) {
    push(DiagnosticCode.InvalidDocument, [], "document must be an object");
    return { ok: false, diagnostics };
  }

  if (input.version !== "1") {
    // Short-circuit: an incompatible version yields a typed incompatibility
    // diagnostic rather than a partial interpretation of the rest of the tree.
    push(DiagnosticCode.UnsupportedVersion, ["version"], "unsupported protocol version");
    return { ok: false, diagnostics };
  }
  if (typeof input.id !== "string" || input.id === "") {
    push(DiagnosticCode.InvalidDocument, ["id"], "document id must be a non-empty string");
  }

  const seenIds = new Set<string>();
  let nodeCount = 0;
  let depthOverflow = false;

  const visit = (node: unknown, path: DiagnosticPath, depth: number): void => {
    if (depth > limits.maxDepth) {
      depthOverflow = true;
      push(DiagnosticCode.MaxDepthExceeded, path, "node nesting exceeds the maximum depth");
      return; // stop descending: recursion is bounded by maxDepth + 1
    }
    nodeCount++;

    if (!isRecord(node)) {
      push(DiagnosticCode.InvalidNode, path, "node must be an object");
      return;
    }

    if (typeof node.id !== "string" || node.id === "") {
      push(DiagnosticCode.InvalidNode, [...path, "id"], "node id must be a non-empty string");
    } else if (seenIds.has(node.id)) {
      push(DiagnosticCode.DuplicateId, path, "duplicate node id");
    } else {
      seenIds.add(node.id);
    }

    if (typeof node.type !== "string") {
      push(DiagnosticCode.InvalidNode, [...path, "type"], "node type must be a string");
      return;
    }
    const def = registry[node.type];
    if (!def) {
      push(DiagnosticCode.UnknownNodeType, [...path, "type"], "unknown node type");
      return;
    }

    validateProps(def, node.props, [...path, "props"]);
    validateChildren(def, node.children, [...path, "children"], depth);
    if (node.events !== undefined) {
      validateEvents(def, node.events, [...path, "events"]);
      const labelProp = def.accessibleLabelProp;
      if (labelProp && !def.props[labelProp]?.required && isRecord(node.events) && node.events.activate !== undefined) {
        const label = isRecord(node.props) ? node.props[labelProp] : undefined;
        if (typeof label !== "string" || label.trim() === "") {
          push(DiagnosticCode.InvalidProp, [...path, "props", labelProp], "interactive node must have a non-empty accessible label");
        }
      }
    }
  };

  const validateProps = (
    def: NodeDefinition,
    props: unknown,
    path: DiagnosticPath,
  ): void => {
    if (!isRecord(props)) {
      push(DiagnosticCode.InvalidNode, path, "node props must be an object");
      return;
    }
    for (const key of Object.keys(props)) {
      const spec = def.props[key];
      if (!spec) {
        push(DiagnosticCode.UnknownProp, [...path, key], "unknown prop");
        continue;
      }
      const value = props[key];
      if (spec.type === "string") {
        if (typeof value !== "string") {
          push(DiagnosticCode.InvalidProp, [...path, key], "prop must be a string");
        } else if (spec.nonEmpty && value.trim() === "") {
          push(DiagnosticCode.InvalidProp, [...path, key], "prop must be a non-empty accessible label");
        } else if (codePointLength(value) > limits.maxTextLength) {
          push(
            DiagnosticCode.MaxTextLengthExceeded,
            [...path, key],
            "prop text exceeds the maximum length",
          );
        }
      } else if (spec.type === "boolean") {
        if (typeof value !== "boolean") push(DiagnosticCode.InvalidProp, [...path, key], "prop must be a boolean");
      } else if (spec.type === "json") {
        if (!isJsonValue(value)) push(DiagnosticCode.InvalidProp, [...path, key], "prop must be a JSON value");
      } else if (typeof value !== "number" || !Number.isFinite(value)) {
        push(DiagnosticCode.InvalidProp, [...path, key], "prop must be a finite number");
      } else if (spec.integer && !Number.isSafeInteger(value)) {
        push(DiagnosticCode.InvalidProp, [...path, key], "prop must be a safe integer");
      } else if (spec.minimum !== undefined && value < spec.minimum) {
        push(DiagnosticCode.InvalidProp, [...path, key], `prop must be at least ${spec.minimum}`);
      } else if (spec.maximum !== undefined && value > spec.maximum) {
        push(DiagnosticCode.InvalidProp, [...path, key], `prop must be at most ${spec.maximum}`);
      }
    }
    for (const [key, spec] of Object.entries(def.props)) {
      if (spec.required && !(key in props)) {
        push(DiagnosticCode.InvalidProp, [...path, key], "missing required prop");
      }
    }
  };

  const validateChildren = (
    def: NodeDefinition,
    children: unknown,
    path: DiagnosticPath,
    depth: number,
  ): void => {
    if (children === undefined) return;
    if (!Array.isArray(children)) {
      push(DiagnosticCode.InvalidNode, path, "children must be an array");
      return;
    }
    if (def.childPolicy === "leaf") {
      push(DiagnosticCode.ChildrenNotAllowed, path, "node type does not allow children");
      return;
    }
    children.forEach((child, index) => visit(child, [...path, index], depth + 1));
  };

  const validateEvents = (
    def: NodeDefinition,
    events: unknown,
    path: DiagnosticPath,
  ): void => {
    if (!isRecord(events)) {
      push(DiagnosticCode.InvalidNode, path, "events must be an object");
      return;
    }
    for (const key of Object.keys(events)) {
      if (!def.allowedEvents.includes(key)) {
        push(DiagnosticCode.DisallowedEvent, [...path, key], "event not allowed for this node type");
        continue;
      }
      const intent = events[key];
      if (!isRecord(intent) || typeof intent.name !== "string" || intent.name === "") {
        push(DiagnosticCode.InvalidIntent, [...path, key], "intent must name a result");
        continue;
      }
      if (Object.keys(intent).some((field) => field !== "name" && field !== "payload")) {
        push(DiagnosticCode.InvalidIntent, [...path, key], "intent contains an unknown field");
      }
      if (intent.payload !== undefined && !isJsonRecord(intent.payload)) {
        push(DiagnosticCode.InvalidIntent, [...path, key, "payload"], "intent payload must be a JSON object");
      }
    }
  };

  if (isRecord(input.root)) {
    visit(input.root, ["root"], 1);
  } else {
    push(DiagnosticCode.InvalidDocument, ["root"], "document root must be a node object");
  }

  if (nodeCount > limits.maxNodes) {
    push(DiagnosticCode.MaxNodesExceeded, ["root"], "document node count exceeds the maximum");
  }

  // Only measure serialized size once we know the structure is not
  // pathologically deep (JSON.stringify would otherwise risk its own overflow).
  if (!depthOverflow) {
    try {
      const bytes = Buffer.byteLength(JSON.stringify(input), "utf8");
      if (bytes > limits.maxBytes) {
        push(DiagnosticCode.MaxBytesExceeded, [], "document exceeds the maximum size in bytes");
      }
    } catch {
      push(DiagnosticCode.InvalidDocument, [], "document is not serializable");
    }
  }

  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return { ok: true, document: input as unknown as UiDocument };
}
