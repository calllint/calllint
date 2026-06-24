export const HELP = `calllint — evidence-backed verdicts for agent tools

USAGE
  calllint <command> [options]

COMMANDS
  scan [target]      Scan an MCP config file, or npm:<pkg> / github:<owner/repo>
  diagnostics [target]  Emit editor/agent-host diagnostics JSON (calllint.diagnostics.v0)
  baseline [target]  Record the approved risk surface as a baseline
  verify [target]    Compare a fresh scan against the baseline (drift / rug-pull)
  explain <server>   Explain the verdict for one server from the last scan
  policy init        Write a default calllint.policy.json
  policy explain     Show the effective policy
  help               Show this help

TARGETS
  <path>             A config file (default: detect common locations)
  npm:<pkg>[@ver]    Synthesize a config for an npm package (offline)
  github:<owner/repo>[@ref]   A GitHub repo (requires --online)

SCAN OPTIONS
  --json             Emit the ScanReport JSON (stable, emoji-free)
  --compact          One line per server
  --no-emoji         Plain-text symbols (good for CI logs)
  --sarif            Emit SARIF 2.1.0 (GitHub Code Scanning / CI)
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
  calllint scan .cursor/mcp.json
  cat .cursor/mcp.json | calllint scan --stdin --json
  calllint scan ./mcp.json --ci --no-emoji
  calllint diagnostics ./mcp.json --json
  calllint scan npm:mcp-weather@1.0.0
  calllint scan github:owner/repo --online
  calllint baseline ./mcp.json
  calllint verify ./mcp.json --ci
  calllint explain filesystem
`

export function helpCommand(): { stdout: string; exitCode: number } {
  return { stdout: HELP, exitCode: 0 }
}
