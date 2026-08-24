import { BaseAgentExtractor } from "./base.js"
import type { AgentType, AgentPriority, DiscoveredConfig } from "../types.js"
import { validateConfigPath } from "../path-resolver.js"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Gemini CLI agent extractor.
 *
 * TWO CONFIG PATHS, BOTH DOCUMENTED (2026-08-24):
 *
 * 1. User-level (global scope) — `~/.gemini/settings.json`
 * 2. Project-level (local scope) — `.gemini/settings.json`
 *
 * Per official documentation at https://geminicli.com/docs/reference/configuration/
 * and https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md:
 *
 * Settings are applied in order with command-line arguments having the highest
 * precedence. The `gemini mcp add` command accepts a `--scope` parameter that
 * determines whether the configuration is written to the user config or project
 * config file.
 *
 * Additional files mentioned in docs but NOT covered here (out of scope for MCP
 * server discovery):
 * - `~/.gemini/mcp-oauth-tokens.json` — OAuth tokens (credentials, not config)
 * - `~/.gemini/mcp-server-enablement.json` — server enable/disable state (runtime)
 *
 * Schema: root-level `mcpServers` object, same shape as Claude Code / Cursor / Cline,
 * so this reuses the existing `mcp-servers` TargetKind.
 */
export class GeminiCliExtractor extends BaseAgentExtractor {
  readonly agentType: AgentType = "gemini-cli"
  readonly priority: AgentPriority = "P2"

  discover(cwd: string): DiscoveredConfig[] {
    const configs: DiscoveredConfig[] = []
    const seen = new Set<string>()

    for (const resolve of [
      () => this.getUserConfigPath(),
      () => this.getProjectConfigPath(cwd),
    ]) {
      try {
        const path = resolve()
        if (seen.has(path)) continue
        seen.add(path)
        configs.push(this.createConfig(path))
      } catch {
        // Path resolution failed (no HOME for user-level) — skip that one.
      }
    }

    return configs
  }

  /**
   * User-level config: `~/.gemini/settings.json`.
   */
  private getUserConfigPath(): string {
    return join(this.resolveHome(), ".gemini", "settings.json")
  }

  /**
   * Project-level config: `.gemini/settings.json` in the current directory.
   */
  private getProjectConfigPath(cwd: string): string {
    return join(cwd, ".gemini", "settings.json")
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
   * Check if path is a valid Gemini CLI MCP config: exists, regular file,
   * reasonable size, and carries a non-null root `mcpServers`.
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
