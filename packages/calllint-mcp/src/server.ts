// ---------------------------------------------------------------------------
// calllint-mcp — minimal MCP stdio transport (ADR 0025). Hand-rolled JSON-RPC
// 2.0 over newline-delimited JSON on stdin/stdout. Zero runtime deps; bundled by
// esbuild like the CLI. stdout is the protocol channel ONLY — all logs go to
// stderr. We implement just the slice MCP needs: initialize / tools/list /
// tools/call (+ the `notifications/initialized` no-op).
//
// Since M26-4 (ADR 0066) this server serves TWO revisions in parallel, selected
// per request from `_meta`: 2024-11-05 keeps the handshake and the bare result
// shapes, 2026-07-28 drops the four removed methods and adds the
// `Result`/`CacheableResult` envelope. A request is served wholly at one
// revision or the other — never a blend of the two.
// ---------------------------------------------------------------------------

import type { ScanOptions } from "@calllint/core"
import { TOOLS, TOOLS_BY_NAME } from "./tools.js"
import { RESOURCES, RESOURCE_TEMPLATES, readResource } from "./resources.js"

/**
 * The revision the LEGACY handshake answers with — not "the version this server
 * is". That narrowing is the whole of ADR 0066: before M26-4 this constant was
 * the server's single identity, so `SUPPORTED_PROTOCOL_VERSIONS` could only ever
 * hold one member. It now names one of two revisions served in parallel, and it
 * is `initialize`'s answer specifically, because `initialize` does not exist at
 * 2026-07-28 (see `REMOVED_AT_STATELESS`) and so can only ever speak for the old
 * one. The literal is unchanged and must stay unchanged: an artifact pointer
 * cites this exact line (`mcp-artifact-claims.invariants.test.ts`).
 */
const PROTOCOL_VERSION = "2024-11-05"

/**
 * The stateless revision, added to the supported set by M26-4 (ADR 0066). Named
 * rather than inlined because three separate things now branch on it — the
 * removed-method guard, the result envelope, and `server/discover`'s advertised
 * list — and a gate asserting "the branch reads the same version the array
 * advertises" needs one symbol to point at.
 */
const STATELESS_PROTOCOL_VERSION = "2026-07-28"

/**
 * Every protocol revision this server can serve a request at, and — since M26-4 —
 * the public claim of support (M-OPEN-5 (c), discharged by ADR 0066). A request
 * declaring either member is served AT that member: 2024-11-05 keeps the
 * handshake and the bare result shapes, 2026-07-28 drops the handshake and adds
 * the `Result`/`CacheableResult` envelope. Neither revision is served in a
 * blend; that is why the claim is honest rather than premature.
 *
 * `PROTOCOL_VERSION` first, deliberately: an undeclared request is 2024-11-05
 * traffic, so the oldest supported revision leads the list a client picks a
 * fallback from. Order is asserted, not incidental.
 */
const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [PROTOCOL_VERSION, STATELESS_PROTOCOL_VERSION]

/**
 * The methods 2026-07-28 REMOVES, served here only for 2024-11-05 traffic. Each
 * member is measured absent from the vendored, digest-locked schema (`grep -ci`
 * → 0 for `initialize`, `initialized`, `ping`), so this set is upstream's
 * deletion list, not a preference — asserted against those bytes by
 * `tests/invariants/mcp-spec-vendor.invariants.test.ts`.
 *
 * `"initialized"` is the bare alias `server.ts` has always accepted alongside
 * `"notifications/initialized"`; it is listed explicitly because a guard built
 * from the changelog's three names would leave the fourth arm serving at a
 * revision that deleted it.
 */
const REMOVED_AT_STATELESS: ReadonlySet<string> = new Set([
  "initialize",
  "notifications/initialized",
  "initialized",
  "ping",
])

/**
 * `Result.resultType` — the only member of `Result.required` upstream. An OPEN
 * type (no `enum`, no `const` in the locked `schema.json`), so this is the value
 * we choose, not the value the schema pins: every result this server returns is
 * fully formed at the moment it is returned, never a partial awaiting input.
 */
const RESULT_TYPE_COMPLETE = "complete"

/**
 * The two `CacheableResult` cache hints, decided by ADR 0066 §3 — the decision
 * ADR 0064 §2 recorded as never made ("response caching is a thing CallLint has
 * never decided anything about").
 *
 * `ttlMs: 0` is upstream's "immediately stale, the client MAY re-fetch every
 * time". It is tied to a measurable fact, not to caution: `CAPABILITIES`
 * advertises no `listChanged` and no `subscribe`, and upstream's own changelog
 * says these fields "complement existing `listChanged` notifications". A
 * positive TTL is a freshness promise with no channel to revoke it. So the rule
 * this batch records is not the number — it is that **`ttlMs` may go positive
 * only in the batch that advertises `listChanged`**, which a gate pins.
 *
 * `cacheScope: "private"` is the end of the enum that cannot mis-permit:
 * `"public"` licenses shared intermediaries to serve one authorization
 * context's response to another, `"private"` only restricts. While `ttlMs` is 0
 * the scope is unreachable, so the restrictive value costs nothing.
 *
 * Neither hint can stale a verdict: upstream made the one verdict-bearing
 * method non-cacheable (`CallToolResult.required = ["content", "resultType"]` —
 * no `ttlMs`), which is measured off the locked schema rather than assumed.
 */
const CACHE_TTL_MS = 0
const CACHE_SCOPE = "private"

/**
 * The `_meta` key carrying the per-request protocol version in 2026-07-28.
 * Quoted from the vendored bytes at
 * `third_party/mcp-spec/2026-07-28/schema.ts:76` (`RequestMetaObject`), where
 * it is a REQUIRED field. Digest-locked, so this string cannot drift from
 * upstream unnoticed.
 */
const META_PROTOCOL_VERSION_KEY = "io.modelcontextprotocol/protocolVersion"

/**
 * The `_meta` key carrying the per-request client capabilities in 2026-07-28.
 * Also REQUIRED by `RequestMetaObject` — `required` names BOTH this key and the
 * version key — yet this server reads it WITHOUT ever refusing a request that
 * omits it. That is not laxity; it is what the locked schema actually asks for:
 *
 *   - `ClientCapabilities.required` is `null` and every member
 *     (`elicitation`, `experimental`, `extensions`, `roots`, `sampling`) is
 *     optional, so "an empty object means the client supports no optional
 *     capabilities" is a conformant declaration.
 *   - Upstream defines a dedicated error for the missing case,
 *     `MissingRequiredClientCapabilityError` (-32021), whose `data` REQUIRES
 *     `requiredCapabilities` — the capabilities *the server needs*. It is an
 *     on-demand refusal, not a schema-shaped one.
 *
 * None of CallLint's tools need a client capability: they read committed bytes,
 * run deterministic rules, and return a verdict. There is no elicitation, no
 * sampling, no roots traversal. So there is no capability this server could name
 * in `requiredCapabilities`, and emitting -32021 would be a false statement
 * about our own needs. ADR 0067 §3.
 */
const META_CLIENT_CAPABILITIES_KEY = "io.modelcontextprotocol/clientCapabilities"

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
  [META_CLIENT_CAPABILITIES_KEY]?: unknown
  [key: string]: unknown
}

/**
 * What a client declared about its capabilities on ONE request.
 *
 * `declared` is separate from `capabilities` on purpose: the locked schema says
 * an empty object is a meaningful declaration ("supports no optional
 * capabilities"), which is NOT the same statement as sending no key at all. A
 * single nullable field would collapse the two, and a reader asking "did the
 * client tell us?" would get the wrong answer for `{}`.
 */
export interface DeclaredClientCapabilities {
  declared: boolean
  capabilities: Record<string, unknown> | null
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

/**
 * Add `Result.resultType` when — and only when — the request declared
 * 2026-07-28. Upstream licenses exactly this conditional in the field's own
 * description, quoted verbatim from the locked `schema.json`:
 *
 *   "Servers implementing this protocol version MUST include this field. For
 *   backward compatibility, when a client receives a result from a server
 *   implementing an earlier protocol version (which does not include
 *   `resultType`), the client MUST treat the absent field as \"complete\"."
 *
 * So omitting it for 2024-11-05 traffic is not a gap the client has to tolerate
 * — it is the case upstream wrote a rule for, and the rule's default is the
 * value we would have sent. Emitting it unconditionally would instead add a
 * field to results served at a revision that has no such field.
 */
function withResultType<T extends object>(value: T, at: string): T & { resultType?: string } {
  return at === STATELESS_PROTOCOL_VERSION ? { ...value, resultType: RESULT_TYPE_COMPLETE } : value
}

/**
 * `CacheableResult`'s three fields — `resultType` plus the two cache hints — for
 * the four results upstream made cacheable (`tools/list`, `resources/list`,
 * `resources/templates/list`, `resources/read`). Separate from
 * `withResultType` because the split is upstream's, not ours: `tools/call`
 * requires `resultType` and NOT the hints, so one helper covering both would
 * have to be told which half to apply, and the caller could get it wrong
 * silently.
 */
function withCacheable<T extends object>(
  value: T,
  at: string,
): T & { resultType?: string; ttlMs?: number; cacheScope?: string } {
  if (at !== STATELESS_PROTOCOL_VERSION) return value
  return { ...value, resultType: RESULT_TYPE_COMPLETE, ttlMs: CACHE_TTL_MS, cacheScope: CACHE_SCOPE }
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
 * Read the per-request client capabilities from `_meta`.
 *
 * Read fresh from THIS request every time, and stored nowhere: the locked schema
 * says "Servers MUST NOT infer capabilities from prior requests", so a
 * module-scope cache of this value would be a conformance bug, not an
 * optimisation. `handleRequest` is the only caller and passes its own `req`.
 *
 * Absence is not an error (see `META_CLIENT_CAPABILITIES_KEY`): it returns
 * `{ declared: false, capabilities: null }` and the request proceeds exactly as
 * if the key had been sent. A non-object value is reported as declared-but-null
 * rather than as absent, for the same reason `readRequestedProtocolVersion`
 * turns a malformed version into `""`: a malformed declaration is a client bug,
 * and folding it into "absent" would hide it from any future reader that starts
 * caring about the contents.
 */
export function readClientCapabilities(req: JsonRpcRequest): DeclaredClientCapabilities {
  const meta = req.params?._meta
  if (meta == null || typeof meta !== "object") return { declared: false, capabilities: null }
  if (!(META_CLIENT_CAPABILITIES_KEY in meta)) return { declared: false, capabilities: null }
  const value = meta[META_CLIENT_CAPABILITIES_KEY]
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return { declared: true, capabilities: null }
  }
  return { declared: true, capabilities: value as Record<string, unknown> }
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

  /**
   * The revision this ONE request is served at (D2, ADR 0066). An undeclared
   * request is 2024-11-05 traffic — that is the whole reason the old wire shape
   * has no `_meta` — so absence resolves to `PROTOCOL_VERSION` rather than to
   * the newest supported member. Reading it the other way would silently move
   * every existing client onto the stateless shapes.
   *
   * `requested` is already known to be a supported member here, so `servedAt`
   * is one of exactly two values from this line down.
   */
  const servedAt = requested ?? PROTOCOL_VERSION

  /**
   * Read per-request, used to decide nothing (M26-6, ADR 0067). The declaration
   * is REQUIRED upstream alongside the version key, so a server that reads only
   * one of the two required keys is making a claim it never checked. Reading
   * both makes the claim measurable: this line is why "no CallLint tool needs a
   * client capability" is a fact with a reader rather than a sentence in a
   * comment, and why the absence of -32021 anywhere in this file is asserted
   * rather than incidental.
   *
   * It deliberately does NOT gate anything. Refusing a request that omits the
   * key would reject exactly the clients that reach 2026-07-28 at all (the
   * version key is how they get here), and upstream's own remedy for a missing
   * capability is the on-demand -32021 with the needed capabilities named — a
   * list this server cannot fill in. `void` marks the non-use as intentional so
   * a future reader does not "fix" it by deleting the call.
   */
  void readClientCapabilities(req)

  /**
   * The four methods 2026-07-28 removed answer `METHOD_NOT_FOUND` when the
   * request declares that revision — the same code any other unknown method
   * gets, because to a stateless client these ARE unknown methods. This is what
   * makes the dual claim honest rather than a blend: a client declaring
   * 2026-07-28 cannot reach the handshake, so the server it observes is the one
   * upstream describes, with no removed surface reachable behind the version it
   * asked for.
   *
   * Checked before the switch so the arms below stay single-purpose. It also sits
   * after the version check, but negative control #160 measured that this order is
   * NOT load-bearing today, and the honest reason is worth keeping: the two
   * conditions are DISJOINT. `servedAt` equals `STATELESS_PROTOCOL_VERSION` only
   * when `requested` was already validated as a supported member, so an
   * unsupported declaration can never reach this guard — `"1999-01-01"` + `ping`
   * answers -32022 with the guard in either position, measured both ways.
   *
   * So the ordering is redundant with that disjointness rather than protected by
   * it. Kept because the disjointness is a property of two lines that a later
   * change could break independently (a guard rewritten to test `requested`
   * directly, or a `servedAt` that defaults differently), and this order is the
   * one that stays correct if it does.
   */
  if (servedAt === STATELESS_PROTOCOL_VERSION && REMOVED_AT_STATELESS.has(req.method)) {
    if (isNotification) return null
    return error(
      id,
      ERR.METHOD_NOT_FOUND,
      `Method not found at ${STATELESS_PROTOCOL_VERSION}: ${req.method}`,
    )
  }

  switch (req.method) {
    /**
     * Reachable only at 2024-11-05 — `REMOVED_AT_STATELESS` intercepts it above
     * for stateless traffic. So this arm needs no version branch, and its result
     * carries no `resultType`: `InitializeResult` does not exist at the revision
     * that would require one.
     */
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
     * The three envelope fields are UNCONDITIONAL on this arm, unlike every other
     * result (ADR 0066 §4). `server/discover` exists only at 2026-07-28, so a
     * request reaching it without declaring that revision is a client reading the
     * new spec while omitting the `_meta` the new spec requires — and answering
     * that with a deliberately malformed `DiscoverResult` would punish the one
     * method whose entire job is to tell such a client what we support. `ttlMs: 0`
     * / `cacheScope: "private"` are ADR 0066 §3's decided values, not the inert
     * placeholders ADR 0064 §4 chose; the values coincide, the justification does
     * not. There is deliberately no `serverInfo` in the body: upstream puts
     * identity in `_meta` as an optional SHOULD, and the changelog sentence
     * claiming otherwise is wrong (ADR 0064 §2.1).
     */
    case "server/discover":
      return result(id, {
        resultType: RESULT_TYPE_COMPLETE,
        ttlMs: CACHE_TTL_MS,
        cacheScope: CACHE_SCOPE,
        supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
        capabilities: CAPABILITIES,
        instructions: INSTRUCTIONS,
      })

    case "notifications/initialized":
    case "initialized":
      return null // notification: no reply (2024-11-05 only — see REMOVED_AT_STATELESS)

    case "ping":
      return result(id, {})

    case "tools/list":
      return result(
        id,
        withCacheable(
          {
            tools: TOOLS.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          },
          servedAt,
        ),
      )

    case "tools/call": {
      if (isNotification) return null
      const params = req.params ?? {}
      const name = typeof params.name === "string" ? params.name : ""
      const tool = TOOLS_BY_NAME.get(name)
      if (!tool) return error(id, ERR.INVALID_PARAMS, `Unknown tool: ${name || "(none)"}`)
      const args = (params.arguments as Record<string, unknown>) ?? {}
      const toolResult = tool.handler(args, scanOpts)
      // `withResultType`, NOT `withCacheable`: upstream made the one
      // verdict-bearing result non-cacheable (`CallToolResult.required` has
      // `resultType` and no `ttlMs`), so no cache hint can stale a verdict.
      return result(id, withResultType(toolResult, servedAt))
    }

    case "resources/list":
      return result(id, withCacheable({ resources: RESOURCES }, servedAt))

    case "resources/templates/list":
      return result(id, withCacheable({ resourceTemplates: RESOURCE_TEMPLATES }, servedAt))

    case "resources/read": {
      if (isNotification) return null
      const uri = typeof req.params?.uri === "string" ? req.params.uri : ""
      const contents = readResource(uri)
      if (!contents) return error(id, ERR.INVALID_PARAMS, `Unknown resource: ${uri || "(none)"}`)
      return result(id, withCacheable({ contents }, servedAt))
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
