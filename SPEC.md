# gentui — Generative Terminal UI

This repository contains the product and technical specification for `gentui`, an npm package for building terminal applications whose interfaces can be generated and updated from structured model output.

## Status

Experimental / pre-1.0. The implemented release candidate targets CLI agents whose hosts can install a gentui adapter, expose its tool, and safely hand over the terminal. Agents use the bundled skill to learn the tool. Sessions are temporary and non-persistent. The project optimizes for a small, safe, deterministic runtime rather than arbitrary model-generated code.

## Core thesis

Generative UI should not mean “let an LLM print ANSI escape sequences.” It should mean:

1. A developer registers a bounded catalog of terminal components and actions.
2. An agent emits a UI document through a host-provided gentui tool.
3. `gentui` validates and reconciles that document into a native terminal view.
4. User input is returned to the agent as typed interaction results.
5. The host application, not the generated document, owns permissions, tools, side effects, and durable state.

This gives model-driven interfaces the same safety and composability expected from a normal TUI.

## Documents

- [Project README](README.md)
- [Architecture](docs/architecture.md)
- [Vision and goals](spec/01-vision.md)
- [Runtime architecture](spec/02-runtime.md)
- [Document and event schema](spec/03-schema.md)
- [Developer experience](spec/04-developer-experience.md)
- [Distribution and operations](spec/05-distribution.md)
- [Security and trust](spec/06-security.md)
- [Roadmap and acceptance criteria](spec/07-roadmap.md)
- [Agent skill specification](spec/08-agent-skill.md)
- [Host integration protocol](spec/09-host-integration.md)
- [Prior art and research](spec/10-prior-art.md)

## Initial decisions

- TypeScript-first npm package, usable from JavaScript.
- Model output is data, never executable JavaScript.
- Components are registered by the host application.
- Rendering is deterministic and testable without a real terminal.
- Streaming updates are first-class, but every committed document must be valid.
- The agent's host owns model access; gentui does not make model requests in v1.
- The runtime detects unsupported or non-interactive terminals and returns a typed `unsupported` result without taking control of the terminal.

## Product decisions

- Initial renderer: a renderer-independent deterministic text core, connected through host-owned terminal surfaces.
- Primary experience: an agent reads `skills/gentui/SKILL.md` and invokes a gentui capability installed by its host to create a temporary UI for the current task.
- Target: any CLI agent whose host supports tools or extensions and can safely hand terminal control to gentui.
- Provider-neutral: the host agent may use Gemini, OpenAI, Claude, OpenRouter, or another model; gentui does not integrate with those providers directly in v1.
- Styling: fixed themes; agents choose semantic variants, not arbitrary colors.
- Persistence and multi-agent collaboration are deferred.
- Non-interactive terminals are outside the target use case; applications should choose a normal CLI fallback before starting gentui.
- Complete screens, individual components, dashboards, forms, workflows, progress, and rich content are all in scope.

## Host integration decision

The host exposes an in-memory gentui capability to the agent. The capability creates a temporary session, accepts complete documents or validated patch streams, returns user action events and results, and closes the session. The protocol must not use source files, temporary files, generated files, or configuration files.

The package provides the runtime implementation; each agent framework may expose the capability as a native tool, function, or adapter.
