# `gentui-adapter-pi`

The supported [Pi](https://github.com/earendil-works/pi-mono) adapter for gentui. This Pi package installs an auto-discovered `gentui` tool and the matching Agent Skill. It owns rendering, runtime state, keyboard routing, result delivery, and custom-UI cleanup.

> Experimental, pre-1.0 software. Review the package before installing it: Pi extensions execute with your user permissions.

## Requirements

- Pi 0.85 or newer
- Node.js 22.19 or newer
- Interactive TUI mode and a usable terminal

## Install

```sh
# All projects
pi install npm:gentui-adapter-pi

# Current trusted project (.pi/settings.json)
pi install -l npm:gentui-adapter-pi

# One temporary run
pi -e npm:gentui-adapter-pi
```

Restart Pi or run `/reload`, then try:

```text
Show the repository changes and test status in an interactive gentui dashboard.
```

Pi discovers the extension and skill from the package's `pi.extensions` and `pi.skills` manifest entries. Project-local packages load only after the project is trusted.

## Agent tool

The package registers one serializable tool named `gentui` with these operations:

- `catalog` — discover supported nodes, props, events, keyboard behavior, and limits;
- `open` — validate and show a complete initial document;
- `update` — apply a complete replacement or transactional patch batch;
- `wait` — consume queued interaction results;
- `close` — release the surface and return to Pi.

The bundled skill teaches the agent when to use each operation and when to fall back to text.

## Support policy

Interactive documents are supported only in Pi's TUI mode with a usable custom UI and terminal profile. Print, JSON, RPC, missing-UI, and `TERM=dumb` contexts return a typed `unsupported` result without opening a runtime session or consuming input.

One gentui surface may be active in a Pi process. A second `open` is rejected without disturbing the first. Selection or submission queues a typed result for `wait` or `update`; it does not dismiss the surface. Use `close` to return to Pi's editor.

## Keys

| Action | Keys |
| --- | --- |
| Move focus | `Tab`, `Shift+Tab` |
| Move selection / cursor | Arrow keys |
| Activate / submit | `Enter` |
| Confirm a high-risk action | `Ctrl+Enter` |
| Edit | `Backspace`, `Delete`, `Home`, `End`, text or paste |
| Cancel and restore Pi | `Escape`, `Ctrl+C` |

The adapter uses Pi's injected keybinding manager and `@earendil-works/pi-tui` key decoding for terminal and Kitty compatibility. Paste content passes through gentui sanitization.

## Lifecycle

Explicit close, cancellation, an aborted tool call, renderer failure, `/reload`, session replacement, and Pi shutdown converge on the same idempotent cleanup path. No document, interaction state, result, cache, telemetry, or replay file is written.

See the [full installation and troubleshooting guide](https://github.com/nimrod4278/gentui/blob/main/docs/pi.md).

## License

MIT
