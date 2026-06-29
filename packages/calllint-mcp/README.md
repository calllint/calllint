# calllint-mcp

> The MCP server for [CallLint](https://calllint.com) — a **static preflight
> safety gate** for MCP servers and agent tools.

**Use CallLint before installing or approving other MCP servers.** It produces
evidence-backed verdicts — `SAFE` / `REVIEW` / `BLOCK` / `UNKNOWN` — for MCP
configs and install snippets, entirely statically. It **never executes the
server it judges**.

`calllint-mcp` is a thin wrapper: every tool delegates to the same engine behind
the [`calllint` CLI](https://www.npmjs.com/package/calllint). No analysis logic
of its own, no network on the scan path, no server execution.

## Install

No install needed — run via `npx`:

```jsonc
// e.g. Claude Desktop / Cursor MCP config
{
  "mcpServers": {
    "calllint": {
      "command": "npx",
      "args": ["-y", "calllint-mcp"]
    }
  }
}
```

## Tools

| Tool | What it does |
| --- | --- |
| `scan_mcp_config_path` | Scan an MCP config file on disk → full ScanReport (verdict + evidence). |
| `scan_mcp_config_json` | Scan MCP config JSON → compact decisions (verdict, fingerprint, reason codes). |
| `verify_baseline` | Compare a config against a recorded baseline → drift / rug-pull signal. |
| `explain_finding` | Full evidence-backed explanation of why a verdict was reached. |
| `generate_agent_rule` | Emit the CallLint agent-safety rule for a host (claude, cursor, copilot, …). |
| `generate_ci_gate_snippet` | Emit a GitHub Actions workflow that gates a repo on its agent-tool surface. |

## Guarantees

- **Never executes** a scanned MCP server (static analysis only).
- **No network** on the scan path; deterministic given inputs.
- `SAFE` means "no blockers observed", not proof of runtime safety.
- `UNKNOWN` is never treated as safe.

## Transport

JSON-RPC 2.0 over stdio (MCP). Zero runtime dependencies — the server is bundled
into a single file, consistent with the `calllint` CLI.

## License

Apache-2.0
