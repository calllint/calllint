import type { NormalizedMcpServer } from "@calllint/types"
import { extractGenericMcpJson } from "./genericMcpJson.js"

// ---------------------------------------------------------------------------
// P2.2 — Codex MCP TOML extractor (new4 L1 coverage — ADR 0018 §15.12).
//
// Codex declares MCP servers in `config.toml` under `[mcp_servers.NAME]`. We do
// NOT add a TOML dependency (minimal-footprint ethos); instead a focused,
// dependency-free reader handles the subset Codex uses: tables, string values,
// inline string arrays, and inline `{ k = "v" }` env tables. It converts to the
// same `{ mcpServers: {...} }` shape and delegates to the generic JSON mapper,
// so Codex yields the identical fingerprint as every other host.
//
// Out of subset (multi-line arrays, nested tables, numbers/bools beyond
// args/env strings) degrade gracefully: unknown lines are ignored, never thrown.
// ---------------------------------------------------------------------------

interface TomlServer {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  type?: string
}

function stripInlineComment(line: string): string {
  // Remove a trailing # comment that is not inside quotes (best-effort).
  let inStr: '"' | "'" | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inStr) {
      if (c === inStr) inStr = null
    } else if (c === '"' || c === "'") {
      inStr = c
    } else if (c === "#") {
      return line.slice(0, i)
    }
  }
  return line
}

function parseScalar(raw: string): string | undefined {
  const v = raw.trim()
  const m = /^"((?:[^"\\]|\\.)*)"$/.exec(v) || /^'([^']*)'$/.exec(v)
  if (m) return m[1]!.replace(/\\"/g, '"').replace(/\\\\/g, "\\")
  return undefined
}

function parseStringArray(raw: string): string[] {
  const v = raw.trim()
  if (!v.startsWith("[") || !v.endsWith("]")) return []
  const inner = v.slice(1, -1)
  const out: string[] = []
  // Split on commas not inside quotes.
  let buf = ""
  let inStr: '"' | "'" | null = null
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!
    if (inStr) {
      if (c === inStr) inStr = null
      else buf += c
    } else if (c === '"' || c === "'") {
      inStr = c
    } else if (c === ",") {
      if (buf.trim()) out.push(buf.trim())
      buf = ""
    } else {
      buf += c
    }
  }
  if (buf.trim()) out.push(buf.trim())
  // Each element may still be quoted if it contained no quote-strip above.
  return out.map((e) => parseScalar(e) ?? e.replace(/^["']|["']$/g, ""))
}

function parseInlineTable(raw: string): Record<string, string> {
  const v = raw.trim()
  const out: Record<string, string> = {}
  if (!v.startsWith("{") || !v.endsWith("}")) return out
  const inner = v.slice(1, -1)
  for (const pair of splitTopLevel(inner)) {
    const eq = pair.indexOf("=")
    if (eq === -1) continue
    const key = pair.slice(0, eq).trim()
    const val = parseScalar(pair.slice(eq + 1)) ?? pair.slice(eq + 1).trim()
    if (key) out[key] = val
  }
  return out
}

function splitTopLevel(s: string): string[] {
  const out: string[] = []
  let buf = ""
  let inStr: '"' | "'" | null = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (inStr) {
      buf += c
      if (c === inStr) inStr = null
    } else if (c === '"' || c === "'") {
      inStr = c
      buf += c
    } else if (c === ",") {
      if (buf.trim()) out.push(buf.trim())
      buf = ""
    } else {
      buf += c
    }
  }
  if (buf.trim()) out.push(buf.trim())
  return out
}

/** Parse the `[mcp_servers.NAME]` subset of a Codex config.toml into servers. */
export function parseCodexToml(text: string): Record<string, TomlServer> {
  const servers: Record<string, TomlServer> = {}
  let current: TomlServer | undefined
  const tableRe = /^\[mcp_servers\.("?)([^.\]"]+)\1\]\s*$/

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripInlineComment(rawLine).trim()
    if (!line) continue

    const table = tableRe.exec(line)
    if (table) {
      const name = table[2]!
      current = {}
      servers[name] = current
      continue
    }
    // A different table section ends the current mcp_servers block.
    if (line.startsWith("[")) {
      current = undefined
      continue
    }
    if (!current) continue

    const eq = line.indexOf("=")
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    const valRaw = line.slice(eq + 1).trim()

    switch (key) {
      case "command":
        current.command = parseScalar(valRaw)
        break
      case "args":
        current.args = parseStringArray(valRaw)
        break
      case "url":
        current.url = parseScalar(valRaw)
        break
      case "type":
        current.type = parseScalar(valRaw)
        break
      case "env":
        current.env = parseInlineTable(valRaw)
        break
      default:
        break
    }
  }
  return servers
}

/** Extract normalized servers from Codex config.toml text. */
export function extractGenericMcpToml(
  text: string,
  sourceConfigPath = "config.toml",
): NormalizedMcpServer[] {
  const servers = parseCodexToml(text)
  if (Object.keys(servers).length === 0) return []
  return extractGenericMcpJson({ mcpServers: servers }, sourceConfigPath)
}
