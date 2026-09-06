# 7. Roadmap and acceptance criteria

## Defining v1 experience

A coding agent opens a temporary repository dashboard showing changed files, a navigable diff, diagnostics, and test progress. The user can navigate with the keyboard and return an approval or cancellation result. The dashboard closes cleanly, and the agent uses its existing host tools for any subsequent file operation.

## Phase 0 — terminal handoff and protocol spike (implemented)

- Prototype terminal handoff between one real CLI agent host and Ink.
- Define the serializable agent-tool protocol and in-process runtime interface.
- Define a small versioned document schema and catalog handshake.
- Implement validation and an in-memory fake renderer.
- Verify cleanup after resize, Ctrl+C, exceptions, and process signals.

**Exit:** the host can open and close a temporary screen repeatedly without terminal corruption; malformed documents are rejected; no UI-generation file is created.

## Phase 1 — defining demo (implemented)

- Implement stack, row, panel, tabs, text, markdown, file list, diff, diagnostics, progress, spinner, confirm, and cancel.
- Add keyboard navigation, focus preservation, fixed themes, and terminal capability checks.
- Implement complete-document updates and transactional patch batches.
- Return typed interaction results without executing agent tools.
- Add deterministic snapshots and pseudo-terminal integration tests.

**Exit:** the defining coding-agent dashboard is polished and usable in the first supported host.

### Defining-experience test evidence

- The complete changed-files → diff/diagnostics/tests → approval journey, cancellation, streamed complete/patch updates, state preservation, invalid-patch recovery, narrow/ASCII/no-color/reduced-motion rendering, cleanup, filesystem manifest, and denied-host-authorization cases are covered by [`test/acceptance/dashboard.spec.ts`](../test/acceptance/dashboard.spec.ts).
- Terminal handoff, live resize, host cancellation, renderer failure, signal restoration, and repeated cleanup are covered by [`test/pty/terminal-ownership.spec.ts`](../test/pty/terminal-ownership.spec.ts).
- Real pseudo-terminal stdin, resize, signals, crash observation, and terminal-mode restoration are covered by [`test/pty/real-pty.spec.ts`](../test/pty/real-pty.spec.ts).
- Schema validation, escape sanitization, event authorization, transactional updates, and serialized agent-tool behavior are covered by [`test/validation/`](../test/validation), [`test/runtime/`](../test/runtime), and [`test/agent/tool-adapter.spec.ts`](../test/agent/tool-adapter.spec.ts).

## Phase 2 — portable agent integration (implemented at the interface level)

- Publish the framework-neutral agent skill and machine-readable catalog.
- Build a second host adapter to validate the adapter seam.
- Document unsupported-host behavior and integration requirements.
- Add forms, selections, richer progress, ASCII mode, and reduced motion.

**Exit:** two different CLI agent hosts use the same document protocol and skill without renderer-specific agent instructions.

### Portability test evidence

- `createTerminalHost` and `createPromptTerminalHost` expose the same runtime/tool contract with explicit `suspend-ui` and `pause-prompt` handoff capabilities.
- [`test/agent/host-portability.spec.ts`](../test/agent/host-portability.spec.ts) runs the shared serialized transcript and the unsupported, authorization, cancellation, timeout, signal, restoration, and provider-object contract against both hosts.
- Shared terminal ownership behavior remains covered by [`test/pty/terminal-ownership.spec.ts`](../test/pty/terminal-ownership.spec.ts) and [`test/pty/real-pty.spec.ts`](../test/pty/real-pty.spec.ts).

## Phase 3 — ecosystem

- Stabilize trusted custom renderer-module authoring.
- Add another renderer only if a real host requires it.
- Add catalog compatibility tooling.
- Evaluate persistence, remote transport, replay, and direct host operations as separate proposals.

**Exit:** third parties can publish compatible renderer modules and applications can pin catalog versions safely.

## Release checklist

- [ ] Protocol, catalog, and compatibility versioning documented.
- [ ] Security review of validator, renderer, event router, and terminal handoff.
- [ ] Terminal escape-injection tests.
- [ ] Resize, signal, crash-restoration, no-color, ASCII, and narrow-width tests.
- [ ] Non-interactive environments return `unsupported` without taking terminal control.
- [ ] No files are created while generating, updating, or displaying a session.
- [ ] Agent-tool and runtime-interface examples agree.
- [ ] Agent skill tested against multiple supported model providers through a host.
- [ ] Package exports and npm provenance verified.
- [ ] License, support policy, and deprecation policy published.

## Open questions before a stable release

1. Gather compatibility feedback from additional real host integrations.
2. Decide whether trusted third-party renderer modules belong in the stable API.
3. Finalize npm release automation, provenance, and migration-note policy.
4. Run the opt-in skill evaluation against a representative set of host-managed models.
