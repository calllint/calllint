import { BaseAgentExtractor } from "./base.js"
import type { AgentType, AgentPriority, DiscoveredConfig } from "../types.js"
import { resolvePath, validateConfigPath } from "../path-resolver.js"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * OpenClaw agent extractor (open-source agent framework).
 *
 * Config paths:
 * - User: ~/.openclaw/openclaw.json
 *
 * OpenClaw config structure:
 * - mcp.servers (MCP configuration) — SUPPORTED
 * - skills (skill permissions) — NOT SUPPORTED IN THIS VERSION
 * - exec (exec capabilities) — NOT SUPPORTED IN THIS VERSION
 *
 * COVERAGE BOUNDARY: This extractor only discovers MCP configuration.
 * Skills and exec permissions require separate analysis mechanisms.
 */
export class OpenClawExtractor extends BaseAgentExtractor {
  readonly agentType: AgentType = "openclaw"
  readonly priority: AgentPriority = "P3"

  discover(cwd: string): DiscoveredConfig[] {
    const configs: DiscoveredConfig[] = []

    // User-level config only (no project-level config documented)
    try {
      const userPath = this.getUserConfigPath()
      configs.push(this.createConfig(userPath))
    } catch {
      // Home directory resolution failed
    }

    return configs
  }

  private getUserConfigPath(): string {
    const homeDir = this.resolveHome()
    return join(homeDir, ".openclaw", "openclaw.json")
  }

  private createConfig(configPath: string): DiscoveredConfig {
    const exists = this.isValidConfig(configPath)

    return {
      agentType: this.agentType,
      configPath,
      exists,
      kind: "openclaw-config",
      priority: this.priority,
    }
  }

  /**
   * Check if path is a valid OpenClaw config with MCP section.
   * Must exist, be regular file, reasonable size, and contain mcp.servers.
   */
  private isValidConfig(path: string): boolean {
    // Basic validation
    if (!validateConfigPath(path)) {
      return false
    }

    // Content validation: must have mcp.servers structure
    try {
      const content = readFileSync(path, "utf8")
      const json = JSON.parse(content)

      // OpenClaw uses nested mcp.servers structure
      return (
        typeof json === "object" &&
        json !== null &&
        typeof json.mcp === "object" &&
        json.mcp !== null &&
        "servers" in json.mcp
      )
    } catch {
      // Not valid JSON or read error
      return false
    }
  }
}
