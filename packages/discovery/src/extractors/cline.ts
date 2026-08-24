import { BaseAgentExtractor } from "./base.js"
import type { AgentType, AgentPriority, DiscoveredConfig } from "../types.js"
import { validateConfigPath } from "../path-resolver.js"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Cline agent extractor.
 *
 * TWO CONFIG PATHS, BOTH MEASURED ON DISK (2026-08-24) — Cline ships a CLI and a
 * VS Code extension, and they do NOT share a config file:
 *
 * 1. CLI — `~/.cline/data/settings/cline_mcp_settings.json`
 *    Documented at docs.cline.bot/cline-cli/configuration, which also documents
 *    `CLINE_DATA_DIR` as replacing `~/.cline/data/`. Honoured here, because a user
 *    who relocated their data dir would otherwise get a silent miss.
 *
 * 2. VS Code extension — `<appData>/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
 *    This path is NOT documented anywhere upstream. Both official pages
 *    (docs.cline.bot/mcp/configuring-mcp-servers and the mintlify mirror) name only
 *    the FILENAME and route the reader through a UI button instead. The directory
 *    was read off this machine, where both files exist with `{"mcpServers": {}}`.
 *    `saoudrizwan.claude-dev` is the extension's publisher.id, which is what fixes
 *    the globalStorage folder name.
 *
 * WHAT WAS FALSIFIED. docs.cline.bot/mcp/configuring-mcp-servers states the CLI
 * config is `~/.cline/mcp.json`. That file does not exist on a machine where Cline
 * CLI has run and has written `~/.cline/data/settings/cline_mcp_settings.json`. The
 * two official pages disagree; disk settles it. Do not "restore" `~/.cline/mcp.json`
 * from the docs without re-measuring.
 *
 * Schema: root-level `mcpServers` — same map shape as Cursor / Claude Code / Qwen
 * Code, so this reuses the existing `mcp-servers` TargetKind and needs no schema
 * change. Verified by reading the top-level keys of both files on disk.
 *
 * NOT COVERED: `~/Documents/Cline/MCP/` is where Cline *installs server code*, not
 * where it registers servers. It is a source tree, not a config file, so it is out
 * of scope for discovery.
 */
export class ClineExtractor extends BaseAgentExtractor {
  readonly agentType: AgentType = "cline"
  readonly priority: AgentPriority = "P2"

  discover(_cwd: string): DiscoveredConfig[] {
    const configs: DiscoveredConfig[] = []
    const seen = new Set<string>()

    for (const resolve of [
      () => this.getCliConfigPath(),
      () => this.getExtensionConfigPath(),
    ]) {
      try {
        const path = resolve()
        if (seen.has(path)) continue
        seen.add(path)
        configs.push(this.createConfig(path))
      } catch {
        // Path resolution failed (no HOME, no APPDATA on Windows) — skip that one
        // rather than dropping the other.
      }
    }

    return configs
  }

  /**
   * CLI config. `CLINE_DATA_DIR` replaces `~/.cline/data/` per the official CLI
   * configuration page, so it is honoured before falling back to the default.
   */
  private getCliConfigPath(): string {
    const dataDir = process.env.CLINE_DATA_DIR
    const base = dataDir && dataDir.length > 0 ? dataDir : join(this.resolveHome(), ".cline", "data")
    return join(base, "settings", "cline_mcp_settings.json")
  }

  /**
   * VS Code extension config, under VS Code's per-extension globalStorage.
   * Undocumented upstream — see the class docblock for how it was measured.
   */
  private getExtensionConfigPath(): string {
    return join(
      this.getAppDataDir(),
      "Code",
      "User",
      "globalStorage",
      "saoudrizwan.claude-dev",
      "settings",
      "cline_mcp_settings.json",
    )
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
   * Check if path is a valid Cline MCP config: exists, regular file, reasonable
   * size, and carries a non-null root `mcpServers`.
   *
   * An empty `mcpServers: {}` counts as valid — that is the shape Cline writes on
   * first run, and it is a real config that currently registers nothing, not a
   * missing one. Same call as Windsurf/VS Code make.
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
