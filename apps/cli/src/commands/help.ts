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
  action inspect <f>    Preflight a planned external action (calllint.action.v0)
  inbox inspect <f>     Preflight a normalized agent inbox event
  diagnostics [target]  Emit editor/agent-host diagnostics JSON (calllint.diagnostics.v0)
  baseline [target]  Record the approved risk surface as a baseline
  approve            Record the repo-wide capability surface as approved state (L4)
  receipt verify <f>    Validate a calllint.receipt.v0 (structure + signature if present)
  receipt sign <f>      Sign a receipt with a local key (--key; development/testing)
  receipt keygen        Generate a local ed25519 keypair (--out; development/testing)
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
  --badge            Emit a shields.io endpoint badge JSON (SAFE/REVIEW/UNKNOWN/BLOCK)
  --receipt          Also write a local calllint.receipt.v0 (offline reporting layer)
  --receipt-out <f>  Receipt output path (default: calllint-receipt.json)
  --policy <file>    Use a policy file (default: built-in defaults)
  --stdin            Read config JSON from stdin
  --ci               Exit non-zero per policy (BLOCK=30, UNKNOWN=20, REVIEW=10 if enabled)
  --generated-at <iso>  Pin the report timestamp (ISO 8601) for deterministic output

VERIFY OPTIONS
  --baseline <file>  Baseline path (default: .calllint/baseline.json)
  --approved [file]  Diff the repo-wide capability surface against approved state
                     (default: .calllint/approved.json) instead of the baseline
  --ci               Exit 40 if the surface drifted (from baseline or approved state)
  --json             Emit the drift report JSON

EXAMPLES
  calllint check .cursor/mcp.json
  calllint check npm:mcp-weather@1.0.0
  echo "npx -y demo-mcp@1.2.3" | calllint check --stdin
  calllint scan-all --no-emoji
  calllint check ./mcp.json --json
  calllint scan .cursor/mcp.json --markdown
  calllint scan .cursor/mcp.json --badge > calllint-badge.json
  calllint scan .cursor/mcp.json --receipt && calllint receipt verify calllint-receipt.json
  calllint action inspect payment.json
  calllint inbox inspect gmail-reply.normalized.json
  calllint verify ./mcp.json --ci
  calllint approve && calllint verify --approved --ci
  calllint explain filesystem
`

export function helpCommand(): { stdout: string; exitCode: number } {
  return { stdout: HELP, exitCode: 0 }
}
