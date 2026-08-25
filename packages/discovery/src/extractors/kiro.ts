import { BaseAgentExtractor } from "./base.js"
import type { AgentType, AgentPriority, DiscoveredConfig } from "../types.js"
import { validateConfigPath } from "../path-resolver.js"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Kiro agent extractor.
 *
 * TWO CONFIG PATHS, BOTH DOCUMENTED (2026-08-24):
 *
 * 1. Workspace-level — `.kiro/settings/mcp.json`
 *    Applies to current workspace only.
 *
 * 2. User-level — `~/.kiro/settings/mcp.json`
 *    Applies globally across all workspaces.
 *
 * Per official documentation at https://kiro.dev/docs/mcp/configuration/:
 * "If both files exist, configurations are merged with workspace settings taking
 * precedence."
 *
 * Additional note from docs: MCP servers can also be configured in agent JSON
 * files located in `.kiro/agents` directories, which take the highest priority
 * when the same server name appears in multiple configurations. This extractor
 * does NOT read `.kiro/agents/*` — only the two documented MCP config files.
 *
 * Schema: root-level `mcpServers` map, same shape as Claude Code / Cursor / Cline,
 * so this reuses the existing `mcp-servers` TargetKind.
 */
export class KiroExtractor extends BaseAgentExtractor {
  readonly agentType: AgentType = "kiro"
  readonly priority: AgentPriority = "P2"

  discover(cwd: string): DiscoveredConfig[] {
    const configs: DiscoveredConfig[] = []
    const seen = new Set<string>()

    for (const resolve of [
      () => this.getWorkspaceConfigPath(cwd),
      () => this.getUserConfigPath(),
    ]) {
      try {
        const path = resolve()
        if (seen.has(path)) continue
        seen.add(path)
        configs.push(this.createConfig(path))
      } catch {
        // Path resolution failed (no HOME on user-level, or .kiro doesn't exist) —
        // skip that one rather than dropping the other.
      }
    }

    return configs
  }

  /**
   * Workspace-level config: `.kiro/settings/mcp.json` in the current directory.
   */
  private getWorkspaceConfigPath(cwd: string): string {
    return join(cwd, ".kiro", "settings", "mcp.json")
  }

  /**
   * User-level config: `~/.kiro/settings/mcp.json`.
   */
  private getUserConfigPath(): string {
    return join(this.resolveHome(), ".kiro", "settings", "mcp.json")
  }

  private createConfig(configPath: string): DiscoveredConfig {
    return {
      agentType: this.agentType,
      configPath,
      exists: this.isValidConfig(configPath),
      kind: "mcp-servers",
      priority: this.priority,
    }
  }

  /**
   * Check if path is a valid Kiro MCP config: exists, regular file, reasonable
   * size, and carries a non-null root `mcpServers`.
   *
   * An empty `mcpServers: {}` counts as valid — same as other harnesses.
   */
  private isValidConfig(path: string): boolean {
    if (!validateConfigPath(path)) {
      return false
    }

    try {
      const json = JSON.parse(readFileSync(path, "utf8"))
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
