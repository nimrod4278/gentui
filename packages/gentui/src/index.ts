// Public entry point for the `gentui` package.

export const PACKAGE_NAME = "gentui" as const;
export { PROTOCOL_VERSION } from "./version.js";

export type {
  ComponentType,
  UiDocument,
  UiNode,
  UiIntent,
  UiResult,
  UiPatchOp,
  PatchPath,
} from "./protocol.js";
export type {
  InteractionState,
  InteractionStateField,
  InteractionStateUpdate,
  InteractionReset,
} from "./interaction-state.js";
export type {
  Frame,
  KeyboardHelpLabel,
  RenderInput,
  RendererAdapter,
  RendererInput,
  RendererKey,
  InputOutcome,
  InputHandler,
  TerminalProfile,
} from "./renderer.js";
export { DEFAULT_PROFILE } from "./renderer.js";
export {
  createTextRenderer,
  type TextRenderer,
  type TextRendererOptions,
} from "./text-renderer.js";
export {
  createTerminalRenderer,
  createTerminalHost,
  createPromptTerminalHost,
  detectTerminalCapabilities,
  unsupportedTerminal,
  type SignalSource,
  type TerminalCapabilities,
  type TerminalHost,
  type TerminalHostController,
  type TerminalHostOptions,
  type PromptHostController,
  type PromptTerminalHostOptions,
  type TerminalInput,
  type TerminalOpenResult,
  type TerminalOutput,
  type TerminalRenderer,
  type TerminalRendererOptions,
  type TerminalSupport,
} from "./terminal.js";
export {
  createRuntime,
  type GentuiRuntime,
  type GentuiSession,
  type RuntimeOptions,
  type UpdateInput,
  type UpdateResult,
} from "./runtime.js";
export {
  createAgentTool,
  type AgentToolHost,
  type GentuiAgentTool,
  type GentuiToolInput,
  type GentuiToolOutput,
} from "./agent-tool.js";
export {
  MAX_WAIT_MS,
  type WaitOptions,
  type WaitResult,
  type WaitNotice,
} from "./result-queue.js";
export { realClock, type RuntimeClock, type TimerId } from "./clock.js";
export { applyPatch, type ApplyPatchOptions, type ApplyPatchResult } from "./patch.js";
export { validateDocument, type ValidateOptions } from "./validate.js";
export {
  DiagnosticCode,
  DocumentInvalidError,
  type DiagnosticPath,
  type ValidationDiagnostic,
  type ValidationResult,
} from "./diagnostics.js";
export { DEFAULT_LIMITS, type DocumentLimits } from "./limits.js";
export { sanitizeText } from "./sanitize.js";
export {
  parseFileList,
  parseDiagnostics,
  parseSelectOptions,
  type FileListEntry,
  type FileStatus,
  type SelectOption,
  type DiagnosticEntry,
  type DiagnosticSeverity,
} from "./content.js";
export { emptyInteractionState, mergeInteractionState, reconcileInteractionState } from "./interaction-state.js";
export {
  standardNodeRegistry,
  type ChildPolicy,
  type NodeDefinition,
  type NodeRegistry,
  type PropSpec,
} from "./node-registry.js";
export {
  buildCatalog,
  standardCatalog,
  CATALOG_VERSION,
  DEFAULT_THEME,
  type BuildCatalogOptions,
  type CatalogComponent,
  type CatalogPropDescriptor,
  type Theme,
  type UiCatalog,
} from "./catalog.js";
