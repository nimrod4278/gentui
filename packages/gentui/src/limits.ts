// Conservative protocol-v1 document safety limits. Validation reads these
// defaults so a host can tighten them without changing runtime code.

export interface DocumentLimits {
  /** Maximum serialized document size in UTF-8 bytes. */
  maxBytes: number;
  /** Maximum node depth from the root (root = depth 1). */
  maxDepth: number;
  /** Maximum total node count. */
  maxNodes: number;
  /** Maximum length, in code points, of any string prop. */
  maxTextLength: number;
  /** Maximum number of operations in a single patch batch. */
  maxPatchOps: number;
  /** Maximum number of normal interaction results buffered before backpressure. */
  maxPendingResults: number;
}

export const DEFAULT_LIMITS: DocumentLimits = {
  maxBytes: 65_536,
  maxDepth: 32,
  maxNodes: 1_000,
  maxTextLength: 4_096,
  maxPatchOps: 256,
  maxPendingResults: 100,
};
