# Claude Code compatibility

## Current status

Claude Code can discover gentui's Agent Skill, but it does not currently provide the host integration used by gentui to install a custom interactive terminal surface. Therefore:

- `npm install gentui` works for Node.js code developed with Claude Code;
- the gentui skill can be installed and discovered;
- interactive gentui screens are **not currently supported inside Claude Code**;
- when the `gentui` tool is absent, the skill instructs Claude to use ordinary text.

A skill is instructional content, not a terminal capability. A complete integration requires both a serializable `gentui` tool and a host-owned custom UI lifecycle.

## Install the Agent Skill

The Pi adapter package contains the shared skill as a plain Agent Skills `SKILL.md` file. Install and copy it into Claude Code's user skill directory:

```sh
npm install --global gentui-adapter-pi
mkdir -p ~/.claude/skills/gentui
cp "$(npm root --global)/gentui-adapter-pi/skills/gentui/SKILL.md" \
  ~/.claude/skills/gentui/SKILL.md
```

Restart Claude Code after installation. Claude can then discover the skill, but it will follow the documented text fallback because no `gentui` tool is present.

For project-local skill installation:

```sh
npm install --save-dev gentui-adapter-pi
mkdir -p .claude/skills/gentui
cp node_modules/gentui-adapter-pi/skills/gentui/SKILL.md \
  .claude/skills/gentui/SKILL.md
```

Commit `.claude/skills/gentui/SKILL.md` only if your team has reviewed it and wants to share it.

## Use the npm library while coding with Claude Code

For an application or host integration that uses the runtime directly:

```sh
npm install gentui
```

Then import the public API normally:

```ts
import { createRuntime, createTextRenderer } from "gentui";

const renderer = createTextRenderer();
const runtime = createRuntime({ renderer });
```

Claude Code can help develop and test this code, but the resulting UI belongs to your application—not to Claude Code's own terminal session.

## Why the Pi adapter cannot be reused

`gentui-adapter-pi` imports Pi extension and TUI APIs and relies on Pi's `ctx.ui.custom()` lifecycle, keyboard manager, reload/session events, and cleanup hooks. Claude Code plugins and MCP servers do not expose those Pi interfaces. Running the Pi extension as an MCP server would not provide safe terminal ownership and is unsupported.

## What a future adapter needs

A production Claude Code adapter would require an official host surface that can:

1. register a structured tool callable by the model;
2. render and update a custom interactive component;
3. route keyboard input exactly once;
4. coordinate terminal ownership with Claude Code;
5. clean up on cancellation, errors, session changes, reload, and shutdown.

Until those guarantees are available, gentui intentionally falls back to text rather than reading `/dev/tty`, emitting ANSI from an MCP process, or competing with Claude Code for stdin.
