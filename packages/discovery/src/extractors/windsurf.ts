import { BaseAgentExtractor } from "./base.js"
import type { AgentType, AgentPriority, DiscoveredConfig } from "../types.js"
import { resolvePath, validateConfigPath } from "../path-resolver.js"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Windsurf agent extractor.
 *
 * Config path (verified against the official Windsurf/Codeium Cascade MCP docs,
 * docs.windsurf.com/plugins/cascade/mcp): a single home-relative file on every
 * OS —
 * - `~/.codeium/mcp_config.json`  (Windows: `%USERPROFILE%\.codeium\mcp_config.json`)
 *
 * Schema: root-level `mcpServers` (same map shape as Cursor / Claude Code). A
 * stdio server uses `command` / `args` / `env`; a remote server uses `serverUrl`
 * (or `url`). Earlier revisions of this file GUESSED `%APPDATA%\Windsurf\mcp.json`
 * — that was wrong; the real product stores config under `~/.codeium`.
 */
export class WindsurfExtractor extends BaseAgentExtractor {
  readonly agentType: AgentType = "windsurf"
  readonly priority: AgentPriority = "P1"

  discover(cwd: string): DiscoveredConfig[] {
    const configs: DiscoveredConfig[] = []

    // User-level config (home-relative on every OS).
    try {
      const userPath = this.getUserConfigPath()
      configs.push(this.createConfig(userPath))
    } catch {
      // Home-directory resolution failed, skip
    }

    return configs
  }

  private getUserConfigPath(): string {
    return join(this.resolveHome(), ".codeium", "mcp_config.json")
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

      // Windsurf configs have mcpServers at root (verified — same shape as
      // Cursor / Claude Code). mcpServers must exist and not be null.
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
