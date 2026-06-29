// ---------------------------------------------------------------------------
// calllint-mcp — minimal MCP stdio transport (ADR 0025). Hand-rolled JSON-RPC
// 2.0 over newline-delimited JSON on stdin/stdout. Zero runtime deps; bundled by
// esbuild like the CLI. stdout is the protocol channel ONLY — all logs go to
// stderr. We implement just the slice MCP needs: initialize / tools/list /
// tools/call (+ the `notifications/initialized` no-op).
// ---------------------------------------------------------------------------

import type { ScanOptions } from "@calllint/core"
import { TOOLS, TOOLS_BY_NAME } from "./tools.js"

const PROTOCOL_VERSION = "2024-11-05"

export interface ServerInfo {
  name: string
  version: string
}

interface JsonRpcRequest {
  jsonrpc: "2.0"
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string } }

const ERR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
} as const

function result(id: string | number | null, value: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result: value }
}
function error(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } }
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

  switch (req.method) {
    case "initialize":
      return result(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: info,
        instructions:
          "Use BEFORE installing or approving other MCP servers. CallLint is a " +
          "static preflight safety gate — it never executes a scanned server. " +
          "Verdicts: SAFE (no blockers observed) / REVIEW / BLOCK / UNKNOWN.",
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
