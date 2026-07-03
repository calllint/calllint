import { BaseAgentExtractor } from "./base.js"
import type { AgentType, AgentPriority, DiscoveredConfig } from "../types.js"
import { validateConfigPath } from "../path-resolver.js"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Claude Desktop agent extractor.
 *
 * Config paths (user-level only, no project-level):
 * - Windows: %APPDATA%\Claude\claude_desktop_config.json
 * - macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
 * - Linux: ~/.config/Claude/claude_desktop_config.json
 */
export class ClaudeDesktopExtractor extends BaseAgentExtractor {
  readonly agentType: AgentType = "claude-desktop"
  readonly priority: AgentPriority = "P0"

  async discover(_cwd: string): Promise<DiscoveredConfig[]> {
    const configs: DiscoveredConfig[] = []

    // Only user-level config (no project-level)
    try {
      const userPath = this.getUserConfigPath()
      configs.push(this.createConfig(userPath))
    } catch {
      // Platform-specific path resolution failed, return empty
    }

    return configs
  }

  private getUserConfigPath(): string {
    const appDataDir = this.getAppDataDir()
    return join(appDataDir, "Claude", "claude_desktop_config.json")
  }

  private createConfig(configPath: string): DiscoveredConfig {
    const exists = this.isValidConfig(configPath)

    return {
      agentType: this.agentType,
      configPath,
      exists,
      kind: "claude-settings",
      priority: this.priority,
    }
  }

  /**
   * Check if path is a valid Claude Desktop config.
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

      // Claude Desktop configs have mcpServers at root
      return typeof json === "object" && json !== null && "mcpServers" in json
    } catch {
      // Not valid JSON or read error
      return false
    }
  }
}
