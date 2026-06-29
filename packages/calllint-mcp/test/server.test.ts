import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { handleRequest, decodeLine } from "../src/server.js"
import { VERSION } from "../src/version.js"
import type { ScanOptions } from "@calllint/core"

const INFO = { name: "calllint", version: VERSION }
const OPTS: ScanOptions = { now: 0, generatedAt: "2026-06-01T00:00:00.000Z" }

describe("handleRequest", () => {
  it("initialize returns protocol version, capabilities, serverInfo, instructions", () => {
    const res = handleRequest({ jsonrpc: "2.0", id: 1, method: "initialize" }, INFO, OPTS)
    expect(res && "result" in res).toBe(true)
    const r = (res as { result: Record<string, unknown> }).result
    expect(r.protocolVersion).toBe("2024-11-05")
    expect((r.serverInfo as { name: string }).name).toBe("calllint")
    expect(String(r.instructions)).toMatch(/before installing or approving/i)
  })

  it("tools/list returns the six tools with schemas", () => {
    const res = handleRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }, INFO, OPTS)
    const tools = (res as { result: { tools: { name: string; inputSchema: unknown }[] } }).result.tools
    expect(tools).toHaveLength(6)
    for (const t of tools) expect(t.inputSchema).toBeDefined()
  })

  it("tools/call dispatches to the named tool", () => {
    const res = handleRequest(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "generate_agent_rule", arguments: { host: "claude" } },
      },
      INFO,
      OPTS,
    )
    const r = (res as { result: { content: { text: string }[] } }).result
    expect(r.content[0]!.text).toMatch(/calllint/i)
  })

  it("tools/call with an unknown tool returns INVALID_PARAMS", () => {
    const res = handleRequest(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope" } },
      INFO,
      OPTS,
    )
    expect((res as { error: { code: number } }).error.code).toBe(-32602)
  })

  it("unknown method returns METHOD_NOT_FOUND", () => {
    const res = handleRequest({ jsonrpc: "2.0", id: 5, method: "frob" }, INFO, OPTS)
    expect((res as { error: { code: number } }).error.code).toBe(-32601)
  })

  it("notifications/initialized is a no-op (no reply)", () => {
    expect(handleRequest({ jsonrpc: "2.0", method: "notifications/initialized" }, INFO, OPTS)).toBeNull()
  })

  it("ping replies with an empty result", () => {
    const res = handleRequest({ jsonrpc: "2.0", id: 6, method: "ping" }, INFO, OPTS)
    expect((res as { result: unknown }).result).toEqual({})
  })
})

describe("decodeLine", () => {
  it("blank line → nothing", () => {
    expect(decodeLine("   ")).toEqual({})
  })
  it("bad JSON → parse error response", () => {
    expect(decodeLine("{not json").parseError).toBeDefined()
  })
  it("non-2.0 payload → invalid request", () => {
    const { parseError } = decodeLine(JSON.stringify({ jsonrpc: "1.0", method: "x" }))
    expect((parseError as { error: { code: number } }).error.code).toBe(-32600)
  })
  it("valid request decodes", () => {
    const { req } = decodeLine(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }))
    expect(req?.method).toBe("ping")
  })
})

describe("version lockstep", () => {
  it("VERSION matches package.json", () => {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url))
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
    expect(VERSION).toBe(pkg.version)
  })
})
