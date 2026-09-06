// Stable, structured validation diagnostics.
//
// A diagnostic identifies WHAT rule failed (a stable `code`) and WHERE (a
// machine-readable `path` of keys/indices from the document root). Messages are
// generic and MUST NOT echo untrusted prop values, which may contain secrets.

export const DiagnosticCode = {
  InvalidDocument: "invalid_document",
  UnsupportedVersion: "unsupported_version",
  InvalidNode: "invalid_node",
  DuplicateId: "duplicate_id",
  UnknownNodeType: "unknown_node_type",
  UnknownProp: "unknown_prop",
  InvalidProp: "invalid_prop",
  ChildrenNotAllowed: "children_not_allowed",
  DisallowedEvent: "disallowed_event",
  InvalidIntent: "invalid_intent",
  MaxBytesExceeded: "max_bytes_exceeded",
  MaxDepthExceeded: "max_depth_exceeded",
  MaxNodesExceeded: "max_nodes_exceeded",
  MaxTextLengthExceeded: "max_text_length_exceeded",
  MaxPatchOpsExceeded: "max_patch_ops_exceeded",
  // Update-operation (session.update) input diagnostics.
  InvalidSession: "invalid_session",
  InvalidSequence: "invalid_sequence",
  InvalidUpdate: "invalid_update",
  InvalidPatch: "invalid_patch",
  // Agent-tool operation diagnostics.
  MalformedToolInput: "malformed_tool_input",
  UnknownOperation: "unknown_operation",
  NonSerializable: "non_serializable",
  OperationFailed: "operation_failed",
} as const;

export type DiagnosticCode = (typeof DiagnosticCode)[keyof typeof DiagnosticCode];

export type DiagnosticPath = ReadonlyArray<string | number>;

export interface ValidationDiagnostic {
  code: DiagnosticCode;
  path: DiagnosticPath;
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; document: T }
  | { ok: false; diagnostics: ValidationDiagnostic[] };

/** Thrown by `runtime.open` when a document fails validation. */
export class DocumentInvalidError extends Error {
  readonly code = "invalid_document";
  readonly diagnostics: ValidationDiagnostic[];

  constructor(diagnostics: ValidationDiagnostic[]) {
    super(`document rejected: ${diagnostics.length} diagnostic(s)`);
    this.name = "DocumentInvalidError";
    this.diagnostics = diagnostics;
  }
}
