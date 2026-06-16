import { readFileSync } from "node:fs"
import { basename } from "node:path"
import type { NormalizedMcpServer, TargetKind } from "@calllint/types"
import { parseJsonText } from "./parseJsonFile.js"
import { normalizeMcpServers } from "./normalizeMcpServers.js"

export interface ParsedConfig {
  configPath: string
  kind: TargetKind
  servers: NormalizedMcpServer[]
  root: unknown
}

/** Guess the target kind from a config file path. */
export function kindForPath(path: string): TargetKind {
  const base = basename(path).toLowerCase()
  if (base.includes("settings")) return "claude-settings"
  if (base === "mcp.json" || path.includes(".cursor")) return "cursor-mcp-config"
  return "cursor-mcp-config"
}

/** Parse a config from raw text (used for inline input and tests). */
export function parseConfigText(text: string, configPath = "<inline>"): ParsedConfig {
  const root = parseJsonText(text, configPath)
  return {
    configPath,
    kind: configPath === "<inline>" ? "inline" : kindForPath(configPath),
    servers: normalizeMcpServers(root, configPath),
    root,
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
  }
}
