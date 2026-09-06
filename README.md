# gentui

Safe, deterministic, model-generated interfaces for the terminal.

[![npm](https://img.shields.io/npm/v/gentui.svg)](https://www.npmjs.com/package/gentui)
[![CI](https://github.com/nimrod4278/gentui/actions/workflows/ci.yml/badge.svg)](https://github.com/nimrod4278/gentui/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/gentui.svg)](LICENSE)

Gentui lets a CLI agent show a temporary interactive dashboard, form, picker, progress view, diff, or confirmation screen from a versioned JSON document. The host advertises a bounded component catalog; gentui validates model output as untrusted data, renders it, and returns typed interaction results.

Generated UI never receives shell, filesystem, network, model-provider, or credential capabilities.

> **Status:** experimental and pre-1.0. Protocol v1 is implemented and tested, but package APIs may change before 1.0.

## Install

### Use the library in a Node.js host

```sh
npm install gentui
```

Requires Node.js 20 or newer. Gentui is ESM-first and includes TypeScript declarations.

### Use with Pi

The supported Pi package installs both the `gentui` tool and its agent skill:

```sh
# Install for all Pi projects
pi install npm:gentui-adapter-pi

# Or install only for the current trusted project
pi install -l npm:gentui-adapter-pi

# Try it for one run without changing settings
pi -e npm:gentui-adapter-pi
```

Restart Pi after installation, or run `/reload`. Then ask Pi for an interface, for example:

> Show the current changes and test status as an interactive gentui dashboard, then let me choose what to inspect.

Pi and the adapter currently require Node.js 22.19 or newer. Review the package before installation: Pi extensions run with your user permissions. See the [complete Pi guide](docs/pi.md).

### Use with Claude Code

Claude Code can load the bundled Agent Skill, but it does **not currently expose the custom terminal-UI/tool integration that gentui needs**. Installing only the skill does not add interactive rendering; it correctly falls back to normal text when no `gentui` tool is available.

To install the skill for Claude Code:

```sh
npm install --global gentui-adapter-pi
mkdir -p ~/.claude/skills/gentui
cp "$(npm root --global)/gentui-adapter-pi/skills/gentui/SKILL.md" \
  ~/.claude/skills/gentui/SKILL.md
```

Restart Claude Code. This makes the instructions discoverable, but interactive gentui screens remain unsupported until a Claude Code host adapter can safely own a custom UI surface. Do not configure the Pi extension as a Claude Code MCP server—it depends on Pi's lifecycle and TUI APIs. See [Claude Code compatibility](docs/claude-code.md).

## How it works

```text
agent -> host adapter -> validator -> runtime -> renderer -> terminal
                         ^                         |
                         +---- typed results <----+
```

1. The agent calls `catalog` to discover allowed nodes, props, events, and limits.
2. It calls `open` with an immediately useful protocol-v1 document.
3. The runtime validates before rendering and preserves interaction state by stable node ID.
4. Complete replacements or transactional patch batches use monotonic sequence numbers.
5. Keyboard input produces typed `submit`, `select`, `confirm`, or `cancel` results.
6. The host—not gentui—authorizes and performs any side effect.
7. `close`, cancellation, failures, reloads, and shutdown converge on cleanup.

## Library quick start

```ts
import {
  createRuntime,
  createTextRenderer,
  type UiDocument,
} from "gentui";

const renderer = createTextRenderer();
const runtime = createRuntime({
  renderer,
  profile: { columns: 80, rows: 24, color: false },
});

const document: UiDocument = {
  version: "1",
  id: "review",
  title: "Review changes",
  root: {
    id: "root",
    type: "stack",
    props: {},
    children: [
      {
        id: "summary",
        type: "markdown",
        props: { content: "## Ready to review\n\n3 files changed" },
      },
      {
        id: "choice",
        type: "select",
        props: {
          label: "Next action",
          options: [
            { id: "diff", label: "Inspect diff", value: "diff" },
            { id: "tests", label: "Run tests", value: "tests" },
          ],
        },
        events: { activate: { name: "choose-action" } },
      },
    ],
  },
};

const session = await runtime.open({ document });
console.log(renderer.currentFrame?.lines.join("\n"));

// Production renderers forward real keyboard input. The deterministic text
// renderer exposes dispatch() so examples and tests can drive it in memory.
renderer.dispatch({ type: "key", key: "Tab" });
renderer.dispatch({ type: "key", key: "Enter" });
const result = await session.wait({ timeoutMs: 1_000 });
console.log(result);

await session.close();
```

### Validate untrusted documents first

`runtime.open()` validates automatically and throws `DocumentInvalidError` for an invalid initial document. You can validate earlier when you need structured diagnostics:

```ts
import { validateDocument } from "gentui";

const validation = validateDocument(possiblyUntrustedValue);
if (!validation.ok) {
  console.error(validation.diagnostics);
} else {
  // validation.document is sanitized and safe to pass to the runtime.
}
```

### Update an open session

```ts
const update = await session.update({
  sessionId: session.id,
  sequence: 1,
  patch: [
    {
      type: "replace",
      path: ["root", "children", 0, "props", "content"],
      value: "## Tests passing",
    },
  ],
});

if (update.status !== "committed") {
  console.error(update);
}
```

Each update contains exactly one of `document` or `patch`. A patch batch is copied, applied, validated as a whole, and committed atomically.

## Standard components

The built-in catalog includes:

- layout: `stack`, `row`, `panel`, `tabs`, `form`
- content: `text`, `markdown`, `file-list`, `diff`, `diagnostics`
- status: `progress`, `spinner`, `error`, `empty`
- input and actions: `input`, `select`, `checkbox`, `button`, `confirm`

Call `runtime.catalog()` or the agent tool's `catalog` operation instead of hard-coding catalog assumptions.

## Packages

| Package | Install | Purpose |
| --- | --- | --- |
| [`gentui`](packages/gentui) | `npm install gentui` | Protocol, validation, runtime, catalog, renderers, and host seams |
| [`gentui-adapter-pi`](packages/adapter-pi) | `pi install npm:gentui-adapter-pi` | Pi extension and Agent Skill |
| [`gentui-testing`](packages/testing) | `npm install -D gentui-testing` | Deterministic renderers, clocks, profiles, and PTY helpers |

## Safety properties

- **Data, not code:** documents are JSON-compatible values without executable capabilities.
- **Validate before render:** invalid documents and patch batches never partially commit.
- **Bounded resources:** document size, depth, nodes, text, patches, and queued results are limited.
- **Terminal safety:** text is sanitized against control-sequence injection.
- **Host-owned authority:** a confirmation is data, not permission to bypass host authorization.
- **No persistence:** rendering a session creates no source, temporary, cache, telemetry, or replay files.
- **Provider neutral:** the host owns model access and credentials.
- **Deterministic testing:** rendering and interaction can run fully in memory.

## Documentation

- [Installation and Pi integration](docs/pi.md)
- [Claude Code compatibility](docs/claude-code.md)
- [Architecture](docs/architecture.md)
- [Document and event protocol](spec/03-schema.md)
- [Host integration protocol](spec/09-host-integration.md)
- [Security model](spec/06-security.md)
- [Testing guide](TESTING.md)
- [Evaluation and release gates](EVALUATION.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Development

```sh
git clone https://github.com/nimrod4278/gentui.git
cd gentui
npm ci
npm run typecheck
npm test
```

## License

[MIT](LICENSE) © 2026 gentui contributors.
