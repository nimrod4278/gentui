// Protocol v1 document, node, intent, and result types. Source of truth for
// the serializable, provider-neutral JSON contract (spec/03-schema.md).

export type ComponentType = string;

export interface UiIntent {
  name: string;
  payload?: Record<string, unknown>;
}

export interface UiNode {
  id: string;
  type: ComponentType;
  props: Record<string, unknown>;
  children?: UiNode[];
  events?: Record<string, UiIntent>;
}

export interface UiDocument {
  version: "1";
  id: string;
  title?: string;
  root: UiNode;
  metadata?: Record<string, string>;
}

/** A path of object keys / array indices from the document root to a target. */
export type PatchPath = ReadonlyArray<string | number>;

/**
 * A single transactional patch operation (spec/03-schema.md "Patch stream").
 * `set` assigns a value (creating or overwriting); `replace` requires the target
 * to already exist; `remove` deletes it. A batch is applied to a copy, validated
 * as a whole, and committed atomically.
 */
export type UiPatchOp =
  | { type: "set"; path: PatchPath; value: unknown }
  | { type: "replace"; path: PatchPath; value: unknown }
  | { type: "remove"; path: PatchPath };

export type UiResult =
  | { type: "submit"; intent: string; values: Record<string, unknown> }
  | { type: "select"; intent: string; value: unknown }
  | { type: "confirm"; intent: string; approved: boolean }
  | { type: "cancel"; reason?: string }
  | { type: "close" }
  | { type: "unsupported"; reason: string }
  | { type: "error"; code: string; message: string };
