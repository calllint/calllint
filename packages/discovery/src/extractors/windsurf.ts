import { BaseAgentExtractor } from "./base.js"
import type { AgentType, AgentPriority, DiscoveredConfig } from "../types.js"
import { resolvePath, validateConfigPath } from "../path-resolver.js"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Windsurf agent extractor.
 *
 * Config paths (inferred from Codeium/Windsurf product structure):
 * - User (Windows): %APPDATA%\Windsurf\mcp.json
 * - User (macOS): ~/Library/Application Support/Windsurf/mcp.json
 * - User (Linux): ~/.config/Windsurf/mcp.json
 *
 * Note: Windsurf is a Codeium product. Config schema assumed to match
 * standard MCP format (root-level mcpServers key) until evidence suggests otherwise.
 */
export class WindsurfExtractor extends BaseAgentExtractor {
  readonly agentType: AgentType = "windsurf"
  readonly priority: AgentPriority = "P1"

  discover(cwd: string): DiscoveredConfig[] {
    const configs: DiscoveredConfig[] = []

    // User-level config (platform-specific)
    try {
      const userPath = this.getUserConfigPath()
      configs.push(this.createConfig(userPath))
    } catch {
      // Platform-specific path resolution failed, skip
    }

    return configs
  }

  private getUserConfigPath(): string {
    const appDataDir = this.getAppDataDir()
    return join(appDataDir, "Windsurf", "mcp.json")
  }

  private createConfig(configPath: string): DiscoveredConfig {
    const exists = this.isValidConfig(configPath)

    return {
      agentType: this.agentType,
      configPath,
      exists,
      kind: "windsurf-mcp-config",
      priority: this.priority,
    }
  }

  /**
   * Check if path is a valid Windsurf MCP config.
   * Must exist, be regular file, reasonable size, and contain mcpServers key.
   */
  private isValidConfig(path: string): boolean {
    // Basic validation
    if (!validateConfigPath(path)) {
      return false
    }

    // Content validation: must have mcpServers key with a valid value
    try {
      const content = readFileSync(path, "utf8")
      const json = JSON.parse(content)

      // Windsurf configs assumed to have mcpServers at root
      // mcpServers must exist and not be null
      return (
        typeof json === "object" &&
        json !== null &&
        "mcpServers" in json &&
        json.mcpServers !== null
      )
    } catch {
      // Not valid JSON or read error
      return false
    }
  }
}
