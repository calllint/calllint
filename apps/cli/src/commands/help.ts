export const HELP = `mcpguard — evidence-backed verdicts for agent tools

USAGE
  mcpguard <command> [options]

COMMANDS
  scan [path]        Scan an MCP config file (default: detect common locations)
  explain <server>   Explain the verdict for one server from the last scan
  policy init        Write a default mcpguard.policy.json
  policy explain     Show the effective policy
  help               Show this help

SCAN OPTIONS
  --json             Emit the ScanReport JSON (stable, emoji-free)
  --compact          One line per server
  --no-emoji         Plain-text symbols (good for CI logs)
  --policy <file>    Use a policy file (default: built-in defaults)
  --stdin            Read config JSON from stdin
  --ci               Exit non-zero per policy (BLOCK=30, UNKNOWN=20, REVIEW=10 if enabled)

EXAMPLES
  mcpguard scan .cursor/mcp.json
  cat .cursor/mcp.json | mcpguard scan --stdin --json
  mcpguard scan ./mcp.json --ci --no-emoji
  mcpguard explain filesystem
`

export function helpCommand(): { stdout: string; exitCode: number } {
  return { stdout: HELP, exitCode: 0 }
}
