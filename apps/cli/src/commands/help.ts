export const HELP = `calllint — evidence-backed verdicts for agent tools

USAGE
  calllint <command> [options]

COMMANDS
  check [target]     Compact safety decision for an MCP config or install snippet
  scan-all           Scan every agent-tool surface in the repo (compact table)
  explain <server>   Explain the verdict for one server from the last scan
  verify [target]    Compare a fresh scan against the baseline (drift / rug-pull)

  Advanced:
  scan [target]      Full ScanReport for an MCP config / npm:<pkg> / github:<repo>
  diagnostics [target]  Emit editor/agent-host diagnostics JSON (calllint.diagnostics.v0)
  baseline [target]  Record the approved risk surface as a baseline
  gen-rule --host <h>   Emit the CallLint agent-safety rule for a host (CLAUDE.md, etc.)
  policy init        Write a default calllint.policy.json
  policy explain     Show the effective policy
  help               Show this help

CHECK OPTIONS
  --stdin            Read a config JSON or install snippet from stdin
  --json             Emit the compact decision JSON (calllint.decision.v0, <1 KB)
  --explain          Show the full evidence-backed report instead of the compact view
  --no-emoji         Plain-text symbols (good for CI logs)

TARGETS
  <path>             A config file (default: detect common locations)
  npm:<pkg>[@ver]    Synthesize a config for an npm package (offline)
  github:<owner/repo>[@ref]   A GitHub repo (requires --online)

SCAN OPTIONS
  --changed          Scan only the agent-tool configs changed in the git diff
  --json             Emit the ScanReport JSON (stable, emoji-free)
  --compact          One line per server
  --no-emoji         Plain-text symbols (good for CI logs)
  --sarif            Emit SARIF 2.1.0 (GitHub Code Scanning / CI)
  --markdown         Emit Markdown for PR comments / GitHub Step Summary
  --html             Emit a self-contained HTML report
  --policy <file>    Use a policy file (default: built-in defaults)
  --stdin            Read config JSON from stdin
  --ci               Exit non-zero per policy (BLOCK=30, UNKNOWN=20, REVIEW=10 if enabled)
  --generated-at <iso>  Pin the report timestamp (ISO 8601) for deterministic output

VERIFY OPTIONS
  --baseline <file>  Baseline path (default: .calllint/baseline.json)
  --ci               Exit 40 if the risk surface drifted from the baseline
  --json             Emit the drift report JSON

EXAMPLES
  calllint check .cursor/mcp.json
  calllint check npm:mcp-weather@1.0.0
  echo "npx -y demo-mcp@1.2.3" | calllint check --stdin
  calllint scan-all --no-emoji
  calllint check ./mcp.json --json
  calllint scan .cursor/mcp.json --markdown
  calllint verify ./mcp.json --ci
  calllint explain filesystem
`

export function helpCommand(): { stdout: string; exitCode: number } {
  return { stdout: HELP, exitCode: 0 }
}
