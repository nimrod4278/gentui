# Architecture

Gentui separates untrusted UI data from trusted host capabilities.

```text
agent -> host adapter -> validator -> runtime -> renderer -> terminal
                         ^                         |
                         +---- typed results <----+
```

## Boundaries

- **Agent:** chooses from the advertised catalog and submits serializable operations. It does not own terminal input or rendering.
- **Host adapter:** owns the model loop, permissions, tool execution, and terminal handoff. It exposes the gentui tool and decides whether interactive rendering is supported.
- **Validator:** checks the protocol version, tree shape, known node types, props, events, serializability, and resource limits before data reaches a renderer.
- **Runtime:** owns the current valid document, transactional updates, interaction state, focus, sequencing, and the bounded result queue.
- **Renderer:** converts a committed document and terminal profile into a deterministic frame, forwards semantic input, and releases resources on cleanup.

## Session lifecycle

1. The adapter checks capabilities and acquires its host-specific UI surface.
2. `open` validates a complete protocol-v1 document and renders sequence zero.
3. `update` accepts either a complete replacement or a transactional patch batch with the next sequence number.
4. Renderer input is checked against the currently committed node and intent before a typed result is queued.
5. `wait` consumes each result at most once and supports cancellation and bounded timeouts.
6. `close`, cancellation, failures, reloads, and shutdown converge on idempotent cleanup.

## State model

Documents describe presentation and declared intents. Interaction state (focus, selected tabs and options, text cursor/value, and confirmation state) is runtime-owned and reconciled by stable node IDs across updates. Host state—including credentials, domain data, authorization decisions, and durable records—never belongs to gentui.

## Public seams

- `createRuntime()` is the in-process integration seam.
- `createAgentTool()` is the serializable agent-facing seam.
- `RendererAdapter` is the trusted renderer seam.
- `TerminalHost` coordinates terminal ownership for host integrations.
- `gentui-testing` provides deterministic implementations of these seams for tests.

For exact wire operations, see [the host integration protocol](../spec/09-host-integration.md). For schema details, see [the document protocol](../spec/03-schema.md).
