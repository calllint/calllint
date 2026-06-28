import type { CapabilityFingerprint, NormalizedMcpServer } from "@calllint/types"
import type { GatewayExtraction } from "./openclaw.js"

// ---------------------------------------------------------------------------
// P2.5 — Hermes gateway extractor (new4 Tier-3 — ADR 0018 / 0023).
//
// Hermes is an MCP gateway whose config is YAML: a top-level `mcp_servers:`
// mapping of name → { command, args, env, url, headers, oauth, ... }. We do NOT
// add a YAML dependency; a focused, indentation-based reader handles the subset
// Hermes uses (2-space nested mappings, inline `[...]` arrays, scalars). Servers
// are tagged kind=gateway_runtime; risk is named by GENERIC reason codes only.
// NO hermesRisk.ts — no per-host engine.
// ---------------------------------------------------------------------------

interface HermesServer {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  oauthScopes?: string[]
  /** True when an oauth block is present (drives oauth_scope effect). */
  hasOauth?: boolean
}

function unquote(v: string): string {
  const t = v.trim()
  const m = /^"((?:[^"\\]|\\.)*)"$/.exec(t) || /^'([^']*)'$/.exec(t)
  return m ? m[1]!.replace(/\\"/g, '"') : t
}

function parseInlineArray(v: string): string[] {
  const t = v.trim()
  if (!t.startsWith("[") || !t.endsWith("]")) return []
  return t
    .slice(1, -1)
    .split(",")
    .map((e) => unquote(e))
    .filter((e) => e.length > 0)
}

function indentOf(line: string): number {
  let n = 0
  while (line[n] === " ") n++
  return n
}

/**
 * Parse the `mcp_servers:` subset of a Hermes YAML config. Tolerant: unknown
 * keys are ignored; malformed lines are skipped, never thrown.
 */
export function parseHermesYaml(text: string): Record<string, HermesServer> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"))
  const servers: Record<string, HermesServer> = {}

  let inServers = false
  let serversIndent = -1
  let serverIndent = -1
  let current: HermesServer | undefined
  let inOauth = false
  let oauthIndent = -1

  for (const raw of lines) {
    const indent = indentOf(raw)
    const line = raw.trim()

    if (!inServers) {
      if (/^mcp_servers\s*:/.test(line)) {
        inServers = true
        serversIndent = indent
      }
      continue
    }

    // Left the mcp_servers block (dedent to/under its own indent on a new key).
    if (indent <= serversIndent && /^[^\s:]+\s*:/.test(line)) {
      inServers = false
      current = undefined
      inOauth = false
      continue
    }

    // A server name: `  name:` directly under mcp_servers.
    if (serverIndent === -1 || indent === serverIndent) {
      const nameMatch = /^([^\s:]+)\s*:\s*$/.exec(line)
      if (nameMatch && indent > serversIndent) {
        serverIndent = indent
        current = {}
        inOauth = false
        servers[nameMatch[1]!] = current
        continue
      }
    }
    if (!current) continue

    // OAuth nested block.
    if (inOauth && indent > oauthIndent) {
      const sc = /^scopes\s*:\s*(.*)$/.exec(line)
      if (sc && sc[1]) current.oauthScopes = parseInlineArray(sc[1])
      continue
    } else if (inOauth) {
      inOauth = false
    }

    const kv = /^([^\s:]+)\s*:\s*(.*)$/.exec(line)
    if (!kv) continue
    const key = kv[1]!
    const val = kv[2]!

    switch (key) {
      case "command":
        current.command = unquote(val)
        break
      case "args":
        current.args = parseInlineArray(val)
        break
      case "url":
        current.url = unquote(val)
        break
      case "oauth":
        current.hasOauth = true
        inOauth = true
        oauthIndent = indent
        break
      case "scopes":
        current.oauthScopes = parseInlineArray(val)
        current.hasOauth = true
        break
      default:
        break
    }
  }

  return servers
}

/** Extract normalized gateway servers from a Hermes YAML config. */
export function extractHermes(yaml: string): GatewayExtraction {
  const parsed = parseHermesYaml(yaml)
  const servers: NormalizedMcpServer[] = Object.entries(parsed).map(([name, s]) => ({
    name,
    sourceConfigPath: "hermes.yaml",
    transport: s.url ? "http" : s.command ? "stdio" : "unknown",
    command: s.command,
    args: s.args ?? [],
    envKeys: s.env ? Object.keys(s.env) : [],
    env: s.env ?? {},
    url: s.url,
    providedTools: [],
    raw: {
      gateway: "hermes",
      ...(s.hasOauth ? { oauth: { scopes: s.oauthScopes ?? [] } } : {}),
    },
  }))

  const kind: CapabilityFingerprint["kind"] = "gateway_runtime"
  return { servers, kind }
}
