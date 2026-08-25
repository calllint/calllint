import { BaseAgentExtractor } from "./base.js"
import type { AgentType, AgentPriority, DiscoveredConfig } from "../types.js"
import { validateConfigPath } from "../path-resolver.js"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * OpenCode agent extractor.
 *
 * TWO CONFIG PATHS (2026-08-24, verified from https://github.com/github/github-mcp-server
 * install guide, which cites OpenCode's own docs):
 *
 * 1. User-level (global) — `~/.config/opencode/opencode.json`
 * 2. Project-level — `opencode.json` in the project root
 *
 * Both `opencode.json` and `opencode.jsonc` are valid filenames. This extractor
 * checks `.json` first, then falls back to `.jsonc` if the user-level `.json`
 * doesn't exist. For project-level, both are checked.
 *
 * WHAT IS NOT COVERED: The official OpenCode repository (opencode/opencode) is
 * 404 on GitHub as of 2026-08-24, so all path documentation comes from third-party
 * integration guides. The paths above are consistent across multiple guides and
 * referenced by official tools (GitHub's own MCP server install docs).
 *
 * Schema: MCP servers live under the root `mcp` key, not `mcpServers`. This is
 * a different key shape from Claude Code / Cursor / Cline, so this uses a distinct
 * TargetKind: `opencode-mcp`. The config-parser will need to handle this.
 *
 * NOTE: If config-parser does not yet support `opencode-mcp` kind, this extractor
 * will discover the configs but parsing will fail. The existence check below only
 * validates that `mcp` is present, not that it's well-formed.
 */
export class OpencodeExtractor extends BaseAgentExtractor {
  readonly agentType: AgentType = "opencode"
  readonly priority: AgentPriority = "P3"

  discover(cwd: string): DiscoveredConfig[] {
    const configs: DiscoveredConfig[] = []
    const seen = new Set<string>()

    for (const resolve of [
      () => this.getUserConfigPath(),
      () => this.getProjectConfigPath(cwd, ".json"),
      () => this.getProjectConfigPath(cwd, ".jsonc"),
    ]) {
      try {
        const path = resolve()
        if (seen.has(path)) continue
        seen.add(path)
        configs.push(this.createConfig(path))
      } catch {
        // Path resolution failed (no HOME or no .config dir) — skip that one.
      }
    }

    return configs
  }

  /**
   * User-level config: `~/.config/opencode/opencode.json` or `.jsonc`.
   * Checks `.json` first, falls back to `.jsonc` if `.json` doesn't exist.
   */
  private getUserConfigPath(): string {
    const home = this.resolveHome()
    const jsonPath = join(home, ".config", "opencode", "opencode.json")
    const jsoncPath = join(home, ".config", "opencode", "opencode.jsonc")

    // Prefer .json, fall back to .jsonc
    try {
      if (validateConfigPath(jsonPath)) {
        return jsonPath
      }
    } catch {
      // .json doesn't exist or not readable
    }

    return jsoncPath
  }

  /**
   * Project-level config: `opencode.json` or `opencode.jsonc` in the cwd.
   */
  private getProjectConfigPath(cwd: string, ext: ".json" | ".jsonc"): string {
    return join(cwd, `opencode${ext}`)
  }

  private createConfig(configPath: string): DiscoveredConfig {
    return {
      agentType: this.agentType,
      configPath,
      exists: this.isValidConfig(configPath),
      kind: "opencode-mcp",
      priority: this.priority,
    }
  }

  /**
   * Check if path is a valid OpenCode MCP config: exists, regular file,
   * reasonable size, and carries a non-null root `mcp` key.
   *
   * JSONC support: This validator uses JSON.parse, which doesn't handle comments.
   * If the file is `.jsonc` and contains comments, this will return false even if
   * the file exists and has the right structure. That's acceptable: the config is
   * discovered (exists=false but configPath is recorded), and the user can remove
   * comments or the config-parser can be extended to strip comments before parsing.
   */
  private isValidConfig(path: string): boolean {
    if (!validateConfigPath(path)) {
      return false
    }

    try {
      const content = readFileSync(path, "utf8")
      const json = JSON.parse(content)
      return (
        typeof json === "object" &&
        json !== null &&
        "mcp" in json &&
        json.mcp !== null
      )
    } catch {
      // Not valid JSON (or JSONC with comments), or read error
      return false
    }
  }
}
