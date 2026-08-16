import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  handleRequest,
  decodeLine,
  readRequestedProtocolVersion,
  readClientCapabilities,
} from "../src/server.js"
import { VERSION } from "../src/version.js"
import { COMMITTED_CONTRACT_SLUGS } from "../src/committedContracts.js"
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
  // Every test below used to declare "2026-07-28" as its unsupported version. M26-4
  // (ADR 0066) made that revision SUPPORTED, so it can no longer stand in for one we
  // reject — a test still using it would pass for the opposite reason and read as
  // green. They now use a date in neither set, and the 2026-07-28 cases moved to the
  // dual-serving block below, where they assert acceptance.
  it("an unsupported version reds with -32022 and the upstream data shape", () => {
    const res = handleRequest(withVersion("1999-01-01"), INFO, OPTS)
    expect(res && "error" in res).toBe(true)
    const err = (res as { error: { code: number; message: string; data: unknown } }).error
    expect(err.code).toBe(-32022)
    expect(err.message).toContain("1999-01-01")
    // Upstream requires BOTH fields: `supported` is what the client retries
    // with, `requested` is what it sent (schema.ts:483). `supported` now carries
    // both revisions, so a client that guessed wrong learns of the new one here.
    expect(err.data).toEqual({ supported: ["2024-11-05", "2026-07-28"], requested: "1999-01-01" })
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
    const res = handleRequest(withVersion("1999-01-01", "no/such/method"), INFO, OPTS)
    expect((res as { error: { code: number } }).error.code).toBe(-32022)
  })

  it("the version check also precedes the REMOVED-method guard, so the reason is not swapped", () => {
    // M26-4 added a second pre-switch gate (methods removed at 2026-07-28). Order
    // matters between the two as well: an unsupported version declaring a removed
    // method must red on the VERSION, not on the method — otherwise the client is
    // told a method does not exist when the real problem is that it asked at a
    // revision this server does not speak.
    const res = handleRequest(withVersion("1999-01-01", "ping"), INFO, OPTS)
    expect((res as { error: { code: number } }).error.code).toBe(-32022)
  })

  it("a mismatched version cannot reach a tool handler", () => {
    const req = {
      jsonrpc: "2.0" as const,
      id: 1,
      method: "tools/call",
      params: { name: "scan_mcp_config_json", arguments: {}, _meta: { [META_KEY]: "1999-01-01" } },
    }
    const res = handleRequest(req, INFO, OPTS)
    expect((res as { error: { code: number } }).error.code).toBe(-32022)
  })

  it("a NOTIFICATION with a bad version gets no reply (JSON-RPC, not a version exemption)", () => {
    const req = { jsonrpc: "2.0" as const, method: "notifications/initialized", params: { _meta: { [META_KEY]: "1999-01-01" } } }
    expect(handleRequest(req, INFO, OPTS)).toBeNull()
  })
})

describe("the 2026-07-28 claim, made by M26-4 (ADR 0066)", () => {
  // This block was "no premature claim of 2026-07-28 support" and asserted the
  // omission. M26-4 makes the claim, so the assertions invert — deliberately, and
  // the inversion is the point: what used to prove the revision was refused now
  // proves it is served whole. The guard that replaces "we must not claim it" is
  // "every request is served at exactly one revision", asserted below and in the
  // vendor gate's conditional-emission test.
  it("initialize still answers 2024-11-05 — it is the LEGACY handshake, not our identity", () => {
    // `PROTOCOL_VERSION` deliberately did not move. Its meaning narrowed: it is the
    // revision the removed handshake replies with, for clients that never learned
    // about `server/discover`. Moving it would have told a 2024-11-05 client it was
    // talking to a revision whose methods this arm does not implement.
    const res = handleRequest({ jsonrpc: "2.0", id: 1, method: "initialize" }, INFO, OPTS)
    const r = (res as { result: { protocolVersion: string } }).result
    expect(r.protocolVersion).toBe("2024-11-05")
  })

  it("2026-07-28 IS in the supported set — declaring it succeeds", () => {
    const res = handleRequest(withVersion("2026-07-28"), INFO, OPTS)
    expect(res && "result" in res).toBe(true)
  })

  it("server/discover advertises BOTH revisions, oldest first", () => {
    // Order is load-bearing, and negative control #156 sharpened HOW. Reversing the
    // array reds here and in two sibling assertions, but does NOT change which revision
    // an undeclared request gets: that is decided by `requested ?? PROTOCOL_VERSION`,
    // which names the constant and never indexes the array. So the order is not the
    // mechanism — it is the ADVERTISEMENT that must agree with the mechanism. Reversed,
    // the server would still serve absence as 2024-11-05 while telling clients the
    // stateless revision leads the list they pick a fallback from. The rule itself is
    // pinned once, at its decision point, by mcp-spec-vendor.invariants.test.ts:624.
    const res = handleRequest({ jsonrpc: "2.0", id: 1, method: "server/discover" }, INFO, OPTS)
    const r = (res as { result: { supportedVersions: string[] } }).result
    expect(r.supportedVersions).toEqual(["2024-11-05", "2026-07-28"])
  })
})

describe("clientCapabilities is read at 2026-07-28 and decides nothing (M26-6, ADR 0067)", () => {
  const CAPS_KEY = "io.modelcontextprotocol/clientCapabilities"
  /** A bare request carrying the given `_meta`, for reading the helper directly. */
  const reqWith = (meta: Record<string, unknown>) => ({
    jsonrpc: "2.0" as const,
    id: 1,
    method: "tools/list",
    params: { _meta: meta },
  })
  /** A 2026-07-28 request whose `_meta` carries exactly the given extra keys. */
  const withMeta = (extra: Record<string, unknown>) =>
    handleRequest(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: { _meta: { [META_KEY]: "2026-07-28", ...extra } },
      },
      INFO,
      OPTS,
    )

  it("a client sending ONLY the version key is served byte-identically to one sending both", () => {
    // This is the testable form of "tolerant". Upstream marks both `_meta` keys
    // REQUIRED, but its remedy for a missing capability is the on-demand -32021
    // whose `data.requiredCapabilities` names what the SERVER needs — and no
    // CallLint tool needs anything. Refusing here would reject exactly the
    // clients that can reach 2026-07-28 at all, since the version key is how
    // they get here.
    const versionOnly = withMeta({})
    const both = withMeta({ [CAPS_KEY]: { sampling: {} } })
    expect(JSON.stringify(versionOnly)).toBe(JSON.stringify(both))
    expect(versionOnly).toHaveProperty("result")
  })

  it("an EMPTY capabilities object is a declaration, not an absence", () => {
    // `ClientCapabilities.required` is null upstream and "an empty object means
    // the client supports no optional capabilities" — a real statement, distinct
    // from sending no key. The reader keeps the two apart; collapsing them would
    // make a future reader's "did the client tell us?" answer wrong for `{}`.
    expect(readClientCapabilities(reqWith({}))).toEqual({ declared: false, capabilities: null })
    expect(readClientCapabilities(reqWith({ [CAPS_KEY]: {} }))).toEqual({
      declared: true,
      capabilities: {},
    })
    expect(readClientCapabilities(reqWith({ [CAPS_KEY]: { roots: {} } }))).toEqual({
      declared: true,
      capabilities: { roots: {} },
    })
  })

  it("a malformed declaration is declared-but-null, never folded into absence", () => {
    // Same rule as a malformed version string becoming `""`: a client bug must
    // stay visible. An array is an object to `typeof`, so it is excluded
    // explicitly rather than by accident.
    //
    // Explicit `null` is DECLARED. The first draft of this test expected
    // `declared: false` for it and red — correctly. JSON `null` is a value the
    // client sent, not a key it omitted, so reading it as an absence is the very
    // collapse this pair of fields exists to prevent. The expectation was wrong,
    // not the reader.
    for (const bad of ["yes", 7, true, [], null]) {
      expect(readClientCapabilities(reqWith({ [CAPS_KEY]: bad })), `${JSON.stringify(bad)}`).toEqual(
        { declared: true, capabilities: null },
      )
    }
    // The contrast that makes the row above meaningful: no key at all.
    expect(readClientCapabilities(reqWith({}))).toEqual({ declared: false, capabilities: null })
  })

  it("-32021 is never sent, whatever the client declares or omits", () => {
    const bodies = [
      withMeta({}),
      withMeta({ [CAPS_KEY]: {} }),
      withMeta({ [CAPS_KEY]: { sampling: {}, roots: {} } }),
    ].map((r) => JSON.stringify(r))
    for (const body of bodies) expect(body).not.toContain("32021")
    expect(bodies.every((b) => b.includes('"result"'))).toBe(true)
  })
})

describe("dual-revision serving: one revision per request, never a blend", () => {
  const at = (version: string, method: string, params: Record<string, unknown> = {}) =>
    handleRequest(
      { jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: { [META_KEY]: version } } },
      INFO,
      OPTS,
    )

  it("the four methods removed upstream are served at 2024-11-05 and refused at 2026-07-28", () => {
    // The `initialized` bare alias is listed explicitly: a guard built from the
    // changelog's three names would leave a fourth arm serving at a revision that
    // deleted it. Notifications are excluded here — they have no id, so they get no
    // reply either way and are asserted separately below.
    for (const method of ["initialize", "ping"]) {
      expect(at("2024-11-05", method), `${method} must serve at 2024-11-05`).toHaveProperty("result")
      const refused = at("2026-07-28", method)
      expect(refused && "error" in refused, `${method} must be refused at 2026-07-28`).toBe(true)
      expect((refused as { error: { code: number; message: string } }).error.code).toBe(-32601)
      // The message must name the revision, or the client cannot tell "no such
      // method" from "not at the revision you asked for".
      expect((refused as { error: { message: string } }).error.message).toContain("2026-07-28")
    }
  })

  it("a removed NOTIFICATION gets no reply, while the same method WITH an id is refused", () => {
    // JSON-RPC outranks the removal: no id, no response. Returning an error object
    // for a notification would be a protocol violation dressed up as strictness.
    //
    // Both halves are asserted because the id is what distinguishes them, and it is
    // easy to write a "notification" that carries one by accident — this test did, on
    // its first run, and passed the removal guard's error straight back. `at()` cannot
    // express a notification (it always sets an id), so the request is built here.
    const notify = (version: string, method: string) =>
      handleRequest(
        { jsonrpc: "2.0", method, params: { _meta: { [META_KEY]: version } } },
        INFO,
        OPTS,
      )
    for (const version of ["2024-11-05", "2026-07-28"]) {
      for (const method of ["notifications/initialized", "initialized"]) {
        expect(notify(version, method), `${method} at ${version} must get no reply`).toBeNull()
      }
    }
    // Non-vacuity, and the asymmetry is the REVISION, not the id: measured, the
    // legacy arm returns null even for an id-bearing request (`case
    // "notifications/initialized": return null`, ignoring the id), so at 2024-11-05
    // both forms are silent. Only at 2026-07-28 does an id-bearing request produce
    // something — which proves the nulls above are the notification rule and not the
    // method being unreachable everywhere.
    for (const method of ["notifications/initialized", "initialized"]) {
      expect(at("2024-11-05", method), `${method} is silent at 2024-11-05 even with an id`).toBeNull()
      // Read the code out rather than asserting `toHaveProperty("error.code")` on the
      // response object: negative control #159 dropped `initialized` from the removal set
      // and this line threw `Cannot convert undefined or null to object` — a crash whose
      // message named neither the method nor the revision. `toHaveProperty` on a null
      // receiver throws instead of failing, so the control's own diagnosis was unreadable.
      // The observed value is printed either way now.
      const refused = at("2026-07-28", method) as { error?: { code?: number } } | null
      expect(
        refused?.error?.code ?? refused,
        `${method} with an id must be refused at 2026-07-28 with -32601`,
      ).toBe(-32601)
    }
  })

  it("the cacheable results carry the envelope at 2026-07-28 and NOTHING extra at 2024-11-05", () => {
    // Upstream's back-compat sentence licenses exactly this: a client on the earlier
    // revision "MUST treat the absent field as complete", so the field must be
    // absent there rather than helpfully included.
    for (const method of ["tools/list", "resources/list", "resources/templates/list"]) {
      const legacy = (at("2024-11-05", method) as { result: Record<string, unknown> }).result
      expect(Object.keys(legacy), `${method} at 2024-11-05 must not gain fields`).not.toContain(
        "resultType",
      )
      expect(Object.keys(legacy)).not.toContain("ttlMs")
      expect(Object.keys(legacy)).not.toContain("cacheScope")

      const stateless = (at("2026-07-28", method) as { result: Record<string, unknown> }).result
      expect(stateless.resultType, `${method} at 2026-07-28 owes resultType`).toBe("complete")
      expect(stateless.ttlMs).toBe(0)
      expect(stateless.cacheScope).toBe("private")
    }
  })

  it("tools/call gains resultType but NOT the cache hints — upstream made it non-cacheable", () => {
    // The safety-relevant asymmetry: `tools/call` is the one result that carries a
    // CallLint verdict, and `CallToolResult.required` has `resultType` without the
    // two hints. So no caching decision taken here can stale a verdict.
    const params = { name: "explain_finding", arguments: { findingId: "MCP-EXEC-01" } }
    const stateless = (at("2026-07-28", "tools/call", params) as { result: Record<string, unknown> })
      .result
    expect(stateless.resultType).toBe("complete")
    expect(Object.keys(stateless)).not.toContain("ttlMs")
    expect(Object.keys(stateless)).not.toContain("cacheScope")

    const legacy = (at("2024-11-05", "tools/call", params) as { result: Record<string, unknown> }).result
    expect(Object.keys(legacy)).not.toContain("resultType")
  })

  it("an undeclared request is served at 2024-11-05, not at the newest supported revision", () => {
    // The compatibility hinge of the whole batch. Every client that exists today
    // sends no `_meta`; reading absence as "newest" would silently reshape all of
    // their results and refuse their handshake.
    const res = handleRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }, INFO, OPTS)
    const r = (res as { result: Record<string, unknown> }).result
    expect(Object.keys(r)).not.toContain("resultType")
    // And the handshake it depends on is still reachable when nothing is declared.
    expect(handleRequest({ jsonrpc: "2.0", id: 1, method: "initialize" }, INFO, OPTS)).toHaveProperty(
      "result",
    )
  })

  it("the tool and resource counts are identical at both revisions", () => {
    // The envelope wraps results; it must not add, drop, or reorder payload. A
    // revision-conditional count would be a contract break hiding inside a shape change.
    //
    // TOOLS ARE PINNED, RESOURCES ARE COMPARED — and the difference is not stylistic.
    // The tool surface is a hand-authored constant (13 is a hard project constraint), so
    // a literal is the claim. The resource surface is one entry PER COMMITTED CONTRACT
    // (`resources.ts:40` maps `COMMITTED_CONTRACT_SLUGS`), so its size is the cohort's
    // size and moves whenever the registry cohort does: it was 25, and is 100 after ADR
    // 0074 raised the cap. Pinning it here would red this test on every cohort change
    // while saying nothing about the two revisions agreeing, which is what the test is
    // named for. So the cohort count is derived from the bundle and the REVISIONS are
    // compared against each other.
    const tools = (v: string) => ((at(v, "tools/list") as { result: { tools: unknown[] } }).result.tools)
    expect(tools("2024-11-05")).toHaveLength(13)
    expect(tools("2026-07-28")).toHaveLength(13)
    const resources = (v: string) =>
      (at(v, "resources/list") as { result: { resources: unknown[] } }).result.resources
    // Non-vacuity: an empty surface would satisfy the equality below trivially.
    expect(COMMITTED_CONTRACT_SLUGS.length, "an empty contract bundle serves no resources").toBeGreaterThan(0)
    expect(resources("2024-11-05")).toHaveLength(COMMITTED_CONTRACT_SLUGS.length)
    expect(resources("2026-07-28")).toHaveLength(COMMITTED_CONTRACT_SLUGS.length)
    // The equality the test is actually named for, stated over the payload rather than
    // over two counts that could both be wrong in the same way.
    expect(resources("2026-07-28")).toEqual(resources("2024-11-05"))
    expect(tools("2026-07-28")).toEqual(tools("2024-11-05"))
  })
})

// ---------------------------------------------------------------------------
// server/discover — D4, ADR 0064.
//
// The five required fields are QUOTATIONS of the vendored `schema.json`
// `required` arrays; `tests/invariants/mcp-spec-vendor.invariants.test.ts` reads
// those arrays off disk and asserts this file's shape against them. These tests
// measure the wire result.
// ---------------------------------------------------------------------------

describe("server/discover (D4)", () => {
  const discover = (id: number = 1) =>
    (handleRequest({ jsonrpc: "2.0", id, method: "server/discover" }, INFO, OPTS) as {
      result: Record<string, unknown>
    }).result

  it("carries ALL FIVE fields DiscoverResult requires", () => {
    // Asserted as a set rather than field-by-field: a missing field prints as a
    // set difference naming itself, where five separate `toBeDefined()` calls
    // would print "undefined" and leave the reader to work out which one.
    const r = discover()
    for (const k of ["cacheScope", "capabilities", "resultType", "supportedVersions", "ttlMs"]) {
      expect(Object.keys(r), `DiscoverResult.required member ${k}`).toContain(k)
    }
  })

  it("resultType is \"complete\" — the value upstream's back-compat rule names", () => {
    expect(discover().resultType).toBe("complete")
  })

  it("the cache hints are the inert ends of both enums", () => {
    // ttlMs 0 = "immediately stale", cacheScope "private" = never shared across
    // authorization contexts. ADR 0064 §4: chosen to be inert, not as a caching
    // strategy. A future batch wanting discover cached must change these and say why.
    const r = discover()
    expect(r.ttlMs).toBe(0)
    expect(r.cacheScope).toBe("private")
  })

  it("capabilities and instructions are the SAME values initialize returns", () => {
    // One server, two methods that describe it. Two copies of these values would
    // be a claim about two strings, and a drift between them would be invisible
    // to a test that read only one.
    const init = (handleRequest({ jsonrpc: "2.0", id: 1, method: "initialize" }, INFO, OPTS) as {
      result: Record<string, unknown>
    }).result
    const disc = discover()
    expect(disc.capabilities).toEqual(init.capabilities)
    expect(disc.instructions).toEqual(init.instructions)
  })

  it("carries NO serverInfo in the result body — the changelog's claim is wrong", () => {
    // changelog.snapshot.md:16 says discover advertises "identity". DiscoverResult
    // has no such field: upstream puts identity in `_meta` as an optional SHOULD
    // (schema.ts:157). Asserted so a reader following the changelog cannot add it
    // back silently. ADR 0064 §2.1.
    expect(Object.keys(discover())).not.toContain("serverInfo")
  })

  it("a version declaration is still checked — discover is not a negotiation bypass", () => {
    // The check runs before the method switch, so this holds by construction; it
    // is asserted because discover is exactly the method a client would call to
    // ESCAPE a version disagreement, which makes "does it bypass?" worth measuring.
    // Asserted on the whole response, not on `.error.code`: a bypass returns a
    // RESULT, so reading `.error.code` off it reds with "cannot read properties
    // of undefined" — a message that names neither the bypass nor what arrived.
    //
    // Used 2026-07-28 as the mismatch until M26-4 made it supported; a genuinely
    // unsupported date is now required, or this would assert the opposite.
    const res = handleRequest(withVersion("1999-01-01", "server/discover"), INFO, OPTS)
    expect(res, "discover must not bypass version negotiation").toHaveProperty("error.code", -32022)
  })

  it("discover is reachable at BOTH supported revisions, with the same body", () => {
    // Non-vacuity for the bypass test in the other direction, and the reason the
    // envelope on this arm is unconditional (ADR 0066 §4): the method exists only at
    // 2026-07-28, so a caller that declares nothing — or declares the legacy
    // revision — still needs a well-formed DiscoverResult to learn what we support.
    const legacy = handleRequest(withVersion("2024-11-05", "server/discover"), INFO, OPTS) as {
      result: Record<string, unknown>
    }
    const stateless = handleRequest(withVersion("2026-07-28", "server/discover"), INFO, OPTS) as {
      result: Record<string, unknown>
    }
    expect(legacy.result).toEqual(stateless.result)
    expect(legacy.result.resultType).toBe("complete")
  })

  it("declaring the advertised version reaches discover normally", () => {
    // Non-vacuity for the test above: proves -32022 came from the version, not
    // from `server/discover` being unreachable with a `_meta` block present.
    const res = handleRequest(withVersion("2024-11-05", "server/discover"), INFO, OPTS)
    expect((res as { result: { resultType: string } }).result.resultType).toBe("complete")
  })

  it("clientCapabilities is required upstream, unread here, and harmless either way", () => {
    // ADR 0064 §5. A strict read would reject every 2024-11-05 request, since
    // that wire shape has no `_meta` at all. Asserted two-sidedly: declaring the
    // key changes nothing, and omitting it is not an error.
    const withCaps = {
      jsonrpc: "2.0" as const,
      id: 1,
      method: "server/discover",
      params: {
        _meta: {
          [META_KEY]: "2024-11-05",
          "io.modelcontextprotocol/clientCapabilities": { elicitation: {} },
        },
      },
    }
    const declared = (handleRequest(withCaps, INFO, OPTS) as { result: unknown }).result
    expect(declared).toEqual(discover())
  })
})

describe("at 2024-11-05, resultType is on discover ONLY — the legacy wire is byte-identical", () => {
  // Was "resultType is on discover ONLY — the other results are unchanged" under ADR
  // 0064 §4, which forbade the field outright because this server served one
  // revision. M26-4 serves two, so the rule narrows to the one upstream actually
  // states: at 2024-11-05 the ABSENCE is the defined behaviour ("the client MUST
  // treat the absent field as `complete`"), so the field must be absent HERE while
  // being required at 2026-07-28.
  //
  // Its predecessor's comment said the adopting batch "must add it everywhere and
  // delete this test". Half right: adding it everywhere unconditionally would have
  // changed bytes today's clients receive. The test is kept and scoped to the legacy
  // revision instead — deleting it would have retired a live guarantee under cover of
  // a revision bump, and the dual-serving block above asserts the 2026-07-28 half.
  it.each([
    "initialize",
    "tools/list",
    "resources/list",
    "resources/templates/list",
    "ping",
  ])("%s result carries no resultType when nothing is declared", (method) => {
    const res = handleRequest({ jsonrpc: "2.0", id: 1, method }, INFO, OPTS)
    const r = (res as { result: Record<string, unknown> }).result
    expect(Object.keys(r)).not.toContain("resultType")
  })

  it.each(["tools/list", "resources/list", "resources/templates/list"])(
    "%s result carries no resultType when 2024-11-05 is declared EXPLICITLY",
    (method) => {
      // Not redundant with the above: absence and an explicit legacy declaration take
      // different paths through `requested ?? PROTOCOL_VERSION`. A branch keyed on
      // `requested === undefined` rather than on the resolved revision would pass the
      // first form and fail this one.
      const req = { jsonrpc: "2.0" as const, id: 1, method, params: { _meta: { [META_KEY]: "2024-11-05" } } }
      const r = (handleRequest(req, INFO, OPTS) as { result: Record<string, unknown> }).result
      expect(Object.keys(r)).not.toContain("resultType")
    },
  )
})
