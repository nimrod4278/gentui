# 2. Runtime architecture

## Pipeline

```text
agent -> host gentui adapter -> validator -> reconciler -> renderer
              ^                                      |
              |                                      v
              +--------- typed interaction results <- event router
```

The existing agent owns model generation. Gentui does not call Gemini, OpenAI, Claude, OpenRouter, or any other model in v1.

### Host application

Owns the agent loop, model access, credentials, tools, permissions, durable state, and terminal handoff. It installs a gentui adapter, registers the available catalog, and exposes the serializable gentui tool to the agent.

A skill alone does not grant this capability. If the host has no gentui adapter or cannot safely hand off the terminal, the agent must use normal text.

### Host adapter

Translates the agent framework's tool calls into the in-process runtime interface. It coordinates terminal ownership, validates session identity, queues interaction results, and restores the host interface when the session closes or fails.

### Validator

Checks schema version, registered node types, typed props, bounds, IDs, intent references, and maximum document size. Invalid updates are rejected with structured diagnostics and never reach the renderer.

### Reconciler

Applies complete documents or patch batches while preserving stable node identity, focus, scroll position, and local input values. Updates are transactional: if validation fails, the last valid tree remains visible.

### Renderer

A pluggable terminal renderer. The first candidate is Ink, but it must pass the terminal-handoff prototype before being fixed for v1. Rendering must be deterministic and possible in memory for tests.

### Event router

Maps keyboard and supported mouse events to focus movement and typed interaction results. It does not execute generated commands or agent tools.

## Runtime state

Separate these categories:

- **Document state:** agent-selected structure and presentation metadata.
- **Interaction state:** focus, selection, cursor, scroll, form values, and pending submission.
- **Session state:** session ID, update sequence, queued results, cancellation, and errors.
- **Host state:** model context, domain state, permissions, and tools; never owned by gentui.

A document update must not overwrite user-entered values unless the host explicitly requests a reset.

## Initial rendering model

The first release is defined by one polished coding-agent experience rather than an unlimited catalog:

- layout: `stack`, `row`, `panel`, `tabs`
- content: `text`, `markdown`, `file-list`, `diff`, `diagnostics`
- status: `progress`, `spinner`, `error`, `empty`
- input: `input`, `select`, `checkbox`, `confirm`, `button`

Every node has a stable `id`, schema-defined props, children where allowed, and optional interaction intents. Themes are fixed; agents may select only documented semantic variants.

## Lifecycle

1. The host verifies terminal support and hands terminal control to gentui.
2. The agent opens a temporary session with an initial valid document.
3. The agent sends complete documents or transactional patch batches.
4. Gentui reconciles and renders each committed update.
5. User interactions become typed results queued for the agent.
6. The agent uses its existing host tools and approval system for any side effect.
7. The agent or user closes the session; gentui restores terminal state and returns a final result.

## Failure behavior

- Unsupported terminal: do not start; return `unsupported` so the host can use text.
- Agent disconnect or timeout: retain the last valid view until cancellation, then restore the host terminal.
- Validation failure: reject the bad update and preserve the prior document.
- Resize: recompute layout without asking the agent to redraw.
- Slow updates: keep the existing screen usable and show only local status supplied by the host.
- Exception or process signal: restore terminal modes and host ownership on every exit path.
