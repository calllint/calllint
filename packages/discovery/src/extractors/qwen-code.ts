import { BaseAgentExtractor } from "./base.js"
import type { AgentType, AgentPriority, DiscoveredConfig } from "../types.js"
import { resolvePath, validateConfigPath } from "../path-resolver.js"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Qwen Code agent extractor (Alibaba Cloud AI coding assistant).
 *
 * Config paths:
 * - Project: .qwen/settings.json
 * - User: ~/.qwen/settings.json
 *
 * Qwen Code uses standard MCP config format with top-level mcpServers.
 */
export class QwenCodeExtractor extends BaseAgentExtractor {
  readonly agentType: AgentType = "qwen-code"
  readonly priority: AgentPriority = "P1"

  discover(cwd: string): DiscoveredConfig[] {
    const configs: DiscoveredConfig[] = []

    // 1. Project-level config (primary)
    const projectPath = resolvePath(".qwen/settings.json", cwd)
    configs.push(this.createConfig(projectPath))

    // 2. User-level config
    try {
      const userPath = this.getUserSettingsPath()

      // Only include if different from project path
      if (userPath !== projectPath) {
        configs.push(this.createConfig(userPath))
      }
    } catch {
      // Home directory resolution failed, skip user config
    }

    return configs
  }

  private getUserSettingsPath(): string {
    const homeDir = this.resolveHome()
    return join(homeDir, ".qwen", "settings.json")
  }

  private createConfig(configPath: string): DiscoveredConfig {
    const exists = this.isValidConfig(configPath)

    return {
      agentType: this.agentType,
      configPath,
      exists,
      kind: "mcp-servers",
      priority: this.priority,
    }
  }

  /**
   * Check if path is a valid Qwen Code config.
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

      // Qwen Code configs use standard MCP format with top-level mcpServers
      return typeof json === "object" && json !== null && "mcpServers" in json
    } catch {
      // Not valid JSON or read error
      return false
    }
  }
}
