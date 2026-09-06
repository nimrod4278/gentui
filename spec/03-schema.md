# 3. Document and interaction schema

The protocol is versioned, provider-neutral JSON. The package exports JSON Schema, TypeScript types, and runtime parsers from one source of truth.

## Document

```ts
interface UiDocument {
  version: "1";
  id: string;
  title?: string;
  root: UiNode;
  metadata?: Record<string, string>;
}

interface UiNode {
  id: string;
  type: ComponentType;
  props: Record<string, unknown>; // validated against the registered type
  children?: UiNode[];
  events?: Record<string, UiIntent>;
}

interface UiIntent {
  name: string;
  payload?: Record<string, unknown>;
}
```

An intent describes a result to return, not executable behavior. It cannot contain callbacks, commands, scripts, network requests, or permission decisions.

## Interaction results

```ts
type UiResult =
  | { type: "submit"; intent: string; values: Record<string, unknown> }
  | { type: "select"; intent: string; value: unknown }
  | { type: "confirm"; intent: string; approved: boolean }
  | { type: "cancel"; reason?: string }
  | { type: "close" }
  | { type: "unsupported"; reason: string }
  | { type: "error"; code: string; message: string };
```

The agent receives a result and may then call its existing host tools. A confirmation result records the user's answer; it does not itself execute a side effect or bypass host approval policy.

## Patch stream

Agents may replace a complete document or send transactional patch batches:

```ts
{ type: "replace", path: ["root", "children", 0], value: UiNode }
{ type: "set", path: ["root", "props", "title"], value: "Tests" }
{ type: "remove", path: ["root", "children", 2] }
```

Each batch includes a session ID and monotonically increasing sequence number. The runtime applies a batch to a copy, validates the complete result, and commits atomically. Unknown node types or invalid props reject the batch; the last valid document remains visible.

## Props rules

- Props are JSON-compatible, type-specific, and schema-bounded.
- Text has maximum lengths; markdown is a distinct, sanitized node type.
- Styling is limited to fixed theme tokens and documented semantic variants.
- Layout values use constrained numbers or named tokens.
- Terminal control sequences are escaped by the renderer.
- File paths may appear as inert display data for file lists and diffs, but never grant filesystem access.
- Props cannot contain callbacks, scripts, shell commands, credentials, or capability-bearing objects.

## Catalog handshake

Before generation, the agent must be able to inspect the host's catalog:

```ts
interface UiCatalog {
  protocolVersion: "1";
  components: Array<{
    type: string;
    description: string;
    propsSchema: JsonSchema;
    allowedEvents: string[];
  }>;
  limits: DocumentLimits;
  theme: { name: string; semanticVariants: string[] };
}
```

The skill supplies general composition guidance; the catalog is the source of truth for what a particular host supports.

## Direct host operations

Custom host-owned operations may be added by an advanced adapter later. They are not part of the v1 document protocol. In v1, gentui returns interaction results and the agent invokes its normal tools under the host's existing authorization rules.
