import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { handleRequest, decodeLine, readRequestedProtocolVersion } from "../src/server.js"
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
    // Advertises both the tools and the resources capability (ADR 0056 §8).
    expect((r.capabilities as Record<string, unknown>).tools).toBeDefined()
    expect((r.capabilities as Record<string, unknown>).resources).toBeDefined()
  })

  it("tools/list returns all shipped tools with schemas", () => {
    const res = handleRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }, INFO, OPTS)
    const tools = (res as { result: { tools: { name: string; inputSchema: unknown }[] } }).result.tools
    expect(tools).toHaveLength(13)
    for (const t of tools) expect(t.inputSchema).toBeDefined()
  })

  it("resources/list returns committed adoption contracts under the scheme", () => {
    const res = handleRequest({ jsonrpc: "2.0", id: 7, method: "resources/list" }, INFO, OPTS)
    const resources = (res as { result: { resources: { uri: string }[] } }).result.resources
    expect(resources.length).toBeGreaterThan(0)
    expect(resources.every((r) => r.uri.startsWith("calllint://adoption/"))).toBe(true)
  })

  it("resources/templates/list advertises the slug template", () => {
    const res = handleRequest({ jsonrpc: "2.0", id: 8, method: "resources/templates/list" }, INFO, OPTS)
    const tmpls = (res as { result: { resourceTemplates: { uriTemplate: string }[] } }).result.resourceTemplates
    expect(tmpls.length).toBeGreaterThan(0)
  })

  it("resources/read returns a verbatim contract for a known URI", () => {
    const list = handleRequest({ jsonrpc: "2.0", id: 9, method: "resources/list" }, INFO, OPTS)
    const uri = (list as { result: { resources: { uri: string }[] } }).result.resources[0]!.uri
    const res = handleRequest({ jsonrpc: "2.0", id: 10, method: "resources/read", params: { uri } }, INFO, OPTS)
    const contents = (res as { result: { contents: { text: string }[] } }).result.contents
    expect(JSON.parse(contents[0]!.text).contract.contractDigest).toMatch(/^sha256:/)
  })

  it("resources/read returns INVALID_PARAMS for an unknown URI", () => {
    const res = handleRequest(
      { jsonrpc: "2.0", id: 11, method: "resources/read", params: { uri: "calllint://adoption/nope/x" } },
      INFO,
      OPTS,
    )
    expect((res as { error: { code: number } }).error.code).toBe(-32602)
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

// ---------------------------------------------------------------------------
// Per-request protocol version negotiation — D1/D3, ADR 0063.
//
// The key and the error code are QUOTATIONS of the vendored bytes
// (`third_party/mcp-spec/2026-07-28/schema.ts:76` and `:450`), which are
// digest-locked. `tests/invariants/mcp-spec-vendor.invariants.test.ts` reads
// them off disk; these tests measure that server.ts honours them on the wire.
// ---------------------------------------------------------------------------

const META_KEY = "io.modelcontextprotocol/protocolVersion"

/** Build a request declaring `version` in `_meta`. */
function withVersion(version: unknown, method = "tools/list", id: number = 1) {
  return { jsonrpc: "2.0" as const, id, method, params: { _meta: { [META_KEY]: version } } }
}

describe("per-request protocol version (D1)", () => {
  it("an undeclared version is legal — 2024-11-05 wire shape is unchanged", () => {
    const res = handleRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }, INFO, OPTS)
    expect(res && "result" in res).toBe(true)
  })

  it("_meta present but WITHOUT the version key is still undeclared", () => {
    const req = { jsonrpc: "2.0" as const, id: 1, method: "tools/list", params: { _meta: { progressToken: "t" } } }
    const res = handleRequest(req, INFO, OPTS)
    expect(res && "result" in res).toBe(true)
  })

  it("declaring the advertised version is accepted", () => {
    const res = handleRequest(withVersion("2024-11-05"), INFO, OPTS)
    expect(res && "result" in res).toBe(true)
  })

  it("readRequestedProtocolVersion returns undefined when undeclared, the string when declared", () => {
    expect(readRequestedProtocolVersion({ jsonrpc: "2.0", id: 1, method: "tools/list" })).toBeUndefined()
    expect(readRequestedProtocolVersion(withVersion("2024-11-05"))).toBe("2024-11-05")
  })

  it("a NON-STRING declaration is rejected, not treated as absent", () => {
    // A malformed declaration is a client bug. Reading it as "undeclared"
    // would let `{"...protocolVersion": 20260728}` silently succeed at the
    // wrong version — the exact silent-success D3 exists to end.
    for (const bad of [20260728, null, {}, [], true]) {
      const res = handleRequest(withVersion(bad), INFO, OPTS)
      expect(res && "error" in res, `non-string ${JSON.stringify(bad)} must not pass`).toBe(true)
      expect((res as { error: { code: number } }).error.code).toBe(-32022)
    }
  })
})

describe("UnsupportedProtocolVersionError (D3)", () => {
  it("an unsupported version reds with -32022 and the upstream data shape", () => {
    const res = handleRequest(withVersion("2026-07-28"), INFO, OPTS)
    expect(res && "error" in res).toBe(true)
    const err = (res as { error: { code: number; message: string; data: unknown } }).error
    expect(err.code).toBe(-32022)
    expect(err.message).toContain("2026-07-28")
    // Upstream requires BOTH fields: `supported` is what the client retries
    // with, `requested` is what it sent (schema.ts:483).
    expect(err.data).toEqual({ supported: ["2024-11-05"], requested: "2026-07-28" })
  })

  it("the code is in the MCP reserved range and collides with no base JSON-RPC code", () => {
    const res = handleRequest(withVersion("1999-01-01"), INFO, OPTS)
    const code = (res as { error: { code: number } }).error.code
    expect(code).toBeLessThanOrEqual(-32000)
    expect(code).toBeGreaterThanOrEqual(-32099)
    expect([-32700, -32600, -32601, -32602, -32603]).not.toContain(code)
  })

  it("the version check runs BEFORE the method switch — an unknown method still reds on version", () => {
    // Ordering matters: were the check inside each case, a mismatched client
    // would get METHOD_NOT_FOUND and never learn the real reason.
    const res = handleRequest(withVersion("2026-07-28", "no/such/method"), INFO, OPTS)
    expect((res as { error: { code: number } }).error.code).toBe(-32022)
  })

  it("a mismatched version cannot reach a tool handler", () => {
    const req = {
      jsonrpc: "2.0" as const,
      id: 1,
      method: "tools/call",
      params: { name: "scan_mcp_config_json", arguments: {}, _meta: { [META_KEY]: "2026-07-28" } },
    }
    const res = handleRequest(req, INFO, OPTS)
    expect((res as { error: { code: number } }).error.code).toBe(-32022)
  })

  it("a NOTIFICATION with a bad version gets no reply (JSON-RPC, not a version exemption)", () => {
    const req = { jsonrpc: "2.0" as const, method: "notifications/initialized", params: { _meta: { [META_KEY]: "2026-07-28" } } }
    expect(handleRequest(req, INFO, OPTS)).toBeNull()
  })
})

describe("no premature claim of 2026-07-28 support", () => {
  it("initialize still advertises 2024-11-05", () => {
    const res = handleRequest({ jsonrpc: "2.0", id: 1, method: "initialize" }, INFO, OPTS)
    const r = (res as { result: { protocolVersion: string } }).result
    expect(r.protocolVersion).toBe("2024-11-05")
  })

  it("2026-07-28 is NOT in the supported set", () => {
    // This is the assertion that makes the omission deliberate rather than
    // pending. new17 §19 forbids the public claim until a batch implements the
    // surface; `server/discover` is `MUST implement` upstream and belongs to
    // M26-2, so this batch must NOT accept the revision. Flipping the set
    // without that surface reds here.
    const res = handleRequest(withVersion("2026-07-28"), INFO, OPTS)
    expect(res && "error" in res).toBe(true)
  })

  it("server/discover is still absent — M26-2's surface is not smuggled in here", () => {
    const res = handleRequest({ jsonrpc: "2.0", id: 1, method: "server/discover" }, INFO, OPTS)
    expect((res as { error: { code: number } }).error.code).toBe(-32601)
  })
})
