import { readFileSync } from "node:fs"
import { basename } from "node:path"
import type { NormalizedMcpServer, TargetKind } from "@calllint/types"
import { parseJsonText } from "./parseJsonFile.js"
import { normalizeMcpServers } from "./normalizeMcpServers.js"
import { buildPositionIndex, type PositionIndex } from "./positionIndex.js"

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

  // OpenClaw: ~/.openclaw/openclaw.json
  if (normalized.includes(".openclaw/openclaw.json")) return "openclaw-config"

  // WorkBuddy: .workbuddy/mcp.json or ~/.workbuddy/mcp.json
  if (normalized.includes(".workbuddy/mcp.json")) return "mcp-servers"

  // Qwen Code: .qwen/settings.json or ~/.qwen/settings.json
  if (normalized.includes(".qwen/settings.json")) return "mcp-servers"

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

/** Parse a config from raw text (used for inline input and tests). */
export function parseConfigText(text: string, configPath = "<inline>"): ParsedConfig {
  const root = parseJsonText(text, configPath)
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
  const root = parseJsonText(text, path)
  return {
    configPath: path,
    kind: kindForPath(path),
    servers: normalizeMcpServers(root, path),
    root,
    positions: buildPositionIndex(text),
  }
}
