# 8. Agent skill specification

`skills/gentui/SKILL.md` is the primary instructional surface for agents. The host's gentui adapter is the capability surface: without it, the skill cannot render a UI. The skill teaches an agent to improve the human experience, not merely to display more UI.

## When the agent should use gentui

Use gentui when the user benefits from navigation, comparison, progressive status, structured input, approval, or multiple related pieces of information. Typical cases:

- repository or task dashboards
- file/diff browsers
- test/build/deployment progress
- multi-step setup and configuration forms
- selectable plans or search results
- approval before a side effect
- interactive logs and diagnostics

Prefer normal text when the result is short, linear, already known, or better copied from the terminal.

## Composition decision

The agent chooses the smallest useful surface:

- one fact or decision: one component
- related facts: panel, table, or list
- parallel work/status: dashboard
- missing user input: form
- consequential operation: summary plus confirmation
- long-running work: progress view with useful partial output

The agent may compose a complete layout from components, but should not create a large dashboard merely because it can.

## Interaction rules

- Give every interactive control a clear label and keyboard path.
- Keep user-entered values stable while generation streams.
- Explain risky actions before asking for confirmation.
- Treat confirmations and form submissions as interaction results, not tool execution.
- Use the host agent's existing tools and authorization flow after receiving a result.
- Never represent an unapproved side effect as completed.
- Return a concise textual summary when the session closes.
- Close the temporary session when the task or interaction ends.

## Generation contract

Invoke the host's gentui tool with the structured document schema. Use its `catalog` operation first when supported, then `open`, `update`, `wait`, and `close` as needed. The entire UI must be generated and rendered in memory; do not create source files, temporary files, generated files, or configuration files in order to display it. Use only catalog-advertised node types and interaction intents. Use semantic variants from the fixed theme, not colors or ANSI sequences. Keep data bounded and omit secrets.

## Fallback

The host decides whether an interactive terminal and gentui adapter are available. If not, the tool returns `unsupported`; the agent then uses ordinary text rather than attempting to start gentui.

## Example intent

For a coding task, a good temporary screen may contain:

1. a header describing the task;
2. a file-change summary;
3. a navigable diff or diagnostics panel;
4. test progress;
5. a confirmation result before the agent separately asks its host to write files.

The agent remains responsible for explaining the outcome after the UI closes.
