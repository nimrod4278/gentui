# Install gentui in Pi

`gentui-adapter-pi` is a Pi package containing:

- one auto-discovered `gentui` extension/tool;
- the framework-neutral gentui Agent Skill;
- the runtime dependency needed by the extension.

## Requirements

- Pi 0.85 or newer
- Node.js 22.19 or newer
- Interactive TUI mode and a usable terminal (`TERM` must not be `dumb`)

Pi extensions execute with your user permissions. Review the package and source before installing it.

## Install globally

Make gentui available in every Pi project:

```sh
pi install npm:gentui-adapter-pi
```

Pi records the package in `~/.pi/agent/settings.json` and installs it under Pi's managed npm directory.

## Install for one project

From the project root:

```sh
pi install -l npm:gentui-adapter-pi
```

This records the package in `.pi/settings.json`. Pi loads project packages only after you trust that project.

## Try without installing

```sh
pi -e npm:gentui-adapter-pi
```

The package is installed into a temporary directory for that run only.

## Verify

Restart Pi after installation, or run:

```text
/reload
```

You can confirm the package is recorded with:

```sh
pi list
```

Then prompt the agent with a task suited to structured interaction:

```text
Show my changed files, diagnostics, and test status in an interactive gentui dashboard. Let me select a file to inspect.
```

The bundled skill instructs the agent to call `gentui` with `operation: "catalog"` first, then use `open`, `update`, `wait`, and `close`.

## Update or remove

```sh
# Update installed Pi packages
pi update --extensions

# Remove gentui
pi remove npm:gentui-adapter-pi
```

For a project-local installation, use Pi's project-local configuration mode when removing or edit the corresponding `.pi/settings.json` package entry.

## Supported modes

| Pi mode | Behavior |
| --- | --- |
| Interactive TUI | Full gentui support |
| Print | Returns `unsupported`; agent falls back to text |
| JSON | Returns `unsupported`; agent falls back to text |
| RPC | Returns `unsupported`; agent falls back to text |
| Missing custom UI or `TERM=dumb` | Returns `unsupported`; agent falls back to text |

The adapter renders through Pi's injected custom UI. It does not read stdin or write terminal control sequences directly.

## Keyboard controls

| Action | Keys |
| --- | --- |
| Move focus | `Tab`, `Shift+Tab` |
| Move selection or cursor | Arrow keys |
| Activate or submit | `Enter` |
| Confirm a high-risk action | `Ctrl+Enter` |
| Edit text | Text/paste, `Backspace`, `Delete`, `Home`, `End` |
| Cancel and restore Pi | `Escape`, `Ctrl+C` |

## Lifecycle and cleanup

Only one gentui surface can be active in a Pi process. Explicit close, cancellation, an aborted tool call, renderer failure, `/reload`, session replacement, and Pi shutdown all use the same idempotent cleanup path. Selection or submission queues a typed result; the surface remains open until the agent closes it.

## Troubleshooting

### The agent never calls gentui

- Run `/reload` after installation.
- Check `pi list` for `npm:gentui-adapter-pi`.
- Make sure the `gentui` tool and skill are enabled in `pi config`.
- Ask explicitly for an interactive gentui dashboard or run `/skill:gentui`.

### The tool returns `unsupported`

Run Pi interactively in a real terminal. Print, JSON, RPC, CI, redirected output, and `TERM=dumb` intentionally fall back to text.

### Project package does not load

Project-local packages load only after project trust is granted. Restart Pi from the project root and review the trust prompt.

### A surface is already active

Close or cancel the existing surface before opening another. A second `open` cannot replace or steal input from the active surface.
