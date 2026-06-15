# MCPGuard

**Before your agent runs a tool, know what it can read, write, execute, and send.**

MCPGuard is a CLI-first scanner that gives evidence-backed verdicts for the MCP
servers (agent tools) your AI coding agent is about to trust. It reads an MCP
configuration, works out what each server will **actually run**, and returns a
verdict — `SAFE`, `REVIEW`, `BLOCK`, or `UNKNOWN` — backed by concrete evidence,
a risk class, and a recommended runtime policy. **It never executes the server
it is judging.**

## What MCPGuard is

- A deterministic, offline **pre-flight check** for MCP configs and agent tools.
- A **CI gate**: fail a build when a config introduces a blocking risk or drifts
  from an approved baseline (rug-pull / TOCTOU).
- An **agent-native** scanner: it inspects the tool metadata that reaches the
  model (names, descriptions, schemas, instructions), not just code.

## What MCPGuard is not

- It does **not** execute, install, or sandbox-run servers. No host execution of
  unknown code, ever.
- It does **not** prove a server is safe. `No blockers observed` ≠ guaranteed
  safe. See [LIMITATIONS.md](LIMITATIONS.md).
- It is **not** a gateway, marketplace, or SaaS — see Non-goals below.

## Quick start

Requires Node ≥ 20 and pnpm.

```bash
pnpm install
pnpm build        # bundles the CLI to apps/cli/dist/index.js
pnpm test         # unit + E2E tests (network is mocked; tests never go online)

# Scan a config (auto-detects .cursor/mcp.json, .mcp.json, etc.)
node apps/cli/dist/index.js scan .cursor/mcp.json
```

## What it detects

| Symbol | Finding | Verdict impact |
| --- | --- | --- |
| `PROMPT` | Hidden model-directed instructions in tool metadata (tool poisoning) | BLOCK |
| `EXEC` | Arbitrary command execution (shell / inline-eval / install scripts) | BLOCK |
| `FILES` | Broad local filesystem access | BLOCK |
| `MONEY` | Observed money-moving tool (create_payment, transfer, refund) + capability | BLOCK |
| `MONEY` | Name-inferred financial domain (e.g. a "payments" package) | REVIEW |
| `SECRETS` | Server configured with credentials | REVIEW |
| `SUPPLY` | Unpinned package version (supply-chain drift) | REVIEW |
| `ACTION` | May perform external side effects | REVIEW |
| `NETWORK` | Unverifiable remote source | UNKNOWN |

`UNKNOWN` is a first-class verdict: when MCPGuard cannot verify what a server
will do, it says so and never silently upgrades to `SAFE`.

## Scan an editor config

```bash
# Cursor
node apps/cli/dist/index.js scan .cursor/mcp.json

# Claude / VS Code settings (the mcpServers block is auto-detected)
node apps/cli/dist/index.js scan .claude/settings.json

# One line per server
node apps/cli/dist/index.js scan ./mcp.json --compact

# Plain-text symbols for CI logs (no emoji)
node apps/cli/dist/index.js scan ./mcp.json --no-emoji

# Stable, emoji-free JSON (the machine contract)
cat .cursor/mcp.json | node apps/cli/dist/index.js scan --stdin --json

# Deep dive on one server from the last scan
node apps/cli/dist/index.js explain filesystem
```

## CI gate

```bash
# Non-zero exit on a failing verdict
node apps/cli/dist/index.js scan ./mcp.json --ci
```

### Exit codes (with `--ci`)

| Code | Meaning |
| --- | --- |
| 0 | SAFE (or verdict not in policy `failOn`) |
| 10 | REVIEW (only when `failOnReview` is enabled) |
| 20 | UNKNOWN |
| 30 | BLOCK |
| 40 | DRIFT (`verify --ci`, risk surface changed vs baseline) |
| 2 | usage error |
| 3 | parse / runtime error |

### GitHub Actions + SARIF

MCPGuard emits SARIF 2.1.0 for GitHub Code Scanning. A ready-to-use workflow and
walkthrough live in [examples/github-actions/](examples/github-actions/) and
[docs/integrations/github-actions.md](docs/integrations/github-actions.md).

```bash
# SARIF 2.1.0 for GitHub Code Scanning
node apps/cli/dist/index.js scan ./mcp.json --sarif > mcpguard.sarif
```

### HTML report

```bash
# Self-contained HTML report (inline CSS, zero JS, zero external links)
node apps/cli/dist/index.js scan ./mcp.json --html > report.html
```

## Drift detection (rug-pull / TOCTOU)

Record an approved risk surface, then fail CI if it changes — a pinned-version
bump, new tool metadata, or a changed package is flagged as a **rug-pull**
signal.

```bash
# Record the approved baseline (.mcpguard/baseline.json)
node apps/cli/dist/index.js baseline ./mcp.json

# Later: compare a fresh scan against the baseline (exit 40 in CI if drifted)
node apps/cli/dist/index.js verify ./mcp.json --ci
```

## Policy as code

```bash
node apps/cli/dist/index.js policy init       # writes mcpguard.policy.json
node apps/cli/dist/index.js policy explain     # shows the effective policy
```

Overrides must carry a `reason` and an `expiresAt`, and may never silently allow
`EXEC` or `MONEY` without `dangerousOverride: true`. An active override can
downgrade a `BLOCK` to `REVIEW` (never to `SAFE`), and the decision is labeled in
the report.

## Online enrichment (opt-in)

```bash
# Scan an npm package directly (offline: synthesizes an equivalent config)
node apps/cli/dist/index.js scan npm:mcp-weather@1.0.0

# Enrich with public registry metadata (install scripts, deprecation, missing versions)
node apps/cli/dist/index.js scan npm:some-pkg@1.0.0 --online

# Scan a GitHub repo's MCP config (requires --online to fetch)
node apps/cli/dist/index.js scan github:owner/repo --online
```

`--online` reads public registry/repo metadata only — it never executes fetched
code. Online findings are **advisory**: every one is stamped `source: "online"`
with a `fetchedAt` timestamp, and enrichment may **only add risk, never lower a
verdict** (enforced in code; see [ADR 0006](docs/adr/0006-online-enrichment-advisory.md)).

## Security model

A deterministic pipeline of small workspace packages:

```
config-parser → resolver → static-analyzer → risk-engine → fingerprint
                                                   ↓
                              policy → core → report-renderer → cli
                                        ↑                        ↑
                          online (--online, opt-in) ────────────┘
```

- **config-parser** — normalize Cursor/Claude/VS Code MCP configs (never executes them)
- **resolver** — runtime binding: the real subject of `npx pkg` is the package
- **static-analyzer** — detectors over config + model-visible tool metadata
- **risk-engine** — pure verdict / risk-class / reproducibility logic (no LLM)
- **policy** — policy-as-code with validated, expiring overrides
- **fingerprint** — stable hashes for drift detection (TOCTOU)
- **core** — wires the pipeline into a `ScanReport`; baseline/drift; npm/github targets
- **report-renderer** — terminal / compact / no-emoji / explain / JSON / SARIF / HTML
- **online** — opt-in `--online` enrichment behind an injectable fetch
- **cli** — `scan` / `baseline` / `verify` / `explain` / `policy`, stable exit codes

The JSON report is the stable, emoji-free contract; human renderers
(terminal/SARIF/HTML) are derived from it. The risk engine is pure and
deterministic with no LLM in the verdict path. The network is opt-in and
isolated in `online`; the analysis pipeline is pure, deterministic, and fully
offline. Tests never touch the network.

## Self-guard (opt-in dogfooding)

MCPGuard can scan its own repo's MCP config. This is **not** installed
automatically.

```bash
node scripts/selfguard.mjs        # advisory (always exits 0)
node scripts/selfguard.mjs --ci    # CI mode (non-zero on BLOCK/UNKNOWN)
```

To wire it into Claude Code yourself, add a `PreToolUse` hook to your own
`.claude/settings.json` that runs `node scripts/selfguard.mjs`. MCPGuard does not
write this for you, by design — installing an auto-executing hook is your
decision.

## Limitations & trust boundaries

MCPGuard is a heuristic, evidence-backed pre-flight check, not a proof of safety.
Read [LIMITATIONS.md](LIMITATIONS.md) before relying on it for a security
decision.

## Non-goals (v0.2.x)

No gateway, no payments, no marketplace, no SaaS dashboard, no host execution of
unknown servers, no real secret access, no destructive tool calls. `--online`
reads public registry/repo metadata only — it never executes fetched code.
