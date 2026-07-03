import { BaseAgentExtractor } from "./base.js"
import type { AgentType, AgentPriority, DiscoveredConfig } from "../types.js"
import { resolvePath, validateConfigPath } from "../path-resolver.js"
import { existsSync, readFileSync } from "node:fs"

/**
 * Cursor agent extractor.
 *
 * Config paths:
 * - Project: .cursor/mcp.json
 * - User: ~/.cursor/mcp.json (rare, fallback)
 */
export class CursorExtractor extends BaseAgentExtractor {
  readonly agentType: AgentType = "cursor"
  readonly priority: AgentPriority = "P0"

  discover(cwd: string): DiscoveredConfig[] {
    const configs: DiscoveredConfig[] = []

    // 1. Project-level config (primary)
    const projectPath = resolvePath(".cursor/mcp.json", cwd)
    configs.push(this.createConfig(projectPath))

    // 2. User-level config (rare, fallback)
    try {
      const home = this.resolveHome()
      const userPath = resolvePath(".cursor/mcp.json", home)

      // Only include if different from project path
      if (userPath !== projectPath) {
        configs.push(this.createConfig(userPath))
      }
    } catch {
      // Home resolution failed, skip user-level config
    }

    return configs
  }

  private createConfig(configPath: string): DiscoveredConfig {
    const exists = this.isValidConfig(configPath)

    return {
      agentType: this.agentType,
      configPath,
      exists,
      kind: "cursor-mcp-config",
      priority: this.priority,
    }
  }

  /**
   * Check if path is a valid Cursor config.
   * Must exist, be regular file, reasonable size, and contain mcpServers key.
   */
  private isValidConfig(path: string): boolean {
    // Basic validation
    if (!validateConfigPath(path)) {
      return false
    }

    // Content validation: must have mcpServers key
    try {
      const content = readFileSync(path, "utf8")
      const json = JSON.parse(content)

      // Cursor configs have mcpServers at root
      return typeof json === "object" && json !== null && "mcpServers" in json
    } catch {
      // Not valid JSON or read error
      return false
    }
  }
}
