import type { NormalizedMcpServer, ProvidedToolMetadata } from "@calllint/types"

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

/**
 * Split a server's launch spec into `command` + `args`.
 *
 * TWO SHAPES, ONE MEANING. Cursor/Claude/Cline write `command: "npx"` with a separate
 * `args: ["-y", "pkg"]`. OpenCode writes ONE array holding both: `command: ["npx", "-y",
 * "pkg"]` — verified 2026-08-25 against https://opencode.ai/docs/mcp-servers/, where
 * `command` is typed `array` and is the required launch field for `type: "local"`.
 *
 * WHY THIS MATTERS MORE THAN A SHAPE MISMATCH. Every exec-risk detector reads `command`
 * and `args`. When `command` arrived as an array, `asString()` returned undefined and
 * `asStringArray(server.args)` found no `args` key, so an OpenCode server that launches
 * `node ./o.js` normalized to `{transport: "unknown", command: undefined, args: []}` —
 * and `calllint scan --agent opencode` reported `◇ UNKNOWN / S0 Metadata only`. The
 * verdict was not wrong (UNKNOWN is not SAFE, so nothing was falsely cleared), but the
 * coverage was hollow: a real local-exec surface was invisible to every detector.
 *
 * An array whose entries are not all strings is NOT partially salvaged — a launch spec
 * that is half-understood is worse evidence than one openly not understood, because a
 * detector cannot tell which half it is missing.
 */
function launchSpecFor(server: Record<string, unknown>): {
  command: string | undefined
  args: string[]
} {
  if (Array.isArray(server.command)) {
    const parts = server.command
    if (parts.length === 0 || !parts.every((x) => typeof x === "string")) {
      return { command: undefined, args: [] }
    }
    const [head, ...rest] = parts as string[]
    return { command: head, args: rest }
  }
  return { command: asString(server.command), args: asStringArray(server.args) }
}

/**
 * Read the env map, accepting both spellings of the key.
 *
 * `env` is near-universal; OpenCode calls it `environment` (verified 2026-08-25 against
 * the same docs page). Only ONE is read per server — `env` wins when both are present,
 * rather than merging, so a config cannot smuggle a key past review by splitting it
 * across two spellings and relying on merge order.
 *
 * Values are stringified but never interpreted: OpenCode supports `{env:VAR}`
 * interpolation, and resolving it here would mean reading the host's real environment
 * during a Quick Scan. The unresolved placeholder is the honest evidence — the KEY is
 * what a credential detector needs, and the key is present either way.
 */
function envMapFor(server: Record<string, unknown>): Record<string, string> {
  const envRaw = isRecord(server.env)
    ? server.env
    : isRecord(server.environment)
      ? server.environment
      : {}
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(envRaw)) {
    env[k] = typeof v === "string" ? v : String(v)
  }
  return env
}

function transportFor(server: Record<string, unknown>): NormalizedMcpServer["transport"] {
  if (asString(server.url)) {
    const type = asString(server.type)
    if (type === "sse") return "sse"
    if (type === "http" || type === "streamable-http") return "http"
    // A url with no explicit type: treat as http-ish but mark unknown transport.
    return "http"
  }
  // `command` may be a string (Cursor/Claude/…) or an array (OpenCode); either is stdio.
  if (launchSpecFor(server).command) return "stdio"
  return "unknown"
}

function extractProvidedTools(server: Record<string, unknown>): ProvidedToolMetadata[] {
  const guard = server["x-calllint"]
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
  const guard = server["x-calllint"]
  if (isRecord(guard) && asString(guard.instructions)) {
    return asString(guard.instructions)
  }
  return asString(server.instructions)
}

/**
 * Find the server map inside a parsed config. Supports:
 * - { mcpServers: { ... } }   (Cursor, Claude settings, WorkBuddy, Qwen Code, Kiro, Gemini CLI, Cline)
 * - { mcp: { serverName: { ... } } }  (OpenCode — servers directly under mcp, not mcp.servers)
 * - { mcp: { servers: { ... } } }  (OpenClaw)
 * - { servers: { ... } }      (some variants)
 * - { ...serverEntries }      (a bare server map)
 * Returns an empty object if none found (tolerant).
 */
export function findServerMap(root: unknown): Record<string, unknown> {
  if (!isRecord(root)) return {}

  // Standard JSON: { mcpServers: { ... } }
  if (isRecord(root.mcpServers)) return root.mcpServers

  // Codex TOML: { mcp_servers: { ... } } (TOML uses underscores)
  if (isRecord(root.mcp_servers)) return root.mcp_servers

  // OpenCode: { mcp: { serverName: { ... } } } (servers directly under mcp)
  // OpenClaw: { mcp: { servers: { ... } } } (servers under mcp.servers)
  if (isRecord(root.mcp)) {
    // OpenClaw path: check if mcp.servers exists
    if (isRecord(root.mcp.servers)) {
      return root.mcp.servers
    }
    // OpenCode path: mcp directly holds server entries
    // Heuristic: if mcp has any values that look like server configs, treat mcp itself as the map
    const mcpEntries = Object.entries(root.mcp)
    if (
      mcpEntries.length > 0 &&
      mcpEntries.every(
        ([, v]) => isRecord(v) && ("command" in v || "url" in v || "type" in v),
      )
    ) {
      return root.mcp
    }
  }

  // Generic: { servers: { ... } }
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
    const env = envMapFor(server)
    const { command, args } = launchSpecFor(server)

    servers.push({
      name,
      sourceConfigPath,
      transport: transportFor(server),
      command,
      args,
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
