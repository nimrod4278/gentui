# 1. Vision and product boundaries

## Problem

Generative UI systems let a model choose the next interface from a component vocabulary instead of returning only prose. Terminal applications have the same opportunity, but terminals add hard constraints: a narrow viewport, keyboard-first interaction, ANSI capabilities, redraw performance, and a high cost for unsafe side effects.

`gentui` is the missing protocol and runtime between structured generation and a native TUI.

## Target users

- CLI agents, including coding agents, whose hosts support tools or extensions and can hand terminal control to gentui.
- Developers adding a gentui adapter to an agent framework or Node-based CLI.
- Package authors who want to expose reusable terminal components.

The primary user of the package is the agent itself: the bundled skill teaches it when to use gentui and how to compose an effective temporary interface.

## Non-goals for v1

- Persistent application state or screens across agent sessions.
- Multiple agents collaborating on one screen.
- Arbitrary generated code execution.
- A replacement for mature general-purpose TUI frameworks.
- Automatic design of every pixel or raw ANSI generation.
- A hosted model service or mandatory provider account.
- Support for non-interactive terminals; the host should choose another presentation mode.
- Invisible autonomous execution of destructive actions.

## Design principles

1. **Schema over strings** — generate a typed UI tree, not terminal escape codes.
2. **Host owns truth** — application state and side effects remain outside the model.
3. **Progressive disclosure** — a UI can begin as a useful loading state and become richer as generation continues.
4. **Native terminal behavior** — keyboard navigation, resize, focus, copy/paste, and accessibility matter as much as visual output.
5. **Capability-aware** — adapt to supported terminal sizes, color, Unicode, mouse, reduced motion, and interaction capabilities.
6. **Inspectable** — developers can see the generated document, validation errors, interaction traces, and render performance.
7. **Deterministic fallback** — a malformed response or unavailable model must not blank the application.

## Success metrics

- A developer can build a useful generated screen in under 30 minutes.
- Invalid model output never reaches the renderer.
- Snapshot tests produce stable output for a fixed document and terminal profile.
- A streaming update does not lose focus or unexpectedly reset user input.
- A user can understand a proposed side effect and return an explicit approval result to the agent.
- The core package has no provider-specific dependency and performs no model request.
