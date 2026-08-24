import { BaseAgentExtractor } from "./base.js"
import type { AgentType, AgentPriority, DiscoveredConfig } from "../types.js"
import { validateConfigPath } from "../path-resolver.js"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parse as parseTOML } from "smol-toml"

/**
 * Codex (OpenAI) agent extractor.
 *
 * TWO CONFIG PATHS (measured on disk 2026-08-24):
 * 1. User-level: `~/.codex/config.toml`
 * 2. Project-level: `.codex/config.toml` (assumed by convention, not documented)
 *
 * Schema: TOML table `[mcp_servers.<name>]` with `command`, `args`, and optional
 * `[mcp_servers.<name>.env]` subtable. Measured from a live Codex install:
 *
 *   [mcp_servers.doc-trace-hub]
 *   command = "node"
 *   args = ['d:\my-web-app\...\server.mjs']
 *
 *   [mcp_servers.doc-trace-hub.env]
 *   PROJECT_ROOT = 'd:\my-web-app\sincerity-analyze'
 *
 * TargetKind: `"codex-mcp"` (new) — TOML schema differs from JSON harnesses.
 * The config-parser's `findServerMap()` will need TOML support to handle this.
 *
 * TOML parser: `smol-toml` (spec-compliant, lightweight). Added to config-parser
 * as the repo's first TOML dependency (2026-08-24).
 */
export class CodexExtractor extends BaseAgentExtractor {
  readonly agentType: AgentType = "codex"
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
        // Path resolution failed (no HOME) — skip that one rather than dropping
        // the other.
      }
    }

    return configs
  }

  private getUserConfigPath(): string {
    return join(this.resolveHome(), ".codex", "config.toml")
  }

  private getProjectConfigPath(cwd: string): string {
    return join(cwd, ".codex", "config.toml")
  }

  private createConfig(configPath: string): DiscoveredConfig {
    return {
      agentType: this.agentType,
      configPath,
      exists: this.isValidConfig(configPath),
      kind: "codex-mcp",
      priority: this.priority,
    }
  }

  /**
   * Valid when the file parses as TOML and carries an `mcp_servers` table.
   *
   * An empty `[mcp_servers]` counts as valid: it is a real config that currently
   * registers nothing, matching how the JSON extractors treat `{"mcpServers": {}}`.
   * A config.toml with no `mcp_servers` key at all is a Codex config that has
   * never registered a server — reported as not-a-target rather than as a miss.
   */
  private isValidConfig(path: string): boolean {
    if (!validateConfigPath(path)) {
      return false
    }

    try {
      const parsed = parseTOML(readFileSync(path, "utf8"))
      return (
        typeof parsed === "object" &&
        parsed !== null &&
        "mcp_servers" in parsed &&
        (parsed as Record<string, unknown>).mcp_servers !== null
      )
    } catch {
      // Not valid TOML or read error
      return false
    }
  }
}
