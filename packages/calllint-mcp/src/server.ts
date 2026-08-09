// ---------------------------------------------------------------------------
// calllint-mcp — minimal MCP stdio transport (ADR 0025). Hand-rolled JSON-RPC
// 2.0 over newline-delimited JSON on stdin/stdout. Zero runtime deps; bundled by
// esbuild like the CLI. stdout is the protocol channel ONLY — all logs go to
// stderr. We implement just the slice MCP needs: initialize / tools/list /
// tools/call (+ the `notifications/initialized` no-op).
// ---------------------------------------------------------------------------

import type { ScanOptions } from "@calllint/core"
import { TOOLS, TOOLS_BY_NAME } from "./tools.js"
import { RESOURCES, RESOURCE_TEMPLATES, readResource } from "./resources.js"

const PROTOCOL_VERSION = "2024-11-05"

/**
 * Every protocol revision this server can serve a request at. `PROTOCOL_VERSION`
 * is the one advertised at `initialize`; this is the set a per-request
 * declaration is checked against (ADR 0063).
 *
 * 2026-07-28 is deliberately ABSENT. Adding it here is the public claim of
 * support, and new17 §19 forbids that until a batch implements the surface —
 * which this one does not: `server/discover` is `MUST implement` upstream and
 * is owned by M26-2. Asserted in `test/server.test.ts` so the omission cannot
 * be undone silently.
 */
const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [PROTOCOL_VERSION]

/**
 * The `_meta` key carrying the per-request protocol version in 2026-07-28.
 * Quoted from the vendored bytes at
 * `third_party/mcp-spec/2026-07-28/schema.ts:76` (`RequestMetaObject`), where
 * it is a REQUIRED field. Digest-locked, so this string cannot drift from
 * upstream unnoticed.
 */
const META_PROTOCOL_VERSION_KEY = "io.modelcontextprotocol/protocolVersion"

/**
 * The natural-language guidance returned by BOTH `initialize` (as `instructions`)
 * and `server/discover` (as `DiscoverResult.instructions`). One constant, because
 * the two methods describe the same server — a second copy would be a claim about
 * two strings that a test measures as one.
 */
const INSTRUCTIONS =
  "Use BEFORE installing or approving other MCP servers. CallLint is a " +
  "static preflight safety gate — it never executes a scanned server. " +
  "Verdicts: SAFE (no blockers observed) / REVIEW / BLOCK / UNKNOWN."

/**
 * The `ServerCapabilities` object, shared by `initialize` and `server/discover`
 * for the same reason as `INSTRUCTIONS`. Both keys are empty objects: the tools
 * and resources capabilities are advertised as present, with no sub-capabilities
 * (no `listChanged`, no `subscribe` — this server serves committed bytes and has
 * nothing to notify about).
 */
const CAPABILITIES = { tools: {}, resources: {} } as const

export interface ServerInfo {
  name: string
  version: string
}

interface RequestMeta {
  [META_PROTOCOL_VERSION_KEY]?: unknown
  [key: string]: unknown
}

interface JsonRpcRequest {
  jsonrpc: "2.0"
  id?: string | number | null
  method: string
  params?: Record<string, unknown> & { _meta?: RequestMeta }
}

type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | {
      jsonrpc: "2.0"
      id: string | number | null
      error: { code: number; message: string; data?: unknown }
    }

const ERR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  /**
   * `UNSUPPORTED_PROTOCOL_VERSION`, quoted from the vendored bytes at
   * `third_party/mcp-spec/2026-07-28/schema.ts:450`. In the MCP reserved range
   * (-32000..-32099), so it does not collide with the five base JSON-RPC codes
   * above. Digest-locked upstream; asserted against the bytes by
   * `tests/invariants/mcp-spec-vendor.invariants.test.ts`.
   */
  UNSUPPORTED_PROTOCOL_VERSION: -32022,
} as const

function result(id: string | number | null, value: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result: value }
}
function error(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } }
}

/**
 * The `UnsupportedProtocolVersionError` shape from
 * `third_party/mcp-spec/2026-07-28/schema.ts:483` — `data` carries `supported`
 * (so the client can pick a mutually supported version and retry) and
 * `requested`. Upstream requires both; a bare code would tell a client it
 * failed without telling it what to retry with.
 */
function unsupportedVersionError(
  id: string | number | null,
  requested: string,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: ERR.UNSUPPORTED_PROTOCOL_VERSION,
      message: `Unsupported protocol version: ${requested}`,
      data: { supported: [...SUPPORTED_PROTOCOL_VERSIONS], requested },
    },
  }
}

/**
 * Read the per-request protocol version from `_meta`, if declared.
 *
 * Returns `undefined` when the key is absent — which is the 2024-11-05 wire
 * shape and stays legal here. This server advertises 2024-11-05, so a client
 * that declares nothing gets today's behaviour unchanged; only an explicit
 * declaration is checked. A non-string value is NOT silently ignored: it is
 * returned as the empty string so it fails the check rather than passing as
 * "undeclared", because a malformed declaration is a client bug, not an
 * absence.
 */
export function readRequestedProtocolVersion(req: JsonRpcRequest): string | undefined {
  const meta = req.params?._meta
  if (meta == null || typeof meta !== "object") return undefined
  if (!(META_PROTOCOL_VERSION_KEY in meta)) return undefined
  const declared = meta[META_PROTOCOL_VERSION_KEY]
  return typeof declared === "string" ? declared : ""
}

/**
 * Handle a single decoded JSON-RPC request. Pure given `info`/`scanOpts`.
 * Returns a response, or null for notifications (no id → no reply).
 */
export function handleRequest(
  req: JsonRpcRequest,
  info: ServerInfo,
  scanOpts: ScanOptions,
): JsonRpcResponse | null {
  const id = req.id ?? null
  const isNotification = req.id === undefined || req.id === null

  // Per-request version negotiation (D1/D3, ADR 0063). Checked BEFORE the
  // method switch so an unsupported version is rejected uniformly instead of
  // per-method — and before any tool handler runs, so a mismatched client
  // cannot reach a scan. A notification gets no reply even on mismatch (no id
  // → nowhere to send the error), which is JSON-RPC, not a version exemption.
  const requested = readRequestedProtocolVersion(req)
  if (requested !== undefined && !SUPPORTED_PROTOCOL_VERSIONS.includes(requested)) {
    return isNotification ? null : unsupportedVersionError(id, requested)
  }

  switch (req.method) {
    case "initialize":
      return result(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: CAPABILITIES,
        serverInfo: info,
        instructions: INSTRUCTIONS,
      })

    /**
     * `server/discover` — D4, ADR 0064. Upstream declares it **MUST implement**
     * (`third_party/mcp-spec/2026-07-28/schema.ts:657`), so it is served here even
     * though this server still advertises 2024-11-05: implementing it is what makes
     * a later adoption possible, and it is additive at today's version because the
     * method did not previously exist.
     *
     * All five fields `DiscoverResult` requires are emitted — `supportedVersions`
     * and `capabilities` from `schema.ts:678`, plus `resultType`/`ttlMs`/`cacheScope`
     * inherited from `CacheableResult`/`Result`. D4's row in the delta matrix names
     * only the first two; the other three were measured off the locked
     * `schema.json` `required` arrays (ADR 0064 §2) and are asserted by a gate that
     * reads those arrays rather than restating them.
     *
     * `resultType` is on THIS result only, not on the other eight — see ADR 0064 §4.
     * `ttlMs: 0` / `cacheScope: "private"` are the inert ends of both enums, not a
     * caching strategy (§4). There is deliberately no `serverInfo` in the body:
     * upstream puts identity in `_meta` as an optional SHOULD, and the changelog
     * sentence claiming otherwise is wrong (§2.1).
     */
    case "server/discover":
      return result(id, {
        resultType: "complete",
        ttlMs: 0,
        cacheScope: "private",
        supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
        capabilities: CAPABILITIES,
        instructions: INSTRUCTIONS,
      })

    case "notifications/initialized":
    case "initialized":
      return null // notification: no reply

    case "ping":
      return result(id, {})

    case "tools/list":
      return result(id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      })

    case "tools/call": {
      if (isNotification) return null
      const params = req.params ?? {}
      const name = typeof params.name === "string" ? params.name : ""
      const tool = TOOLS_BY_NAME.get(name)
      if (!tool) return error(id, ERR.INVALID_PARAMS, `Unknown tool: ${name || "(none)"}`)
      const args = (params.arguments as Record<string, unknown>) ?? {}
      const toolResult = tool.handler(args, scanOpts)
      return result(id, toolResult)
    }

    case "resources/list":
      return result(id, { resources: RESOURCES })

    case "resources/templates/list":
      return result(id, { resourceTemplates: RESOURCE_TEMPLATES })

    case "resources/read": {
      if (isNotification) return null
      const uri = typeof req.params?.uri === "string" ? req.params.uri : ""
      const contents = readResource(uri)
      if (!contents) return error(id, ERR.INVALID_PARAMS, `Unknown resource: ${uri || "(none)"}`)
      return result(id, { contents })
    }

    default:
      if (isNotification) return null
      return error(id, ERR.METHOD_NOT_FOUND, `Method not found: ${req.method}`)
  }
}

/** Decode one line into a request; returns a parse-error response on bad JSON. */
export function decodeLine(line: string): { req?: JsonRpcRequest; parseError?: JsonRpcResponse } {
  const trimmed = line.trim()
  if (!trimmed) return {}
  try {
    const obj = JSON.parse(trimmed) as JsonRpcRequest
    if (obj.jsonrpc !== "2.0" || typeof obj.method !== "string") {
      return { parseError: error(obj?.id ?? null, ERR.INVALID_REQUEST, "Invalid JSON-RPC request") }
    }
    return { req: obj }
  } catch {
    return { parseError: error(null, ERR.PARSE, "Parse error") }
  }
}

/**
 * Run the stdio server loop. Reads newline-delimited JSON-RPC from `stdin`,
 * writes responses to `stdout`. Logs only to stderr. Resolves when stdin ends.
 */
export function runStdioServer(
  info: ServerInfo,
  scanOpts: ScanOptions,
  io: { stdin: NodeJS.ReadableStream; stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream } = {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  },
): Promise<void> {
  return new Promise((resolve) => {
    let buffer = ""

    const write = (res: JsonRpcResponse | null): void => {
      if (res) io.stdout.write(JSON.stringify(res) + "\n")
    }

    io.stdin.setEncoding?.("utf8")
    io.stdin.on("data", (chunk: string) => {
      buffer += chunk
      let nl: number
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        const { req, parseError } = decodeLine(line)
        if (parseError) {
          write(parseError)
          continue
        }
        if (!req) continue
        try {
          write(handleRequest(req, info, scanOpts))
        } catch (e) {
          io.stderr.write(`calllint-mcp: ${e instanceof Error ? e.message : String(e)}\n`)
          write(error(req.id ?? null, ERR.INTERNAL, "Internal error"))
        }
      }
    })
    io.stdin.on("end", () => resolve())
    io.stdin.on("close", () => resolve())
  })
}
