import type { NormalizedMcpServer, ProvidedToolMetadata } from "@mcpguard/types"

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === "string")
}

function transportFor(server: Record<string, unknown>): NormalizedMcpServer["transport"] {
  if (asString(server.url)) {
    const type = asString(server.type)
    if (type === "sse") return "sse"
    if (type === "http" || type === "streamable-http") return "http"
    // A url with no explicit type: treat as http-ish but mark unknown transport.
    return "http"
  }
  if (asString(server.command)) return "stdio"
  return "unknown"
}

function extractProvidedTools(server: Record<string, unknown>): ProvidedToolMetadata[] {
  const guard = server["x-mcpguard"]
  if (!isRecord(guard)) return []
  const tools = guard.tools
  if (!Array.isArray(tools)) return []
  const out: ProvidedToolMetadata[] = []
  for (const t of tools) {
    if (!isRecord(t)) continue
    out.push({
      name: asString(t.name),
      description: asString(t.description),
      inputSchemaText: asString(t.inputSchemaText),
    })
  }
  return out
}

function extractInstructions(server: Record<string, unknown>): string | undefined {
  const guard = server["x-mcpguard"]
  if (isRecord(guard) && asString(guard.instructions)) {
    return asString(guard.instructions)
  }
  return asString(server.instructions)
}

/**
 * Find the server map inside a parsed config. Supports:
 * - { mcpServers: { ... } }   (Cursor, Claude settings)
 * - { servers: { ... } }      (some variants)
 * - { ...serverEntries }      (a bare server map)
 * Returns an empty object if none found (tolerant).
 */
export function findServerMap(root: unknown): Record<string, unknown> {
  if (!isRecord(root)) return {}
  if (isRecord(root.mcpServers)) return root.mcpServers
  if (isRecord(root.servers)) return root.servers
  // Bare map heuristic: every value is an object that looks like a server.
  const entries = Object.entries(root)
  if (
    entries.length > 0 &&
    entries.every(
      ([, v]) => isRecord(v) && ("command" in v || "url" in v),
    )
  ) {
    return root
  }
  return {}
}

/**
 * Normalize a parsed config into a list of servers. Tolerant: unknown fields are
 * preserved in `raw`, missing fields are defaulted, never throws on shape.
 */
export function normalizeMcpServers(
  root: unknown,
  sourceConfigPath: string,
): NormalizedMcpServer[] {
  const map = findServerMap(root)
  const servers: NormalizedMcpServer[] = []

  for (const [name, value] of Object.entries(map)) {
    const server = isRecord(value) ? value : {}
    const envRaw = isRecord(server.env) ? server.env : {}
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(envRaw)) {
      env[k] = typeof v === "string" ? v : String(v)
    }

    servers.push({
      name,
      sourceConfigPath,
      transport: transportFor(server),
      command: asString(server.command),
      args: asStringArray(server.args),
      envKeys: Object.keys(env),
      env,
      url: asString(server.url),
      instructions: extractInstructions(server),
      providedTools: extractProvidedTools(server),
      raw: value,
    })
  }

  return servers
}
