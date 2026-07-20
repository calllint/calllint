<p align="center">
  <img src="logo-mark-128.png" width="96" alt="CallLint logo" />
</p>

# calllint

**Before your agent runs a tool, know what it can read, write, execute, and send.**

CallLint is a CLI-first scanner that gives **evidence-backed verdicts** for the
MCP servers (agent tools) your AI coding agent is about to trust. It reads an MCP
configuration, works out what each server will *actually run*, and returns a
verdict — `SAFE`, `REVIEW`, `BLOCK`, or `UNKNOWN` — backed by concrete evidence,
a risk class, and a recommended runtime policy. **It never executes the server it
is judging.**

## Quick start

```bash
# Scan a config (auto-detects .cursor/mcp.json, .mcp.json, .vscode/mcp.json, …)
npx calllint scan .cursor/mcp.json

# Stable, emoji-free JSON (the machine contract)
npx calllint scan .cursor/mcp.json --json

# CI gate: non-zero exit on a failing verdict
npx calllint scan .cursor/mcp.json --ci
```

Requires Node ≥ 20.

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

`UNKNOWN` is a first-class verdict: when CallLint cannot verify what a server
will do, it says so and never silently upgrades to `SAFE`.

## Exit codes (with `--ci`)

| Code | Meaning |
| --- | --- |
| 0 | SAFE (or verdict not in policy `failOn`) |
| 10 | REVIEW (only when `failOnReview` is enabled) |
| 20 | UNKNOWN |
| 30 | BLOCK |
| 40 | DRIFT (`verify --ci`, risk surface changed vs baseline) |
| 2 | usage error |
| 3 | parse / runtime error |

## More

- SARIF 2.1.0 for GitHub Code Scanning: `calllint scan <config> --sarif`
- Editor / agent-host diagnostics JSON (`calllint.diagnostics.v0`): `calllint diagnostics <config> --json`
- Self-contained HTML report: `calllint scan <config> --html > report.html`
- Drift / rug-pull detection: `calllint baseline <config>` then `calllint verify <config> --ci`
- Policy-as-code: `calllint policy init`
- Continuous Guard: `calllint guard` re-decides the approved authority surface (silent when unchanged); `calllint guard install --host <git|git-pre-push|github|claude-code|copilot|gemini|vscode>` adds a session-start / commit / CI hook that only shells out to `calllint guard` — never a per-call blocker
- Install the preflight into your hosts: `calllint integrate` prints a reversible install plan (writes nothing); `--apply --approve <digest>` is the only writer and reuses the audited atomic-write-and-rollback engine
- Claude Code plugin: a `PreToolUse` hook that *recommends* scanning before an agent-tool config edit — advisory, non-blocking, always exits 0, runs no scan itself

CallLint is a heuristic, evidence-backed pre-flight check, **not a proof of
safety**. `No blockers observed` ≠ guaranteed safe. Full docs, security model,
and limitations: https://github.com/calllint/calllint

## License

Apache-2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE).
