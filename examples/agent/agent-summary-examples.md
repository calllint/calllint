# Agent summary examples

How a coding agent can summarize a CallLint result for a user: what to quote
from the report, and wording that stays inside what CallLint proves. Each
example is generated from the input config in this directory by
`calllint scan <input> --json` — the verdicts and finding ids are real, not
illustrative.

## BLOCK — `examples/agent/risky-mcp.json`

CallLint returned **BLOCK** for `files.broad-path` (Broad local filesystem
access).

Evidence:
`$.mcpServers.filesystem.args[2] = "/Users/example"`

Why it matters:
This grants broad local filesystem access before the agent runs the server.

Recommended response:
I recommend not enabling this MCP server for autonomous use until the
filesystem root is restricted to the project directory (for example
`${workspaceFolder}`) or explicitly reviewed.

## REVIEW — `examples/agent/review-mcp.json`

CallLint returned **REVIEW** for `supply.unpinned-package` (Package version is
not pinned).

Evidence:
`some-mcp-server@latest`

Recommended response:
This pulls an unpinned package, so the code that runs can change without
notice. I recommend pinning it to an exact version (for example
`some-mcp-server@1.0.0`) before enabling autonomous use.

## UNKNOWN — `examples/agent/unknown-mcp.json`

CallLint returned **UNKNOWN** for `supply.unknown-remote` (Remote server source
cannot be verified).

Evidence:
`https://mcp.unknown-vendor-example.dev/sse`

Recommended response:
UNKNOWN is not SAFE. CallLint could not verify this remote source statically.
I recommend manual review — or running the server from a pinned, inspectable
package — before enabling autonomous use.

## Regenerating these reports

```bash
calllint scan examples/agent/risky-mcp.json   --json --generated-at 2026-01-01T00:00:00.000Z > examples/agent/calllint-block-report.json
calllint scan examples/agent/review-mcp.json  --json --generated-at 2026-01-01T00:00:00.000Z > examples/agent/calllint-review-report.json
calllint scan examples/agent/unknown-mcp.json --json --generated-at 2026-01-01T00:00:00.000Z > examples/agent/calllint-unknown-report.json
```

The `--generated-at` flag pins the timestamp so the JSON is byte-stable.
