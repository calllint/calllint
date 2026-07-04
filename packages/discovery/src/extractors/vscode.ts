import { BaseAgentExtractor } from "./base.js"
import type { AgentType, AgentPriority, DiscoveredConfig } from "../types.js"
import { resolvePath, validateConfigPath } from "../path-resolver.js"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * VS Code agent extractor.
 *
 * Config paths:
 * - User (Windows): %APPDATA%\Code\User\mcp.json
 * - User (macOS): ~/Library/Application Support/Code/User/mcp.json
 * - User (Linux): ~/.config/Code/User/mcp.json
 *
 * Note: VS Code MCP configs are user-level only (no project-level .vscode/mcp.json).
 * The config schema matches Cursor/Claude Code (root-level mcpServers key).
 */
export class VSCodeExtractor extends BaseAgentExtractor {
  readonly agentType: AgentType = "vscode"
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
    return join(appDataDir, "Code", "User", "mcp.json")
  }

  private createConfig(configPath: string): DiscoveredConfig {
    const exists = this.isValidConfig(configPath)

    return {
      agentType: this.agentType,
      configPath,
      exists,
      kind: "vscode-mcp-config",
      priority: this.priority,
    }
  }

  /**
   * Check if path is a valid VS Code MCP config.
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

      // VS Code configs have mcpServers at root (same as Cursor/Claude Code)
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
