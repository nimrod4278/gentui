# 5. Distribution and operations

## Package layout

Packages are split only where a real seam exists:

- `gentui` — protocol, schemas, runtime, standard catalog, validation, reconciliation, text rendering, and terminal-host interfaces
- `gentui-adapter-pi` — the supported Pi host adapter
- `gentui-testing` — deterministic clocks, renderers, profiles, and terminal test fixtures
- `skills/gentui` — the framework-neutral agent skill, distributed with compatible host integrations

Future host-specific integrations should follow the `gentui-adapter-<host>` convention. Do not create Gemini, OpenAI, Claude, or OpenRouter packages in v1: the existing host agent owns model access.

The core package must not force-install model SDKs or native dependencies.

## Installation and discovery

Installing npm packages naturally writes package contents to `node_modules`; the no-files rule applies to generating, updating, and displaying a UI at runtime. A skill provides instructions only. Installing it does not add terminal capability—the host must also install or implement a gentui adapter.

## Compatibility

- ESM-first with a documented CommonJS path only if actual users require it.
- TypeScript declarations included.
- Supported Node.js LTS versions documented and tested.
- No network or model access in the core runtime.
- Semantic versioning, changelog, and migration notes.
- Protocol and catalog versions independent from package versions.

## Release quality bar

CI runs type checks, unit tests, schema compatibility tests, snapshot tests, linting, package-export checks, and pseudo-terminal smoke tests. It verifies terminal handoff, restoration after signals/errors, narrow widths, no color, ASCII-only output, and rejection of non-interactive environments.

## Terminal handoff requirements

Every host adapter must verify:

- suspension and restoration of the host interface
- single ownership of input and focus
- resize handling
- Ctrl+C and cancellation semantics
- cleanup after crashes and process signals
- structured results returned to the host

The Pi adapter renders through Pi's custom UI and never takes over stdin directly. The generic terminal-host interfaces make handoff capabilities explicit for other integrations.

## Runtime limits

Expose session timeout, maximum patch batches, maximum document bytes, maximum tree depth and nodes, update debounce interval, and cancellation. The host should provide an immediate local initial document so the UI never opens to a blank screen.

## Runtime modes

V1 supports one mode:

1. **Embedded temporary session:** runtime and renderer execute under the CLI host, entirely in memory.

Remote generation, persistence, multi-agent sessions, and disk-backed replay are deferred. Tests may use checked-in fixtures, but generating or displaying a user session never creates files. Any future telemetry or replay is explicit opt-in and outside the v1 protocol.
