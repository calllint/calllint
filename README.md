# MCPGuard

Evidence-backed security verdicts for the MCP servers (agent tools) your AI coding
agent is about to trust.

MCPGuard reads an MCP configuration, works out what each server will **actually run**,
and returns a verdict — `SAFE`, `REVIEW`, `BLOCK`, or `UNKNOWN` — backed by concrete
evidence, a risk class, and a recommended runtime policy. It never executes the server
it is judging.

## Why

AI agents invoke MCP tools autonomously. A poisoned tool description, a broad filesystem
grant, or an unpinned package becomes an agent-native attack surface that classic scanners
miss because they look at code, not at what the **model** sees and what the agent will
**do**. MCPGuard analyzes that surface statically and deterministically.

## What it detects

| Symbol | Finding | Verdict impact |
| --- | --- | --- |
| `PROMPT` | Hidden model-directed instructions in tool metadata (tool poisoning) | BLOCK |
| `EXEC` | Arbitrary command execution (shell / inline-eval) | BLOCK |
| `FILES` | Broad local filesystem access | BLOCK |
| `SECRETS` | Server configured with credentials | REVIEW |
| `SUPPLY` | Unpinned package version (supply-chain drift) | REVIEW |
| `NETWORK` | Unverifiable remote source | UNKNOWN |
| `ACTION` | May perform external side effects | REVIEW |

`UNKNOWN` is a first-class verdict: when MCPGuard cannot verify what a server will do, it
says so and never silently upgrades to `SAFE`.

## Install / build

Requires Node ≥ 20 and pnpm.

```bash
pnpm install
pnpm build        # bundles the CLI to apps/cli/dist/index.js
pnpm test         # 113 unit + E2E tests
```

## Usage

```bash
# Scan a config (auto-detects .cursor/mcp.json, .mcp.json, etc.)
node apps/cli/dist/index.js scan .cursor/mcp.json

# One line per server
node apps/cli/dist/index.js scan ./mcp.json --compact

# Plain-text symbols for CI logs
node apps/cli/dist/index.js scan ./mcp.json --no-emoji

# Stable, emoji-free JSON (the machine contract)
cat .cursor/mcp.json | node apps/cli/dist/index.js scan --stdin --json

# Deep dive on one server from the last scan
node apps/cli/dist/index.js explain filesystem

# CI gate: non-zero exit on a failing verdict
node apps/cli/dist/index.js scan ./mcp.json --ci
```

### Exit codes (with `--ci`)

| Code | Meaning |
| --- | --- |
| 0 | SAFE (or verdict not in policy `failOn`) |
| 10 | REVIEW (only when `failOnReview` is enabled) |
| 20 | UNKNOWN |
| 30 | BLOCK |
| 2 | usage error |
| 3 | parse / runtime error |

## Policy as code

```bash
node apps/cli/dist/index.js policy init      # writes mcpguard.policy.json
node apps/cli/dist/index.js policy explain    # shows the effective policy
```

Overrides must carry a `reason` and an `expiresAt`, and may never silently allow `EXEC`
or `MONEY` without `dangerousOverride: true`. An active override can downgrade a `BLOCK`
to `REVIEW` (never to `SAFE`), and the decision is labeled in the report.

## Self-guard (opt-in dogfooding)

MCPGuard can scan its own repo's MCP config. This is **not** installed automatically.

```bash
# Advisory (always exits 0)
node scripts/selfguard.mjs

# CI mode (non-zero on BLOCK/UNKNOWN)
node scripts/selfguard.mjs --ci
```

To wire it into Claude Code yourself, add a `PreToolUse` hook to your own
`.claude/settings.json` that runs `node scripts/selfguard.mjs`. MCPGuard does not write
this for you, by design — installing an auto-executing hook is your decision.

## Architecture

A deterministic pipeline of small workspace packages:

```
config-parser → resolver → static-analyzer → risk-engine → fingerprint
                                                   ↓
                              policy → core → report-renderer → cli
```

- **config-parser** — normalize Cursor/Claude/VS Code MCP configs (never executes them)
- **resolver** — runtime binding: the real subject of `npx pkg` is the package
- **static-analyzer** — seven detectors over config + tool metadata
- **risk-engine** — pure verdict / risk-class / reproducibility logic (no LLM)
- **policy** — policy-as-code with validated, expiring overrides
- **fingerprint** — stable hashes for drift detection (TOCTOU)
- **core** — wires the pipeline into a `ScanReport`
- **report-renderer** — terminal / compact / no-emoji / explain / JSON
- **cli** — `scan` / `explain` / `policy`, stable exit codes

The JSON report is the stable, emoji-free contract; human renderers are derived from it.

## Non-goals (v0.1)

No gateway, no payments, no marketplace, no SaaS dashboard, no host execution of unknown
servers, no real secret access, no destructive tool calls.
