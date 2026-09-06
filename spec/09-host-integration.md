# 9. Host integration protocol

A skill cannot take control of a terminal by itself. A compatible CLI host installs an adapter that exposes a serializable gentui tool to the agent and connects it to the in-process runtime. Both interfaces are defined here and use memory only.

## Agent-facing tool interface

The host exposes one `gentui` tool with an operation-tagged JSON input:

```ts
type GentuiToolInput =
  | { operation: "catalog" }
  | { operation: "open"; document: UiDocument }
  | { operation: "update"; sessionId: string; sequence: number; update: UiDocument | UiPatch[] }
  | { operation: "wait"; sessionId: string; timeoutMs?: number }
  | { operation: "close"; sessionId: string; reason?: string };

type GentuiToolOutput =
  | { status: "ok"; sessionId?: string; catalog?: UiCatalog; update?: UpdateResult; results?: UiResult[] }
  | { status: "unsupported"; reason: string }
  | { status: "invalid"; reason: "serialization" | "malformed_input" | "unknown_operation" | "update_rejected" | "operation_failed"; errors: ValidationDiagnostic[]; update?: UpdateResult; results?: UiResult[] }
  | { status: "unknown_session"; sessionId: string }
  | { status: "closed"; sessionId?: string; result?: UiResult };
```

- `catalog` tells the agent exactly which node types, props, events, limits, and semantic variants are available.
- `open` validates a complete initial document, hands off the terminal, and returns a session ID.
- `update` transactionally applies a document or patch batch and returns any queued results without blocking.
- `wait` blocks until an interaction result, cancellation, closure, or timeout. It lets an agent gather form input or confirmation without an unserializable event stream.
- `close` restores the host terminal and ends the temporary session.

A host may expose equivalent native operations, but its agent skill and catalog must describe any differences.

## In-process runtime interface

Host adapters use a richer TypeScript interface internally:

```ts
interface GentuiRuntime {
  catalog(): UiCatalog;
  open(input: { document: UiDocument }): Promise<GentuiSession>;
}

interface GentuiSession {
  readonly id: string;
  readonly results: AsyncIterable<UiResult>;
  update(input: { sequence: number; update: UiDocument | UiPatch[] }): Promise<UpdateResult>;
  close(reason?: string): Promise<UiResult>;
}
```

The adapter translates between the serializable tool calls and this runtime interface, including queueing results while the agent performs other work.

## Lifecycle

1. Agent reads the skill and calls `catalog`.
2. Host verifies that terminal handoff is supported.
3. Agent calls `open` with an initial valid document.
4. Agent performs work and calls `update`; each response may contain queued user results.
5. When user input is required, the agent calls `wait`.
6. The agent receives typed data such as form values, a selection, confirmation, or cancellation.
7. The agent separately invokes its normal host tools under existing authorization rules.
8. Agent calls `close`; the adapter restores the host interface on every exit path.

## Terminal ownership

Only one interface owns terminal input and rendering at a time. The adapter must suspend or coordinate the host TUI before opening gentui and restore it after closure, cancellation, process signals, or exceptions. A host that cannot guarantee this returns `unsupported` and does not partially initialize gentui.

## In-memory requirement

Documents, patches, events, form values, and session state remain in memory. Generating, updating, and displaying a session creates no source, temporary, generated, configuration, cache, telemetry, or replay files. Installing the npm package is not part of UI generation. Future persistence or replay requires a separate, explicit proposal.

## Side effects

Gentui v1 returns interaction results; it does not execute shell commands, write files, call networks, or invoke agent tools. The host agent may use its existing tools after receiving a result. This preserves the host's established permission and audit model.

## Supported host handoff patterns

The package proves the host seam with two independent CLI patterns while exposing the same agent-facing tool:

| Host pattern | Factory | Handoff prerequisite | Explicit capability |
| --- | --- | --- | --- |
| Fullscreen TUI | `createTerminalHost` | The host can suspend and resume its UI | `handoff: "suspend-ui"` |
| Line-oriented prompt | `createPromptTerminalHost` | `prompt.canPause()` reports a safe prompt boundary | `handoff: "pause-prompt"` |

Both factories use the same terminal acquisition, runtime, cancellation, timeout, signal, and restoration contract. The prompt adapter returns `unsupported` before pausing or acquiring the terminal when no safe boundary exists. Terminal capability failures behave identically. Integrators must keep host authorization outside both adapters: an approval result is passed back as data and does not call a host operation.

## Pi host decision record

The supported Pi integration is the auto-discovered `gentui-adapter-pi` package. It registers exactly one `gentui` tool and delegates protocol parsing, validation, sequencing, session lookup, queue delivery, and serialization to `createAgentTool()`.

- **Support and precedence:** `ctx.mode === "tui"`, `ctx.hasUI`, `ctx.ui.custom`, and a non-`dumb` terminal profile are prerequisites. Host support is checked before protocol execution so unsupported modes never create a session, custom component, or input owner. In a supported context, core serialization and input validation happen before session lookup or opening UI; update sequencing is checked only after session lookup.
- **Ordering:** `open` validates through the core boundary, reserves the process-wide surface slot, installs Pi's custom component, opens the runtime, establishes first-control focus, and then returns the session ID. `update` commits before requesting a redraw. `wait` drains each queued result once. Selection and submission do not close. `close` tears down before returning.
- **Single surface:** one surface may be active per extension process. A second valid `open` returns `unsupported` with reason `a gentui surface is already active`; it cannot replace, close, redraw, or receive input intended for the first surface.
- **Cancellation:** Escape and Ctrl+C become a gentui cancel request. Tool abort, custom-UI disappearance, renderer failure, extension reload, session replacement, and Pi shutdown use the same adapter-owned idempotent cleanup. User selection/submission remains queued and non-terminal.
- **Ownership:** the adapter lifecycle record owns both the Pi custom UI and gentui session. Pi continues to own the terminal itself; the adapter neither reads stdin nor writes terminal control sequences.

## Framework and provider neutrality

The protocol assumes neither a particular agent loop nor model provider. Gemini, OpenAI, Claude, OpenRouter, and other models can use the same tool schema through a compatible host. Provider-specific generation, retries, token accounting, and model context stay outside gentui. The serialized boundary rejects class instances and other capability-bearing provider objects in documents and outputs.
