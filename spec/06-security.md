# 6. Security and trust model

Generated UI is untrusted input. Treat it like data received from a remote user.

## Mandatory controls

- Strict schema validation before rendering or action dispatch.
- Component allowlist per application.
- Strict validation of all interaction intents and submitted values.
- Host-owned confirmation and authorization for destructive, external, or irreversible effects.
- No execution of agent tools by the v1 gentui runtime.
- Maximum tree depth, node count, text size, patch count, and render time.
- Secret redaction in model context, action results, telemetry, and errors.
- No generated shell, JavaScript, filesystem, or network capability. Displaying an inert path or command string does not grant that capability.
- Cancellation and timeout for every model request and action.

## Prompt injection

Treat text displayed in files, logs, web pages, and tool results as untrusted content. The runtime must not infer authority from model-produced text. Permissions are established by host code only. User interaction can express approval, but cannot bypass the host's authorization policy.

## Terminal safety

The renderer owns ANSI output. Component props cannot emit arbitrary control sequences. Sanitize text against terminal escape injection, including OSC hyperlinks and clipboard sequences unless explicitly supported and escaped. Restore terminal modes on all exit paths.

## Confirmation UX

A confirmation should identify the proposed operation, target, important arguments, and risk. The agent may request the confirmation UI, but only the human produces its result and only the host authorizes execution. High-risk operations should use a distinct key gesture. Gentui returns the result; the agent then invokes its normal host tool.

## Auditability

Expose opt-in structured events for session IDs, validation decisions, interaction-result types, timestamps, and outcomes. Default logging is in memory, omits sensitive values, and does not create files. Authorization and tool-execution audit records remain the host's responsibility.
