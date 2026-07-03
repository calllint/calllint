import { BaseAgentExtractor } from "./base.js"
import type { AgentType, AgentPriority, DiscoveredConfig } from "../types.js"
import { resolvePath, validateConfigPath } from "../path-resolver.js"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Claude Code agent extractor.
 *
 * Config paths:
 * - Project: .claude/settings.json
 * - User (Windows): %APPDATA%\Claude\settings.json
 * - User (macOS): ~/Library/Application Support/Claude/settings.json
 * - User (Linux): ~/.config/claude/settings.json
 */
export class ClaudeCodeExtractor extends BaseAgentExtractor {
  readonly agentType: AgentType = "claude-code"
  readonly priority: AgentPriority = "P0"

  async discover(cwd: string): Promise<DiscoveredConfig[]> {
    const configs: DiscoveredConfig[] = []

    // 1. Project-level config (primary)
    const projectPath = resolvePath(".claude/settings.json", cwd)
    configs.push(this.createConfig(projectPath))

    // 2. User-level config (platform-specific)
    try {
      const userPath = this.getUserSettingsPath()

      // Only include if different from project path
      if (userPath !== projectPath) {
        configs.push(this.createConfig(userPath))
      }
    } catch {
      // Platform-specific path resolution failed, skip user config
    }

    return configs
  }

  private getUserSettingsPath(): string {
    const appDataDir = this.getAppDataDir()
    return join(appDataDir, "Claude", "settings.json")
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
   * Check if path is a valid Claude Code config.
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

      // Claude Code configs have mcpServers at root
      return typeof json === "object" && json !== null && "mcpServers" in json
    } catch {
      // Not valid JSON or read error
      return false
    }
  }
}
