# ADR 0003: No Host Execution in Quick Scan

Status: Accepted

## Decision

Quick Scan (the v0.1 default) only parses config, resolves the declared runtime binding,
analyzes args/env/package-spec, and analyzes any source or tool metadata explicitly
provided. It never runs `npm install`, never runs `npx`, never starts an MCP server,
never calls a tool, and never reads real secrets.

## Reason

Executing an unknown MCP server on the host would itself violate MCPGuard's own safety
model. A security tool that compromises the host to assess risk is not credible.

## Consequence

Behaviors only observable at runtime (T06 exfiltration, T12 rug pull, T15 unsafe output)
are reported as Inferred risk in v0.1. Probe Scan (initialize + list_tools, no tool calls)
and Deep Scan (sandboxed) are deferred to v0.2+ and require explicit user opt-in.
