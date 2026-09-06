# gentui

Safe, deterministic runtime and protocol for model-generated terminal interfaces.

[![npm](https://img.shields.io/npm/v/gentui.svg)](https://www.npmjs.com/package/gentui)
[![license](https://img.shields.io/npm/l/gentui.svg)](LICENSE)

> Experimental, pre-1.0 software. APIs may change before the first stable release.

## Install

```sh
npm install gentui
```

Requires Node.js 20 or newer. The package is ESM-first and includes TypeScript declarations.

To install gentui directly into the Pi coding agent instead, use:

```sh
pi install npm:gentui-adapter-pi
```

## Quick start

```ts
import {
  createRuntime,
  createTextRenderer,
  type UiDocument,
} from "gentui";

const renderer = createTextRenderer();
const runtime = createRuntime({ renderer });

const document: UiDocument = {
  version: "1",
  id: "example",
  root: {
    id: "root",
    type: "stack",
    props: {},
    children: [
      { id: "message", type: "text", props: { content: "Choose an option" } },
      {
        id: "choice",
        type: "select",
        props: {
          label: "Action",
          options: [
            { id: "one", label: "Option one", value: 1 },
            { id: "two", label: "Option two", value: 2 },
          ],
        },
        events: { activate: { name: "choose" } },
      },
    ],
  },
};

const session = await runtime.open({ document });
console.log(renderer.currentFrame?.lines.join("\n"));

renderer.dispatch({ type: "key", key: "Tab" });
renderer.dispatch({ type: "key", key: "Enter" });
console.log(await session.wait({ timeoutMs: 1_000 }));
await session.close();
```

Production integrations should connect the runtime to a host-owned renderer or use `createAgentTool()` plus a `TerminalHost`. The host must coordinate terminal ownership, permissions, side effects, and cleanup.

## API overview

- `validateDocument()` validates and sanitizes an untrusted document.
- `createRuntime()` creates the in-process catalog/session interface.
- `createAgentTool()` exposes serializable `catalog`, `open`, `update`, `wait`, and `close` operations.
- `createTextRenderer()` provides deterministic, cell-aware rendering.
- `createTerminalHost()` and `createPromptTerminalHost()` define host handoff seams.
- `applyPatch()` applies and validates transactional patch batches.
- `standardCatalog` and `standardNodeRegistry` describe built-in components.

The standard catalog includes layouts, text and markdown, file lists, diffs, diagnostics, progress, forms, inputs, selections, buttons, and confirmations.

## Security model

Generated documents are untrusted JSON data. They cannot execute tools or access the filesystem, network, shell, credentials, or model provider. Gentui returns typed intent data; the host separately authorizes and performs any side effect.

See the full [README](https://github.com/nimrod4278/gentui#readme), [protocol](https://github.com/nimrod4278/gentui/blob/main/spec/03-schema.md), [architecture](https://github.com/nimrod4278/gentui/blob/main/docs/architecture.md), and [security model](https://github.com/nimrod4278/gentui/blob/main/spec/06-security.md).

## License

MIT
