import { readFileSync } from "node:fs"
import { basename, extname } from "node:path"
import type { NormalizedMcpServer, TargetKind } from "@calllint/types"
import { parseJsonText } from "./parseJsonFile.js"
import { normalizeMcpServers } from "./normalizeMcpServers.js"
import { buildPositionIndex, type PositionIndex } from "./positionIndex.js"
import { parse as parseTOML } from "smol-toml"

export interface ParsedConfig {
  configPath: string
  kind: TargetKind
  servers: NormalizedMcpServer[]
  root: unknown
  /**
   * Best-effort map from a config key-path (e.g. "mcpServers.fs.args") to its
   * 1-based source line/column. Used to enrich finding evidence with editor
   * positions after the verdict is decided; never affects parsing or verdicts.
   */
  positions: PositionIndex
}

/** Guess the target kind from a config file path. */
export function kindForPath(path: string): TargetKind {
  const base = basename(path).toLowerCase()
  const normalized = path.toLowerCase().replace(/\\/g, "/")

  // OpenCode: opencode.json or opencode.jsonc in ~/.config/opencode/ or project root
  if ((base === "opencode.json" || base === "opencode.jsonc") && normalized.includes("opencode")) {
    return "opencode-mcp"
  }

  // Codex: .codex/config.toml (user or project level)
  if (base === "config.toml" && normalized.includes(".codex")) return "codex-mcp"

  // OpenClaw: ~/.openclaw/openclaw.json
  if (normalized.includes(".openclaw/openclaw.json")) return "openclaw-config"

  // WorkBuddy: .workbuddy/mcp.json or ~/.workbuddy/mcp.json
  if (normalized.includes(".workbuddy/mcp.json")) return "mcp-servers"

  // Qwen Code: .qwen/settings.json or ~/.qwen/settings.json
  if (normalized.includes(".qwen/settings.json")) return "mcp-servers"

  // Kiro: .kiro/settings/mcp.json or ~/.kiro/settings/mcp.json
  if (normalized.includes(".kiro/settings/mcp.json")) return "mcp-servers"

  // Gemini CLI: .gemini/settings.json or ~/.gemini/settings.json
  if (normalized.includes(".gemini/settings.json")) return "mcp-servers"

  // Cline CLI: ~/.cline/data/settings/cline_mcp_settings.json
  // Cline VS Code extension: <appData>/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json
  if (base === "cline_mcp_settings.json") return "mcp-servers"

  // Claude Code / Claude Desktop: settings.json with Claude in path
  if (base.includes("settings") && normalized.includes("claude")) return "claude-settings"

  // Cursor: mcp.json in .cursor directory
  if (base === "mcp.json" && normalized.includes(".cursor")) return "cursor-mcp-config"

  // VS Code
  if (normalized.includes(".vscode/mcp.json")) return "vscode-mcp-config"

  // Windsurf
  if (normalized.includes(".windsurf/mcp.json")) return "windsurf-mcp-config"

  // Generic MCP config
  if (base === "mcp.json") return "mcp-servers"

  // Fallback to generic MCP
  return "mcp-servers"
}

/**
 * Parse config text in the syntax its PATH implies.
 *
 * WHY THIS IS ONE FUNCTION AND NOT A BRANCH IN EACH ENTRY POINT. `parseConfigFile` dispatched
 * on `.toml` and `parseConfigText` did not, so which syntax a Codex config was read as
 * depended on which entry point the caller happened to reach. Both are public and both are
 * used: `scanConfigFile` → `parseConfigFile`, but `scan --agent <type>` and `scan --auto`
 * read the file themselves and call `scanConfigText` → `parseConfigText`. So the same
 * `~/.codex/config.toml` parsed as TOML through one command and as JSON through another.
 *
 * MEASURED 2026-08-25, against a real Codex install:
 *
 *   calllint scan --agent codex → Parse error ... Invalid JSON: Unexpected token a at position 0
 *   calllint scan --auto        → same line, mid-run
 *
 * `--auto` is the blast radius that matters: it is the command `activation.firstSuccessAction`
 * tells every Claude Code / Cursor / VS Code user to run, so ANY user who also has Codex
 * installed met this error on CallLint's own recommended first step. The discovery layer was
 * never wrong — `CodexExtractor` finds the file and `findServerMap()` already reads TOML's
 * `mcp_servers` — the defect was one missing dispatch on the text path.
 *
 * Keyed on the path rather than sniffing content: a config's syntax is a property of where it
 * lives, and TOML/JSON are not reliably distinguishable from a prefix (`{` is legal in
 * neither's first column by convention alone). `<inline>` and `<stdin>` have no extension and
 * stay JSON, which is what every caller passing them sends.
 */
function parseRootForPath(text: string, configPath: string): unknown {
  return extname(configPath).toLowerCase() === ".toml"
    ? parseTOML(text)
    : parseJsonText(text, configPath)
}

/** Parse a config from raw text (used for inline input and tests). */
export function parseConfigText(text: string, configPath = "<inline>"): ParsedConfig {
  const root = parseRootForPath(text, configPath)
  return {
    configPath,
    kind: configPath === "<inline>" ? "inline" : kindForPath(configPath),
    servers: normalizeMcpServers(root, configPath),
    root,
    positions: buildPositionIndex(text),
  }
}

/** Parse a config from a file on disk. */
export function parseConfigFile(path: string): ParsedConfig {
  const text = readFileSync(path, "utf8")
  const root = parseRootForPath(text, path)
  return {
    configPath: path,
    kind: kindForPath(path),
    servers: normalizeMcpServers(root, path),
    root,
    positions: buildPositionIndex(text),
  }
}
