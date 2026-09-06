// Node definitions: the single source of truth for which node types exist,
// their description, props, child policy, allowed events, and a valid example.
// Validation reads these, and the discoverable catalog is serialized from the
// same definitions so the two cannot drift.

import type { UiNode } from "./protocol.js";

export interface PropSpec {
  type: "string" | "boolean" | "number" | "json";
  required?: boolean;
  /** Reject empty and whitespace-only strings (used by accessible labels). */
  nonEmpty?: boolean;
  /** Inclusive numeric bounds, advertised in the catalog and enforced before rendering. */
  minimum?: number;
  maximum?: number;
  integer?: boolean;
}

export type ChildPolicy = "leaf" | "container";

export interface NodeDefinition {
  type: string;
  description: string;
  props: Record<string, PropSpec>;
  childPolicy: ChildPolicy;
  allowedEvents: string[];
  /** A minimal valid instance of this node, advertised in the catalog. */
  example: UiNode;
  /** Prop carrying the accessible name for an interactive node. */
  accessibleLabelProp?: string;
  /** Discoverable keyboard path advertised in the catalog. */
  keyboard?: string[];
}

export type NodeRegistry = Record<string, NodeDefinition>;

export const standardNodeRegistry: NodeRegistry = {
  text: {
    type: "text",
    description: "A single run of read-only text.",
    props: { content: { type: "string", required: true } },
    childPolicy: "leaf",
    allowedEvents: [],
    example: { id: "text-example", type: "text", props: { content: "Example text" } },
  },
  input: {
    type: "input", description: "A text input control.",
    props: { label: { type: "string", required: true, nonEmpty: true }, name: { type: "string" }, value: { type: "string" }, secret: { type: "boolean" }, required: { type: "boolean" }, disabled: { type: "boolean" }, hidden: { type: "boolean" }, maxLength: { type: "number", minimum: 0, integer: true } },
    childPolicy: "leaf", allowedEvents: ["activate"], accessibleLabelProp: "label", keyboard: ["Tab", "Shift+Tab", "Enter"], example: { id: "input-example", type: "input", props: { label: "Name", value: "" }, events: { activate: { name: "submit" } } },
  },
  select: {
    type: "select", description: "A typed selection control whose options have stable IDs.",
    props: { label: { type: "string", required: true, nonEmpty: true }, name: { type: "string" }, options: { type: "json" }, required: { type: "boolean" }, disabled: { type: "boolean" }, hidden: { type: "boolean" } },
    childPolicy: "leaf", allowedEvents: ["activate"], accessibleLabelProp: "label", keyboard: ["Tab", "Shift+Tab", "ArrowUp", "ArrowDown", "Enter"], example: { id: "select-example", type: "select", props: { label: "Choice", options: [{ id: "one", label: "One", value: 1 }] }, events: { activate: { name: "select" } } },
  },
  checkbox: {
    type: "checkbox", description: "A boolean checkbox control.",
    props: { label: { type: "string", required: true, nonEmpty: true }, name: { type: "string" }, checked: { type: "boolean" }, disabled: { type: "boolean" }, hidden: { type: "boolean" } },
    childPolicy: "leaf", allowedEvents: ["activate"], accessibleLabelProp: "label", keyboard: ["Tab", "Shift+Tab", "Enter"], example: { id: "checkbox-example", type: "checkbox", props: { label: "Ready", checked: false }, events: { activate: { name: "toggle" } } },
  },
  confirm: {
    type: "confirm", description: "An explicit, data-only operation confirmation.",
    props: { label: { type: "string", required: true, nonEmpty: true }, operation: { type: "string" }, target: { type: "string" }, arguments: { type: "string" }, risk: { type: "string" }, disabled: { type: "boolean" }, hidden: { type: "boolean" } },
    childPolicy: "leaf", allowedEvents: ["activate"], accessibleLabelProp: "label", keyboard: ["Tab", "Shift+Tab", "Enter", "Ctrl+Enter"], example: { id: "confirm-example", type: "confirm", props: { label: "Continue?", operation: "deploy", target: "staging", risk: "low" }, events: { activate: { name: "confirm" } } },
  },
  progress: {
    type: "progress", description: "A bounded progress indicator.",
    props: { value: { type: "number", required: true, minimum: 0, maximum: 1 }, label: { type: "string", required: true } },
    childPolicy: "leaf", allowedEvents: [], example: { id: "progress-example", type: "progress", props: { value: 0, label: "Working" } },
  },
  spinner: {
    type: "spinner", description: "A status indicator for ongoing work.",
    props: { label: { type: "string", required: true } }, childPolicy: "leaf", allowedEvents: [],
    example: { id: "spinner-example", type: "spinner", props: { label: "Loading" } },
  },
  error: {
    type: "error", description: "An actionable error status.",
    props: { message: { type: "string", required: true }, label: { type: "string", nonEmpty: true } }, childPolicy: "leaf", allowedEvents: [],
    example: { id: "error-example", type: "error", props: { message: "Something went wrong" } },
  },
  empty: {
    type: "empty", description: "An empty-state message.",
    props: { label: { type: "string", required: true }, detail: { type: "string" } }, childPolicy: "leaf", allowedEvents: [],
    example: { id: "empty-example", type: "empty", props: { label: "Nothing here" } },
  },
  row: {
    type: "row",
    description: "A horizontal container that lays out its children.",
    props: {}, childPolicy: "container", allowedEvents: [],
    example: { id: "row-example", type: "row", props: {}, children: [{ id: "row-example-child", type: "text", props: { content: "Child" } }] },
  },
  panel: {
    type: "panel",
    description: "A bordered container with an optional title.",
    props: { title: { type: "string" } }, childPolicy: "container", allowedEvents: [],
    example: { id: "panel-example", type: "panel", props: { title: "Panel" }, children: [{ id: "panel-example-child", type: "text", props: { content: "Child" } }] },
  },
  markdown: {
    type: "markdown", description: "Read-only markdown content.",
    props: { content: { type: "string", required: true } }, childPolicy: "leaf", allowedEvents: [],
    example: { id: "markdown-example", type: "markdown", props: { content: "# Example" } },
  },
  "file-list": {
    type: "file-list", description: "A navigable list of inert file records: status, stable ID, path, and optional previous path separated by tabs.",
    props: { content: { type: "string", required: true }, label: { type: "string", nonEmpty: true } },
    childPolicy: "leaf", allowedEvents: ["activate"], accessibleLabelProp: "label",
    keyboard: ["Tab", "Shift+Tab", "ArrowUp", "ArrowDown", "Enter"],
    example: { id: "file-list-example", type: "file-list", props: { content: "modified\tfile-1\tsrc/example.ts", label: "Changed files" }, events: { activate: { name: "choose-file" } } },
  },
  diff: {
    type: "diff", description: "A read-only unified diff.",
    props: { content: { type: "string", required: true } }, childPolicy: "leaf", allowedEvents: [],
    example: { id: "diff-example", type: "diff", props: { content: "+ added" } },
  },
  diagnostics: {
    type: "diagnostics", description: "Read-only diagnostics.",
    props: { content: { type: "string", required: true } }, childPolicy: "leaf", allowedEvents: [],
    example: { id: "diagnostics-example", type: "diagnostics", props: { content: "No diagnostics" } },
  },
  tabs: {
    type: "tabs",
    description: "A keyboard-navigable container displaying one active child at a time.",
    props: { label: { type: "string", nonEmpty: true } }, childPolicy: "container", allowedEvents: ["activate"],
    accessibleLabelProp: "label", keyboard: ["Tab", "Shift+Tab", "Enter", "ArrowLeft", "ArrowRight"],
    example: { id: "tabs-example", type: "tabs", props: {}, children: [{ id: "tabs-example-child", type: "text", props: { content: "Tab" } }] },
  },
  stack: {
    type: "stack",
    description: "A vertical container that stacks its children.",
    props: {},
    childPolicy: "container",
    allowedEvents: [],
    example: {
      id: "stack-example",
      type: "stack",
      props: {},
      children: [{ id: "stack-example-child", type: "text", props: { content: "Child" } }],
    },
  },
  form: {
    type: "form", description: "A scope for collecting descendant control values.",
    props: { label: { type: "string", nonEmpty: true } }, childPolicy: "container", allowedEvents: [],
    example: { id: "form-example", type: "form", props: { label: "Settings" }, children: [{ id: "form-field", type: "input", props: { label: "Name", name: "name" } }] },
  },
  button: {
    type: "button",
    description: "An activatable control that emits its bound intent when activated.",
    props: { label: { type: "string", required: true, nonEmpty: true }, disabled: { type: "boolean" }, hidden: { type: "boolean" }, form: { type: "string" } },
    childPolicy: "leaf",
    allowedEvents: ["activate"],
    accessibleLabelProp: "label",
    keyboard: ["Tab", "Shift+Tab", "Enter"],
    example: {
      id: "button-example",
      type: "button",
      props: { label: "Continue" },
      events: { activate: { name: "continue" } },
    },
  },
};
