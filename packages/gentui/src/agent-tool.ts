// Framework-neutral, JSON-only adapter between an agent tool call and the
// richer in-process runtime/host session API. The adapter owns no I/O and keeps
// only live session references plus closed-session tombstones in memory.

import type { UiCatalog } from "./catalog.js";
import {
  DiagnosticCode,
  DocumentInvalidError,
  type ValidationDiagnostic,
} from "./diagnostics.js";
import { MAX_WAIT_MS, type WaitResult } from "./result-queue.js";
import type {
  GentuiSession,
  UpdateResult,
} from "./runtime.js";
import type { TerminalOpenResult } from "./terminal.js";
import type { UiDocument, UiPatchOp, UiResult } from "./protocol.js";
import { validateDocument } from "./validate.js";

export type GentuiToolInput =
  | { operation: "catalog" }
  | { operation: "open"; document: UiDocument }
  | { operation: "update"; sessionId: string; sequence: number; update: UiDocument | UiPatchOp[] }
  | { operation: "wait"; sessionId: string; timeoutMs?: number }
  | { operation: "close"; sessionId: string; reason?: string };

export type GentuiToolOutput =
  | { status: "ok"; sessionId?: string; catalog?: UiCatalog; update?: UpdateResult; results?: UiResult[] }
  | { status: "unsupported"; reason: string }
  | {
      status: "invalid";
      reason: "serialization" | "malformed_input" | "unknown_operation" | "update_rejected" | "operation_failed";
      errors: ValidationDiagnostic[];
      update?: UpdateResult;
      results?: UiResult[];
    }
  | { status: "unknown_session"; sessionId: string }
  | { status: "closed"; sessionId?: string; result?: UiResult };

/** A runtime or terminal host accepted by the tool adapter. */
export interface AgentToolHost {
  catalog(): UiCatalog;
  open(input: { document: UiDocument }): Promise<GentuiSession | TerminalOpenResult>;
}

export interface GentuiAgentTool {
  execute(input: unknown): Promise<GentuiToolOutput>;
}

function diagnostic(code: ValidationDiagnostic["code"], path: ValidationDiagnostic["path"], message: string): ValidationDiagnostic {
  return { code, path, message };
}

function invalid(
  reason: Extract<GentuiToolOutput, { status: "invalid" }>["reason"],
  code: ValidationDiagnostic["code"],
  path: ValidationDiagnostic["path"],
  message: string,
): GentuiToolOutput {
  return { status: "invalid", reason, errors: [diagnostic(code, path, message)] };
}

function jsonClone<T>(input: T): T {
  const seen = new Set<object>();
  const inspect = (value: unknown, path: ReadonlyArray<string | number>): void => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number") {
      if (Number.isFinite(value)) return;
      throw new TypeError(`non-JSON number at ${path.join(".")}`);
    }
    if (typeof value !== "object") throw new TypeError(`non-JSON value at ${path.join(".")}`);
    if (seen.has(value)) throw new TypeError(`cyclic value at ${path.join(".")}`);
    seen.add(value);
    try {
      const prototype = Object.getPrototypeOf(value);
      if (Array.isArray(value)) {
        if (prototype !== Array.prototype) throw new TypeError(`capability-bearing array at ${path.join(".")}`);
        for (let index = 0; index < value.length; index++) {
          if (!Object.hasOwn(value, index)) throw new TypeError(`sparse array at ${path.join(".")}`);
          inspect(value[index], [...path, index]);
        }
      } else {
        if (prototype !== Object.prototype && prototype !== null) {
          throw new TypeError(`capability-bearing object at ${path.join(".")}`);
        }
        if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError(`symbol key at ${path.join(".")}`);
        for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
          if (!("value" in descriptor)) throw new TypeError(`accessor at ${[...path, key].join(".")}`);
          inspect(descriptor.value, [...path, key]);
        }
      }
    } finally {
      seen.delete(value);
    }
  };
  inspect(input, []);
  return JSON.parse(JSON.stringify(input)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(input: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(input).every((key) => allowed.includes(key));
}

function parseInput(input: unknown):
  | { ok: true; value: GentuiToolInput }
  | { ok: false; output: GentuiToolOutput } {
  if (!isRecord(input) || typeof input.operation !== "string") {
    return { ok: false, output: invalid("malformed_input", DiagnosticCode.MalformedToolInput, [], "tool input must be an operation object") };
  }
  switch (input.operation) {
    case "catalog":
      if (!exactKeys(input, ["operation"])) break;
      return { ok: true, value: { operation: "catalog" } };
    case "open": {
      if (!exactKeys(input, ["operation", "document"]) || input.document === undefined) break;
      const validation = validateDocument(input.document);
      if (!validation.ok) {
        return { ok: false, output: { status: "invalid", reason: "malformed_input", errors: validation.diagnostics } };
      }
      return { ok: true, value: { operation: "open", document: validation.document } };
    }
    case "update": {
      if (!exactKeys(input, ["operation", "sessionId", "sequence", "update"]) ||
          typeof input.sessionId !== "string" || input.sessionId.length === 0 ||
          !Number.isSafeInteger(input.sequence) || (input.sequence as number) < 0 ||
          (!Array.isArray(input.update) && !isRecord(input.update))) break;
      return { ok: true, value: input as unknown as GentuiToolInput };
    }
    case "wait":
      if (!exactKeys(input, ["operation", "sessionId", "timeoutMs"]) ||
          typeof input.sessionId !== "string" || input.sessionId.length === 0 ||
          (input.timeoutMs !== undefined && (!Number.isInteger(input.timeoutMs) || (input.timeoutMs as number) < 0 || (input.timeoutMs as number) > MAX_WAIT_MS))) break;
      return { ok: true, value: input as unknown as GentuiToolInput };
    case "close":
      if (!exactKeys(input, ["operation", "sessionId", "reason"]) ||
          typeof input.sessionId !== "string" || input.sessionId.length === 0 ||
          (input.reason !== undefined && typeof input.reason !== "string")) break;
      return { ok: true, value: input as unknown as GentuiToolInput };
    default:
      return { ok: false, output: invalid("unknown_operation", DiagnosticCode.UnknownOperation, ["operation"], "operation is not supported") };
  }
  return { ok: false, output: invalid("malformed_input", DiagnosticCode.MalformedToolInput, [], "operation input is malformed") };
}

function terminalSession(opened: GentuiSession | TerminalOpenResult): GentuiSession | TerminalOpenResult {
  return opened;
}

export function createAgentTool(host: AgentToolHost): GentuiAgentTool {
  const sessions = new Map<string, GentuiSession>();
  const closed = new Set<string>();

  const safeOutput = (output: GentuiToolOutput): GentuiToolOutput => {
    try {
      return jsonClone(output);
    } catch {
      return invalid("serialization", DiagnosticCode.NonSerializable, [], "tool output is not JSON-compatible");
    }
  };

  const lookup = (sessionId: string): { session: GentuiSession } | { output: GentuiToolOutput } => {
    const session = sessions.get(sessionId);
    if (session) return { session };
    return { output: closed.has(sessionId) ? { status: "closed", sessionId } : { status: "unknown_session", sessionId } };
  };

  const markClosed = (sessionId: string): void => {
    sessions.delete(sessionId);
    closed.add(sessionId);
  };

  const translateWait = (sessionId: string, waited: WaitResult): GentuiToolOutput => {
    if (waited.status === "results") {
      if (waited.sessionState === "closed") markClosed(sessionId);
      return { status: "ok", results: [...waited.results] };
    }
    if (waited.status === "timeout") return { status: "ok", results: [] };
    if (waited.status === "closed") {
      markClosed(sessionId);
      return { status: "closed", sessionId };
    }
    return { status: "invalid", reason: "operation_failed", errors: [diagnostic(DiagnosticCode.OperationFailed, [], "wait was interrupted")] };
  };

  return {
    async execute(rawInput: unknown): Promise<GentuiToolOutput> {
      let cloned: unknown;
      try {
        cloned = jsonClone(rawInput);
      } catch {
        return invalid("serialization", DiagnosticCode.NonSerializable, [], "tool input is not JSON-compatible");
      }
      const parsed = parseInput(cloned);
      if (!parsed.ok) return safeOutput(parsed.output);
      const input = parsed.value;

      try {
        if (input.operation === "catalog") return safeOutput({ status: "ok", catalog: host.catalog() });
        if (input.operation === "open") {
          const opened = terminalSession(await host.open({ document: input.document }));
          if ("status" in opened) {
            if (opened.status === "unsupported") return safeOutput(opened);
            sessions.set(opened.session.id, opened.session);
            return safeOutput({ status: "ok", sessionId: opened.session.id });
          }
          sessions.set(opened.id, opened);
          return safeOutput({ status: "ok", sessionId: opened.id });
        }

        const found = lookup(input.sessionId);
        if ("output" in found) return safeOutput(found.output);
        const session = found.session;

        if (input.operation === "wait") {
          return safeOutput(translateWait(input.sessionId, await session.wait(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })));
        }
        if (input.operation === "close") {
          const result = await session.close(input.reason);
          markClosed(input.sessionId);
          return safeOutput({ status: "closed", result });
        }

        // Drain first so a terminal user result prevents mutation of a session
        // that closed while the agent was doing other work.
        const pending = await session.wait({ timeoutMs: 0 });
        if (pending.status === "closed") {
          markClosed(input.sessionId);
          return safeOutput({ status: "closed", sessionId: input.sessionId });
        }
        if (pending.status === "results" && pending.sessionState === "closed") {
          markClosed(input.sessionId);
          return safeOutput({ status: "ok", results: [...pending.results] });
        }

        const update = await session.update({
          sessionId: input.sessionId,
          sequence: input.sequence,
          ...(Array.isArray(input.update) ? { patch: input.update } : { document: input.update }),
        });
        if (update.status === "rejected") {
          const errors = update.reason === "validation"
            ? update.errors
            : [diagnostic(DiagnosticCode.InvalidSequence, ["sequence"], `update sequence was ${update.reason}`)];
          const results = pending.status === "results" ? [...pending.results] : [];
          return safeOutput({
            status: "invalid",
            reason: "update_rejected",
            errors,
            update,
            ...(results.length > 0 ? { results } : {}),
          });
        }
        const after = await session.wait({ timeoutMs: 0 });
        const results = [
          ...(pending.status === "results" ? pending.results : []),
          ...(after.status === "results" ? after.results : []),
        ];
        if ((after.status === "results" && after.sessionState === "closed") || after.status === "closed") markClosed(input.sessionId);
        return safeOutput({ status: "ok", update, ...(results.length > 0 ? { results: [...results] } : {}) });
      } catch (error) {
        if (error instanceof DocumentInvalidError) {
          return safeOutput({ status: "invalid", reason: "malformed_input", errors: error.diagnostics });
        }
        return safeOutput(invalid("operation_failed", DiagnosticCode.OperationFailed, [], "tool operation failed"));
      }
    },
  };
}
