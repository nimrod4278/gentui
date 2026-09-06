# 10. Prior art and research

This document identifies ideas to validate against current upstream documentation before implementation. It records transferable patterns, not compatibility claims.

## Generative UI systems

### Vercel AI SDK generative UI

Relevant idea: a model chooses from developer-provided interface modules rather than generating arbitrary client code. Streaming can progressively replace placeholders with richer output.

Transfer to gentui:

- registered catalog instead of generated rendering code
- useful immediate loading state
- typed data passed into trusted renderers
- interaction results returned to the agent loop

Terminal difference: there is no browser client or persistent DOM. The CLI host and gentui must explicitly coordinate ownership of stdin, rendering, focus, and cleanup.

Reference: <https://ai-sdk.dev/docs/ai-sdk-rsc/generative-ui>

### AG-UI

Relevant idea: keep agent activity and frontend state synchronized through a transport-neutral event protocol.

Transfer to gentui:

- versioned events and lifecycle states
- explicit snapshots and transactional deltas
- framework-neutral host adapters
- separation between agent execution and presentation

Gentui should remain smaller: v1 is an in-process temporary terminal session, not a general remote agent transport.

Reference: <https://docs.ag-ui.com/>

### Declarative agent-to-UI protocols such as A2UI

Relevant idea: an agent describes an interface using a bounded declarative catalog, while a trusted client renders native modules and handles interaction.

Transfer to gentui:

- catalog handshake
- schema-constrained node tree
- fixed themes and semantic variants
- data-only interaction intents
- protocol version independent of package version

Before freezing the schema, compare gentui's document, catalog, and update semantics with the current A2UI specification and reuse compatible terminology where it reduces agent confusion.

Reference: <https://a2ui.org/>

## Terminal UI frameworks

### Ink

Strengths to prototype: npm maturity, React composition, Yoga/Flexbox layout, and familiar testing patterns.

Risks to prototype: coexistence with a host that already renders a TUI, stdin ownership, alternate-screen behavior, focus preservation, and cleanup after signals. Ink is the first candidate, not a settled dependency, until the handoff spike passes.

Reference: <https://github.com/vadimdemedes/ink>

### OpenTUI

Evaluate as an alternative if it offers better low-level terminal ownership, input handling, performance, or embedding while retaining a small host interface. Do not add an adapter until a real second renderer is needed.

Reference: <https://github.com/anomalyco/opentui>

### Textual, Bubble Tea, and Ratatui

These ecosystems demonstrate useful TUI interaction patterns even though they use other languages:

- explicit update/message loops
- keyboard-first focus and navigation
- terminal capability awareness
- deterministic state transitions
- robust teardown and alternate-screen handling

References:

- <https://textual.textualize.io/>
- <https://github.com/charmbracelet/bubbletea>
- <https://ratatui.rs/>

## Product conclusions

1. The agent chooses trusted modules; it never generates ANSI or executable rendering code.
2. The host catalog, not the skill, is the runtime source of truth.
3. The existing agent owns model access; gentui owns presentation and interaction state.
4. Interaction results return to the agent; host tools retain side effects and permissions.
5. Terminal handoff is a first-class protocol concern, not a renderer implementation detail.
6. Complete documents establish snapshots; patch batches are transactional optimizations.
7. “Beautiful” requires fixed visual design, responsive layouts, strong keyboard behavior, restrained animation, readable diffs/markdown, and reliable cleanup—not unlimited style generation.

## Research validation checklist

Before schema freeze:

- [ ] Verify current licenses and maintenance status of renderer candidates.
- [ ] Prototype the same coding-agent dashboard in Ink and, if needed, OpenTUI.
- [ ] Compare catalog and update semantics with current AG-UI and A2UI specifications.
- [ ] Test the skill and tool schema with Gemini, OpenAI, Claude, and OpenRouter-hosted models.
- [ ] Record token cost, schema error rate, update stability, and user-interaction success for each model family.
