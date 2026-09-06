# 4. Developer experience

There are two distinct interfaces: the in-process runtime used by host adapters and the serializable tool used by agents. Keeping this seam explicit prevents agent-framework details from leaking into the renderer.

## Host runtime interface

```ts
import { createRuntime, createTextRenderer } from "gentui";

const renderer = createTextRenderer();
const runtime = createRuntime({ renderer });

const session = await runtime.open({ document });
await session.update({ sequence: 1, patch });

for await (const result of session.results) {
  host.deliverToolResult(result);
}

await session.close();
```

The runtime is a deep module: validation, reconciliation, focus preservation, input state, rendering, terminal cleanup, and result queuing sit behind the small session interface.

## Agent tool interface

Agents use the serializable `open`, `update`, `wait`, and `close` operations specified in [the host integration protocol](09-host-integration.md). They never import modules, evaluate generated code, or create files to display a UI.

## Components versus interaction results

A **component** is what the user sees or manipulates: a table, form, button, diff, dashboard, or progress indicator. An **interaction result** is data returned to the agent: submitted form values, a selected item, approval, cancellation, or closure.

Gentui does not execute the agent's file, shell, network, or deployment tools in v1. After receiving an interaction result, the agent uses its existing tools and the host's existing authorization flow.

## Module authoring

A renderer module for a catalog entry defines:

- stable type name and version
- JSON props schema
- model-facing usage description
- rendering implementation
- keyboard and focus behavior
- accessible label strategy
- size and terminal capability requirements
- allowed interaction intents

Generated documents can reference only entries advertised by the current host catalog. Installed renderer modules are trusted host code; generated documents remain untrusted data.

## Testing

Ship first-class helpers for:

- validating documents and patch batches
- fake agent tool calls
- terminal capability profiles
- event simulation
- deterministic frame snapshots
- terminal handoff and restoration tests
- interaction-result tests
- property-based fuzzing of untrusted documents

A test must be able to apply a document and simulate interaction without starting a real terminal or model.

## Observability

Expose structured hooks for session start/end, validation rejection, patch commit, render duration, interaction result, cancellation, and terminal restoration. Never log secrets, complete documents, or user-entered values by default.

## Documentation

The package needs a quickstart, agent-host adapter guide, catalog reference, custom renderer-module guide, security guide, testing guide, terminal compatibility matrix, and migration notes.
