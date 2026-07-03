import type { CommandResult } from "./scan.js"
import type { ParsedArgs } from "../args.js"
import { discoverConfigs, type DiscoveryResult, type DiscoveredConfig } from "@calllint/discovery"

export interface InventoryDeps {
  cwd: string
}

/**
 * inventory command: List all discovered agent configs.
 *
 * Discovers MCP configs from all registered agents (P0: Cursor, Claude Code, Claude Desktop).
 * Does not scan them, only lists paths and metadata.
 *
 * Usage:
 *   calllint inventory              # human-readable output
 *   calllint inventory --json       # JSON output
 *
 * Exit codes:
 *   0 - Success (even if no configs found)
 *   1 - Error during discovery
 */
export function inventoryCommand(args: ParsedArgs, deps: InventoryDeps): CommandResult {
  try {
    const result = discoverConfigs({ cwd: deps.cwd })

    // JSON output
    if (args.flags.json) {
      return {
        exitCode: 0,
        stdout: JSON.stringify(result, null, 2) + "\n",
        stderr: "",
      }
    }

    // Human-readable output
    const lines: string[] = []

    if (result.discovered.length === 0) {
      lines.push("No agent configs discovered.")
      lines.push("")
      lines.push("Searched agents: Cursor, Claude Code, Claude Desktop")
      lines.push("To scan a specific config: calllint scan --config <path>")
    } else {
      lines.push(`Discovered ${result.discovered.length} agent config(s):`)
      lines.push("")

      // Group by agent type
      const byAgent = new Map<string, DiscoveredConfig[]>()
      for (const config of result.discovered) {
        const existing = byAgent.get(config.agentType) || []
        existing.push(config)
        byAgent.set(config.agentType, existing)
      }

      // Sort agents: P0 first
      const sortedAgents = Array.from(byAgent.keys()).sort((a, b) => {
        const priorityA = result.discovered.find(c => c.agentType === a)?.priority || "P3"
        const priorityB = result.discovered.find(c => c.agentType === b)?.priority || "P3"
        return priorityA.localeCompare(priorityB)
      })

      for (const agentType of sortedAgents) {
        const configs = byAgent.get(agentType)!
        const priority = configs[0]!.priority
        const agentLabel = formatAgentType(agentType)

        lines.push(`${agentLabel} (${priority}):`)
        for (const config of configs) {
          lines.push(`  ${config.configPath}`)
        }
        lines.push("")
      }

      lines.push(`To scan all: calllint scan --auto`)
      lines.push(`To scan one: calllint scan --agent ${result.discovered[0]!.agentType}`)
    }

    return {
      exitCode: 0,
      stdout: lines.join("\n") + "\n",
      stderr: "",
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Error discovering configs: ${message}\n`,
    }
  }
}

function formatAgentType(agentType: string): string {
  switch (agentType) {
    case "cursor":
      return "Cursor"
    case "claude-code":
      return "Claude Code"
    case "claude-desktop":
      return "Claude Desktop"
    case "vscode":
      return "VS Code"
    case "windsurf":
      return "Windsurf"
    default:
      return agentType
  }
}
