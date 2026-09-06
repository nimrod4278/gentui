// Transactional patch application. A batch of set/replace/remove
// operations is applied to a deep COPY of the committed document; the caller
// validates the complete candidate before committing. Nothing here mutates the
// live document, so a failing batch leaves the previous state untouched.

import { DEFAULT_LIMITS, type DocumentLimits } from "./limits.js";
import { DiagnosticCode, type ValidationDiagnostic } from "./diagnostics.js";
import type { PatchPath, UiDocument, UiPatchOp } from "./protocol.js";

export interface ApplyPatchOptions {
  limits?: DocumentLimits;
}

export type ApplyPatchResult =
  | { ok: true; document: UiDocument }
  | { ok: false; diagnostics: ValidationDiagnostic[] };

// Segments that could reach or mutate an object prototype are never traversed
// or assigned, regardless of container type.
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class PatchError extends Error {
  constructor(
    readonly code: DiagnosticCode,
    readonly path: PatchPath,
    message: string,
  ) {
    super(message);
  }
}

function assertSafePath(path: PatchPath): void {
  if (!Array.isArray(path) || path.length === 0) {
    throw new PatchError(DiagnosticCode.InvalidPatch, path ?? [], "patch path must be a non-empty array");
  }
  for (const segment of path) {
    if (typeof segment === "string" && FORBIDDEN_SEGMENTS.has(segment)) {
      throw new PatchError(DiagnosticCode.InvalidPatch, path, "patch path may not traverse a prototype key");
    }
    if (typeof segment !== "string" && typeof segment !== "number") {
      throw new PatchError(DiagnosticCode.InvalidPatch, path, "patch path segments must be strings or numbers");
    }
  }
}

/** Descend to the container that directly holds the final path segment. */
function parentOf(root: unknown, path: PatchPath): unknown {
  let current = root;
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i];
    if (Array.isArray(current)) {
      if (typeof segment !== "number" || !Number.isInteger(segment) || segment < 0 || segment >= current.length) {
        throw new PatchError(DiagnosticCode.InvalidPatch, path, "patch path index is out of range");
      }
      current = current[segment];
    } else if (isPlainObject(current)) {
      if (typeof segment !== "string" || !(segment in current)) {
        throw new PatchError(DiagnosticCode.InvalidPatch, path, "patch path key does not exist");
      }
      current = current[segment];
    } else {
      throw new PatchError(DiagnosticCode.InvalidPatch, path, "patch path traverses a non-container value");
    }
  }
  return current;
}

function applyOne(root: unknown, op: UiPatchOp): void {
  assertSafePath(op.path);
  const parent = parentOf(root, op.path);
  const key = op.path[op.path.length - 1];

  if (Array.isArray(parent)) {
    if (typeof key !== "number" || !Number.isInteger(key) || key < 0) {
      throw new PatchError(DiagnosticCode.InvalidPatch, op.path, "array index must be a non-negative integer");
    }
    if (op.type === "set") {
      if (key > parent.length) {
        throw new PatchError(DiagnosticCode.InvalidPatch, op.path, "set index is out of range");
      }
      parent[key] = op.value;
    } else if (op.type === "replace") {
      if (key >= parent.length) {
        throw new PatchError(DiagnosticCode.InvalidPatch, op.path, "replace target does not exist");
      }
      parent[key] = op.value;
    } else {
      if (key >= parent.length) {
        throw new PatchError(DiagnosticCode.InvalidPatch, op.path, "remove index is out of range");
      }
      parent.splice(key, 1);
    }
    return;
  }

  if (isPlainObject(parent)) {
    if (typeof key !== "string") {
      throw new PatchError(DiagnosticCode.InvalidPatch, op.path, "object key must be a string");
    }
    if (op.type === "set") {
      parent[key] = op.value;
    } else if (op.type === "replace") {
      if (!(key in parent)) {
        throw new PatchError(DiagnosticCode.InvalidPatch, op.path, "replace target does not exist");
      }
      parent[key] = op.value;
    } else {
      if (!(key in parent)) {
        throw new PatchError(DiagnosticCode.InvalidPatch, op.path, "remove target does not exist");
      }
      delete parent[key];
    }
    return;
  }

  throw new PatchError(DiagnosticCode.InvalidPatch, op.path, "patch target is not a container");
}

export function applyPatch(
  base: UiDocument,
  ops: UiPatchOp[],
  options: ApplyPatchOptions = {},
): ApplyPatchResult {
  const limits = options.limits ?? DEFAULT_LIMITS;

  if (!Array.isArray(ops)) {
    return { ok: false, diagnostics: [{ code: DiagnosticCode.InvalidPatch, path: [], message: "patch must be an array of operations" }] };
  }
  // Reject an oversized batch before doing any work.
  if (ops.length > limits.maxPatchOps) {
    return { ok: false, diagnostics: [{ code: DiagnosticCode.MaxPatchOpsExceeded, path: [], message: "patch exceeds the maximum operation count" }] };
  }

  // Work on a deep copy so a failure anywhere leaves the live document intact.
  const draft = structuredClone(base) as unknown;
  try {
    ops.forEach((op, index) => {
      if (!op || (op.type !== "set" && op.type !== "replace" && op.type !== "remove")) {
        throw new PatchError(DiagnosticCode.InvalidPatch, [index], "unknown patch operation");
      }
      applyOne(draft, op);
    });
  } catch (error) {
    if (error instanceof PatchError) {
      return { ok: false, diagnostics: [{ code: error.code, path: error.path, message: error.message }] };
    }
    throw error;
  }
  return { ok: true, document: draft as UiDocument };
}
