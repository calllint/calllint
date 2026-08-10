import { describe, expect, it } from "vitest"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"

// The M26-5 digest lock over the vendored MCP 2026-07-28 specification bytes
// (third_party/mcp-spec/2026-07-28/). This file is the "gate" half of O-M1's "lock first — a gate
// with no evidence artifact is not a gate": before it, F1-F7 in
// artifacts/mcp-2026-07-28/finality-status.json rested on a one-time manual read of live web pages,
// which no CI job could ever re-derive. INV-M4 forbids CI fetching the live spec, so the only
// re-checkable form of that evidence is committed bytes plus a digest.
//
// NOTHING HERE OPENS A SOCKET. That is the invariant, not an implementation detail: a gate that
// fetched upstream would satisfy its own assertions while violating INV-M4, and would go red on an
// upstream edit that says nothing about this repository.
//
// TWO LAYERS, because a digest alone is the weaker half of the claim:
//   1. INTEGRITY — every file matches the sha256 in SOURCE.json. Catches a CRLF checkout (the
//      `third_party/** text eol=lf` pin is real but a pin no gate reads is itself unguarded), a
//      truncated re-download, and an edit to bytes that must stay verbatim upstream copies.
//   2. CONTENT — the five specific facts the finality gates cite are asserted against the bytes.
//      Integrity alone would prove the file is unchanged while saying nothing about whether it
//      SAYS what finality-status.json claims. That is the exact gap that let F4's section names and
//      F7's source URL stay wrong through a merged batch: both were transcriptions of a web page
//      no gate could read. Layer 2 is what makes a future mis-transcription fail here.
const repoRoot = new URL("../../", import.meta.url)
const VENDOR_DIR = "third_party/mcp-spec/2026-07-28"

const readBytes = (rel: string): Buffer => readFileSync(fileURLToPath(new URL(rel, repoRoot)))
const readText = (rel: string): string => readBytes(rel).toString("utf8")

interface LockedFile {
  readonly path: string
  readonly upstreamPath: string
  readonly sha256: string
  readonly bytes: number
  readonly digestField: string
  readonly role: string
}
interface SourceLock {
  readonly schema: string
  readonly protocolRevision: string
  readonly upstream: { readonly commit: string; readonly repository: string }
  readonly files: readonly LockedFile[]
}

const lock = JSON.parse(readText(`${VENDOR_DIR}/SOURCE.json`)) as SourceLock

describe("M26-5 vendored MCP spec — integrity", () => {
  it("SOURCE.json declares the expected schema, revision, and an immutable upstream commit", () => {
    expect(lock.schema).toBe("calllint.mcp-spec-source-lock.v1")
    expect(lock.protocolRevision).toBe("2026-07-28")
    // A 40-hex commit, not a branch name. `main` would make every digest below a dated
    // coincidence rather than something a third party can reproduce.
    expect(lock.upstream.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(lock.upstream.repository).toBe("https://github.com/modelcontextprotocol/modelcontextprotocol")
  })

  it("the lock covers EVERY vendored file — enumerated from disk, not from the lock", () => {
    // Direction matters. Iterating the lock and checking each entry exists would leave a file
    // ADDED to the directory unlocked and unnoticed: the lock would stay green while an
    // unverified byte sat next to verified ones. So disk is the source of truth for the file
    // SET, and the lock is the source of truth for each file's CONTENT.
    const onDisk = readdirSync(fileURLToPath(new URL(VENDOR_DIR, repoRoot)))
      .filter((name) => name !== "SOURCE.json")
      .sort()
    const locked = lock.files.map((f) => f.path).sort()
    expect(onDisk).toEqual(locked)
    // Vacuity guard: an empty directory would make the equality above trivially true and every
    // `it.each` below a no-op. Floor, not equality — a sixth vendored file should extend the
    // covered set, never red this line.
    expect(onDisk.length).toBeGreaterThanOrEqual(5)
  })

  it("every digestField name is distinct and non-empty", () => {
    // Two files sharing a digestField would let one silently stand in for the other when a
    // reader looks a digest up by name.
    const fields = lock.files.map((f) => f.digestField)
    expect(fields.filter((f) => f.trim() === "")).toEqual([])
    expect(new Set(fields).size).toBe(fields.length)
  })

  it.each(lock.files.map((f) => [f.path, f] as const))(
    "%s matches its locked sha256 and byte count",
    (_path, file) => {
      const bytes = readBytes(`${VENDOR_DIR}/${file.path}`)
      // Byte count first: on a CRLF checkout it reports HOW MANY bytes appeared, which points
      // straight at the line-ending filter. A digest mismatch alone prints two opaque hexes.
      expect(bytes.length).toBe(file.bytes)
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256)
      expect(file.upstreamPath.length).toBeGreaterThan(0)
      expect(file.role.length).toBeGreaterThan(0)
    },
  )

  it.each(lock.files.map((f) => f.path))("%s is LF-only — the consequence of the eol pin", (path) => {
    // Asserts the CONSEQUENCE of `third_party/** text eol=lf` rather than trusting the pin, the
    // same way store-schema.test.ts does for the migrations pin. Strictly this is implied by the
    // digest above; it is separate because it NAMES the failure. A digest mismatch on a Windows
    // checkout is indistinguishable from a corrupted download until someone thinks to count \r.
    const cr = readBytes(`${VENDOR_DIR}/${path}`).filter((b) => b === 0x0d).length
    expect(cr).toBe(0)
  })
})

describe("M26-5 vendored MCP spec — the offline facts F1-F7 cite", () => {
  const schemaSource = () => readText(`${VENDOR_DIR}/schema.ts`)
  const changelog = () => readText(`${VENDOR_DIR}/changelog.snapshot.md`)
  const deprecated = () => readText(`${VENDOR_DIR}/deprecated.snapshot.md`)

  it("F1/F2 — the revision string is upstream's own, quoted from schema.ts", () => {
    // The load-bearing one. Every other artifact in this repo that names 2026-07-28 is OUR
    // transcription; this is upstream's own constant. Anchored to the declaration so a mention
    // inside a comment or a changelog line cannot satisfy it.
    expect(schemaSource()).toMatch(/^export const LATEST_PROTOCOL_VERSION = "2026-07-28";$/m)
  })

  it("F3 — schema.json is a parseable JSON Schema with a populated $defs", () => {
    const schema = JSON.parse(readText(`${VENDOR_DIR}/schema.json`)) as {
      $schema?: string
      $defs?: Record<string, unknown>
    }
    expect(typeof schema.$schema).toBe("string")
    // A floor, not the measured 155: upstream adding a definition is not a CallLint regression,
    // whereas a truncated or emptied schema is. Cf. the mirror-truncation trap — a cap set past
    // the real value disables the guard instead of tripping it.
    expect(Object.keys(schema.$defs ?? {}).length).toBeGreaterThanOrEqual(100)
  })

  it("F4 — the changelog's section headings are the MEASURED ones, not the recorded ones", () => {
    // finality-status.json recorded "Two enumerable sections exist: Key Changes and Deprecated
    // Features." Neither string appears in the bytes. That claim survived a merged batch because
    // it described a rendered web page no gate could read — precisely the failure mode this file
    // exists to end. The corrected names are pinned here so the artifact and the bytes cannot
    // drift apart again in either direction.
    const headings = changelog()
      .split("\n")
      .filter((line) => line.startsWith("## "))
      .map((line) => line.slice(3).trim())
    expect(headings).toEqual([
      "Major changes",
      "Minor changes",
      "Deprecated",
      "Other schema changes",
      "Governance and process updates",
      "Process changes",
      "Full changelog",
    ])
  })

  it("F7 — the deprecation registry lives in deprecated.mdx, with an EMPTY Removed section", () => {
    const text = deprecated()
    // Exactly two top-level sections, in this order. `## Removed` gaining rows is the event F7
    // would need to be re-judged over, so its ABSENCE of rows is the assertion, not its presence.
    const headings = text
      .split("\n")
      .filter((line) => line.startsWith("## "))
      .map((line) => line.slice(3).trim())
    expect(headings).toEqual(["Deprecated", "Removed"])

    const removed = text.slice(text.indexOf("## Removed"))
    expect(removed).toContain("No features have been removed under this policy yet.")
    // A table row in the Removed section is what "empty" forbids. Asserted structurally rather
        // than by trusting the sentence above: upstream could add a row and keep the prose.
    expect(removed.split("\n").filter((line) => /^\|/.test(line))).toEqual([])
  })

  it("F7 — the Deprecated table holds exactly 6 feature rows", () => {
    const text = deprecated()
    const table = text.slice(text.indexOf("## Deprecated"), text.indexOf("## Removed"))
    const rows = table
      .split("\n")
      .filter((line) => line.startsWith("|"))
      // Drop the header and its `| --- |` separator; what remains is one line per feature.
      .filter((line) => !/^\|[\s|:-]+\|$/.test(line))
      .slice(1)
    expect(rows).toHaveLength(6)
  })

  it("F7 — the removal clock is NOT uniformly 2027-07-28, which the recorded claim over-stated", () => {
    // finality-status.json said "the earliest possible removal is the first revision on or after
    // 2027-07-28". Measured: 4 rows read that; `includeContext` follows Sampling, and HTTP+SSE
    // reads "Three months after SEP-2596 reaches Final" — a date the registry does not record.
    //
    // Pinned as an INEQUALITY (some rows carry the date, not all) because that asymmetry is the
    // whole finding. Asserting the date on every row would encode the over-precise version of
    // the claim into the gate and make the gate agree with the error it is meant to prevent.
    const text = deprecated()
    const table = text.slice(text.indexOf("## Deprecated"), text.indexOf("## Removed"))
    const rows = table
      .split("\n")
      .filter((line) => line.startsWith("|") && !/^\|[\s|:-]+\|$/.test(line))
      .slice(1)
    const dated = rows.filter((r) => r.includes("First revision released on or after 2027-07-28"))
    expect(dated.length).toBeGreaterThanOrEqual(1)
    expect(dated.length).toBeLessThan(rows.length)
    expect(table).toContain("Three months after SEP-2596 reaches Final")
    // And the verdict's actual basis: removal is a FUTURE-revision act, so nothing in this
    // revision breaks on either clock.
    expect(text).toContain("remains part of the specification but is scheduled for")
  })

  it("does not assert MCP 2026-07-28 support — the served version is still 2024-11-05", () => {
    // A vendored spec plus a passing gate is the exact state in which someone would be tempted to
    // bump the advertised constant. new17 §19 forbids the public claim until F1-F8 pass AND a
    // batch implements the surface; M26-5 is evidence only. Pinned here, in the file that could
    // otherwise be read as permission.
    expect(readText("packages/calllint-mcp/src/server.ts")).toMatch(
      /PROTOCOL_VERSION\s*=\s*"2024-11-05"/,
    )
  })
})

// ---------------------------------------------------------------------------
// M26-1 (ADR 0063) — the two constants server.ts adopted are QUOTATIONS of the
// vendored bytes, so each is a claim about TWO files. A comment naming the
// upstream source is exactly the shape that drifts unnoticed, so both halves
// are parsed here rather than restated.
// ---------------------------------------------------------------------------

describe("M26-1 negotiation constants are quotations, not restatements", () => {
  const schemaSource = () => readText(`${VENDOR_DIR}/schema.ts`)
  const serverSource = () => readText("packages/calllint-mcp/src/server.ts")

  it("D1 — the _meta version key server.ts uses is the key upstream declares", () => {
    const KEY = "io.modelcontextprotocol/protocolVersion"
    // Upstream side: a REQUIRED field of RequestMetaObject (not optional — no `?:`).
    expect(schemaSource()).toContain(`"${KEY}": string;`)
    // Our side: the same literal, and it must be the value of the named constant.
    expect(serverSource()).toMatch(
      new RegExp(`META_PROTOCOL_VERSION_KEY\\s*=\\s*"${KEY.replace(/[./]/g, "\\$&")}"`),
    )
  })

  it("D3 — the error code server.ts uses is the code upstream assigns", () => {
    const m = /export const UNSUPPORTED_PROTOCOL_VERSION = (-?\d+);/.exec(schemaSource())
    expect(m, "upstream must still export UNSUPPORTED_PROTOCOL_VERSION").not.toBeNull()
    const upstreamCode = Number(m![1])
    expect(upstreamCode).toBe(-32022)
    expect(serverSource()).toMatch(
      new RegExp(`UNSUPPORTED_PROTOCOL_VERSION:\\s*${upstreamCode}`),
    )
    // In the MCP reserved range, so it cannot collide with a base JSON-RPC code.
    expect(upstreamCode).toBeLessThanOrEqual(-32000)
    expect(upstreamCode).toBeGreaterThanOrEqual(-32099)
  })

  it("D3 — the error DATA shape carries both fields upstream requires", () => {
    // `supported` is what the client retries with; `requested` is what it sent
    // (schema.ts:483). A bare code would say "no" without saying "try this".
    const iface = schemaSource()
    const start = iface.indexOf("export interface UnsupportedProtocolVersionError")
    expect(start).toBeGreaterThan(-1)
    const body = iface.slice(start, start + 900)
    expect(body).toContain("supported: string[];")
    expect(body).toContain("requested: string;")
    expect(serverSource()).toMatch(/data:\s*\{\s*supported:[\s\S]{0,80}requested\s*\}/)
  })

  it("the four methods REMOVED upstream are served at 2024-11-05 and refused at 2026-07-28", () => {
    // The finding that reshaped M26-1: `proposed-file-map.md` scoped it as "make
    // `initialize` compare the requested version", but 2026-07-28 deletes the
    // method outright (changelog Major #2) along with `ping` (Major #5).
    //
    // M26-4 (ADR 0066) resolved this without deleting them: they are served at
    // 2024-11-05 and unreachable at 2026-07-28. So the assertion is now THREE-sided
    // — gone upstream, present here, and gated by revision — because the middle
    // claim alone would be satisfied by a server that served them at BOTH
    // revisions, which is precisely the dishonest state the dual claim must avoid.
    const upstream = schemaSource()
    expect(upstream).not.toMatch(/nitialize/)
    expect(upstream).not.toContain('"ping"')
    expect(readText(`${VENDOR_DIR}/changelog.snapshot.md`)).toContain(
      "remove the `initialize`/`notifications/initialized` handshake",
    )
    const ours = serverSource()
    expect(ours).toContain('case "initialize":')
    expect(ours).toContain('case "ping":')
    // The guard, and its membership. All FOUR names, including the bare
    // `initialized` alias the changelog's prose does not mention — a set built from
    // that prose would leave the fourth arm reachable at a revision that deleted it.
    const set = /const REMOVED_AT_STATELESS: ReadonlySet<string> = new Set\(\[([\s\S]*?)\]\)/.exec(ours)
    const setBody = set?.[1]
    expect(setBody, "server.ts must declare REMOVED_AT_STATELESS as a literal set").toBeTypeOf("string")
    const members = [...String(setBody).matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort()
    expect(members).toEqual(["initialize", "initialized", "notifications/initialized", "ping"])
    // Every member must be an arm this file actually serves, or the guard is
    // refusing a method nobody could have called.
    for (const m of members) expect(ours).toContain(`case "${m}":`)
    expect(ours).toMatch(
      /if \(servedAt === STATELESS_PROTOCOL_VERSION && REMOVED_AT_STATELESS\.has\(req\.method\)\)/,
    )
  })

  it("2026-07-28 IS in the supported set — the claim M26-4 deliberately inverted", () => {
    // Was `not.toContain("2026-07-28")` through M26-3, so that claiming the revision
    // required editing a test that said why the omission was deliberate. M26-4
    // (ADR 0066) edited it: the claim is honest now because a request declaring the
    // revision is served wholly AT it — removed methods refused, envelope emitted.
    //
    // Both members are asserted, and their ORDER — as an advertisement that must agree
    // with the fallback, not as the fallback's mechanism. Negative control #156 measured
    // the difference: reversing this array reds three assertions but changes no served
    // revision, because `servedAt` reads `PROTOCOL_VERSION` directly (:624). A reversed
    // array would therefore be a server that serves absence as 2024-11-05 while
    // advertising the stateless revision as the leading fallback.
    const m = /SUPPORTED_PROTOCOL_VERSIONS:\s*readonly string\[\]\s*=\s*\[([^\]]*)\]/.exec(
      serverSource(),
    )
    const arrayBody = m?.[1]
    expect(arrayBody, "SUPPORTED_PROTOCOL_VERSIONS must exist and be a literal array").toBeTypeOf("string")
    const members = String(arrayBody).split(",").map((s) => s.trim()).filter(Boolean)
    expect(members).toEqual(["PROTOCOL_VERSION", "STATELESS_PROTOCOL_VERSION"])
    // Both symbols resolve to the two revisions, read off the source rather than
    // restated: a rename that pointed either at a third value would red here.
    expect(serverSource()).toMatch(/const PROTOCOL_VERSION = "2024-11-05"/)
    expect(serverSource()).toMatch(/const STATELESS_PROTOCOL_VERSION = "2026-07-28"/)
    // Non-vacuity, and the reason the claim is now correct: the revision we name is
    // upstream's own latest, read from the locked bytes.
    const rev = /export const LATEST_PROTOCOL_VERSION = "([^"]+)";/.exec(schemaSource())
    expect(rev![1]).toBe("2026-07-28")
  })

  it("server/discover IS implemented here — the assertion M26-2 deliberately inverted", () => {
    // Was `not.toContain('case "server/discover"')` through M26-1, so that adding
    // the method required editing a test that said why its absence was deliberate.
    // M26-2 (ADR 0064) edited it. Both halves are still parsed: upstream declares
    // the method, and we serve it.
    expect(schemaSource()).toContain('method: "server/discover"')
    expect(serverSource()).toContain('case "server/discover"')
  })
})

// ---------------------------------------------------------------------------
// M26-2 (ADR 0064) — `server/discover`'s field set is a QUOTATION of the locked
// `schema.json` `required` arrays, not a transcription of D4's prose row. D4 named
// two of the five required fields; the other three are inherited through
// CacheableResult → Result and were invisible in the matrix. So the gate reads the
// arrays and checks server.ts against them, rather than restating five names.
// ---------------------------------------------------------------------------

describe("M26-2 server/discover is built from upstream's required arrays", () => {
  /**
   * `server.ts` with CRLF folded to LF. This gate measures CODE SHAPE, and a
   * checkout's line-ending style is not part of that shape: `server.ts` carries no
   * `text eol=lf` pin (correctly — nothing hashes it, unlike `third_party/**`), so
   * on windows-latest it arrives CRLF. A blank-line delimiter search for `"\n\n"`
   * then never matches, `indexOf` returns -1, and every arm-scoped assertion either
   * reds on the slice or silently measures the WRONG arm — which is how the first CI
   * run reported `initialize` containing `resultType`: the -1 made the initialize
   * slice run to end-of-file and swallow the discover arm below it.
   *
   * Normalizing here rather than pinning the file keeps the claim honest in both
   * directions: the vendored bytes' CRLF IS a defect (the digest lock and a
   * dedicated `\r` count hold that), while this file's line endings are the local
   * checkout's business. Same class as M-OPEN-4's unstripped `\r` in the
   * deprecated-table row filter.
   */
  const serverSource = () => readText("packages/calllint-mcp/src/server.ts").replace(/\r\n/g, "\n")
  /**
   * `server.ts` with comments removed, for the forbidden-token scans only.
   * A scan over raw text reds on the docblock that explains the rule; every
   * caller of this asserts two-sidedly (real code still present, prose gone) so
   * a stripper that ate the file could not pass.
   */
  const serverCode = () =>
    serverSource()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")
  const schemaSource = () => readText(`${VENDOR_DIR}/schema.ts`)
  const changelog = () => readText(`${VENDOR_DIR}/changelog.snapshot.md`)
  interface Def {
    readonly required?: readonly string[]
    readonly properties?: Record<
      string,
      {
        readonly enum?: readonly string[]
        readonly minimum?: number
        /** Upstream's prose for one property. Wrapped mid-sentence — collapse whitespace before matching. */
        readonly description?: string
        /** `MissingRequiredClientCapabilityError.error` composes `Error` with its own const-pinned code. */
        readonly allOf?: readonly {
          readonly properties?: {
            readonly code?: { readonly const?: unknown }
            readonly data?: { readonly required?: readonly string[] }
          }
        }[]
      }
    >
    readonly additionalProperties?: unknown
  }
  const defs = (): Record<string, Def> =>
    (JSON.parse(readText(`${VENDOR_DIR}/schema.json`)) as { $defs: Record<string, Def> }).$defs

  /**
   * One `case` arm's body, so an assertion cannot be satisfied by a DIFFERENT method.
   *
   * Both bounds are asserted before the slice. `String.prototype.slice` treats a -1
   * end as "one before the end", so an unmatched delimiter would slice to almost the
   * whole file and QUIETLY measure every arm below the target — a false green for a
   * `not.toContain` assertion and a false red for a `toContain` one. Failing on the
   * bound is what keeps this helper's answer scoped to the arm it names.
   */
  const arm = (caseLabel: string): string => {
    const src = serverSource()
    const start = src.indexOf(`case "${caseLabel}":`)
    expect(start, `server.ts must serve \`case "${caseLabel}"\``).toBeGreaterThan(-1)
    const end = src.indexOf("\n\n", start)
    expect(end, `the ${caseLabel} arm must be a blank-line-delimited block`).toBeGreaterThan(start)
    return src.slice(start, end)
  }
  const discoverArm = (): string => arm("server/discover")

  /**
   * One arm's body with comments removed, for assertions of the form "this arm must
   * NOT mention X".
   *
   * A bare `not.toContain` over raw source cannot tell code from prose, so it reds on
   * the very comment that explains why the rule holds — which is what happened here:
   * the `tools/call` arm carries a line reading "`withResultType`, NOT
   * `withCacheable`", and the negative check tripped on it. Rephrasing the comment
   * would have made the test pass while deleting the explanation, so the scan learns
   * to read code instead. Same defect and same remedy as the forbidden-token scan
   * that red on the docblock arguing FOR its own rule.
   *
   * Only line comments are stripped — that is all `server.ts`'s arm bodies contain
   * (measured: 3 comment lines across the 10 arms, all in `tools/call`). A
   * block-comment stripper would be code written against no instance of the thing it
   * strips, so it is not written.
   *
   * The stripper is NOT guarded at each call site. An "it must have removed
   * something" check here would red on the six arms that legitimately carry no
   * comment, so the helper would only ever be usable on the arm that happened to
   * need it — leaving every other negative assertion raw and exposed to the same
   * defect. The guard lives once, non-vacuously, in "the comment stripper reads code
   * and drops prose" below.
   */
  const stripLineComments = (body: string): string =>
    body
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n")
  const codeOf = (caseLabel: string): string => stripLineComments(arm(caseLabel))

  it("every field DiscoverResult requires is emitted by the discover arm", () => {
    // The load-bearing one. Iterating upstream's array — rather than a list typed
    // here — is what makes a NEW required field at a future revision red this line
    // instead of passing a stale five-name check.
    const required = defs().DiscoverResult?.required ?? []
    expect(required.length).toBeGreaterThanOrEqual(5)
    const arm = discoverArm()
    const missing = required.filter((k) => !new RegExp(`\\b${k}\\s*:`).test(arm))
    expect(missing).toEqual([])
  })

  it("the required set is exactly what M26-2 measured — three fields D4 never named", () => {
    // Pins the measurement itself, so the finding in ADR 0064 §2 cannot quietly
    // become untrue in either direction. `resultType` arrives from Result,
    // `ttlMs`/`cacheScope` from CacheableResult — none of the three appears in D4's row.
    const d = defs()
    expect([...(d.DiscoverResult?.required ?? [])].sort()).toEqual([
      "cacheScope",
      "capabilities",
      "resultType",
      "supportedVersions",
      "ttlMs",
    ])
    expect([...(d.CacheableResult?.required ?? [])].sort()).toEqual(["cacheScope", "resultType", "ttlMs"])
    expect(d.Result?.required).toEqual(["resultType"])
  })

  it("cacheScope is one of upstream's two enum members, and ttlMs respects its minimum", () => {
    // M26-4 (ADR 0066 §3) hoisted both values into named constants, because five
    // emission sites now share them. Written against the ARM's literals, this gate
    // silently stopped measuring anything the moment they moved — the regex found
    // no literal and only `not.toBeNull()` caught it. So it reads the CONSTANTS,
    // and separately asserts the arm reaches them by name: value-correct plus
    // reachable, which the arm-literal form conflated into one check.
    const scope = defs().DiscoverResult?.properties?.cacheScope?.enum
      ?? defs().CacheableResult?.properties?.cacheScope?.enum
      ?? []
    expect([...scope].sort()).toEqual(["private", "public"])
    const src = serverSource()
    const emitted = /const CACHE_SCOPE = "([^"]+)"/.exec(src)
    expect(emitted, "server.ts must define CACHE_SCOPE as a literal").not.toBeNull()
    expect(scope).toContain(emitted![1])
    const min = defs().CacheableResult?.properties?.ttlMs?.minimum ?? 0
    const ttl = /const CACHE_TTL_MS = (\d+)/.exec(src)
    expect(ttl, "server.ts must define CACHE_TTL_MS as a literal").not.toBeNull()
    expect(Number(ttl![1])).toBeGreaterThanOrEqual(min)
    // Reachability: the constants are only an invariant if the wire uses them.
    expect(discoverArm()).toContain("ttlMs: CACHE_TTL_MS")
    expect(discoverArm()).toContain("cacheScope: CACHE_SCOPE")
  })

  it("ttlMs may go positive ONLY in the batch that advertises listChanged", () => {
    // ADR 0066 §3's decision, made checkable rather than left in prose. The two
    // facts are linked upstream, verbatim in the changelog: the cache hints
    // "complement existing `listChanged` notifications". We advertise none, so a
    // positive TTL would be a freshness promise with no channel to revoke it.
    //
    // Deliberately an IMPLICATION, not `ttlMs === 0`: a later batch that adds
    // `listChanged` may raise the TTL, and this gate lets it — while a batch that
    // raises the TTL alone reds with the reason on it. Pinning 0 outright would
    // red at exactly the moment the decision was legitimately revisited
    // ([[a-gate-that-cannot-pass-on-success]]).
    expect(changelog()).toContain("complement existing `listChanged` notifications")
    const src = serverSource()
    const ttl = Number(/const CACHE_TTL_MS = (\d+)/.exec(src)![1])
    const advertisesListChanged = /const CAPABILITIES = \{[^}]*listChanged/.test(src)
    if (ttl > 0) {
      expect(
        advertisesListChanged,
        `CACHE_TTL_MS is ${ttl} but CAPABILITIES advertises no listChanged — a freshness ` +
          `promise with no channel to revoke it (ADR 0066 §3)`,
      ).toBe(true)
    }
    // Non-vacuity: the premise must actually hold today, or the implication above
    // is unfalsifiable for the wrong reason.
    expect(advertisesListChanged).toBe(false)
    expect(ttl).toBe(0)
  })

  it("the comment stripper reads code and drops prose, on a body that has both", () => {
    // The stripper exists because a raw `not.toContain` red on the comment explaining
    // why the rule holds. Guarded here rather than at each call site: six of the ten
    // arms carry no comment at all, so a per-site "must have removed something" check
    // would red on them and confine the helper to the one arm that needed it.
    //
    // `tools/call` is the arm that has both halves, which is what makes this
    // non-vacuous — an over-stripping bug (or a stripper fed a comment-free body)
    // would make every negative assertion downstream vacuously true.
    const raw = arm("tools/call")
    const code = codeOf("tools/call")
    expect(raw, "the fixture arm must still contain the prose being stripped").toContain(
      "NOT `withCacheable`",
    )
    expect(code.length, "stripping must remove something from an arm that has comments").toBeLessThan(
      raw.length,
    )
    // Code survives: the label that scopes the arm, and the call the positive half asserts.
    expect(code).toContain('case "tools/call":')
    expect(code).toContain("withResultType(toolResult, servedAt)")
    // And a comment-free arm is passed through unchanged, so the filter is not eating code.
    expect(codeOf("resources/read")).toBe(arm("resources/read"))
  })

  it("the one verdict-bearing result is non-cacheable UPSTREAM, so no hint can stale a verdict", () => {
    // The safety-relevant half of ADR 0066 §3, and it is upstream's decision, not
    // ours: `tools/call` carries every CallLint verdict, and its required array has
    // `resultType` without the two cache hints. Measured off the locked schema, so
    // if a future revision made it cacheable this reds and the caching decision
    // gets re-made with verdict staleness actually on the table.
    const req = [...(defs().CallToolResult?.required ?? [])].sort()
    expect(req).toEqual(["content", "resultType"])
    expect(req).not.toContain("ttlMs")
    expect(req).not.toContain("cacheScope")
    // Our side matches: the arm uses the resultType-only helper, not the cacheable
    // one. The negative half reads CODE, not prose — the arm's own comment names
    // `withCacheable` to explain why it is not used, and a raw scan reds on that.
    expect(arm("tools/call")).toContain("withResultType(toolResult, servedAt)")
    expect(codeOf("tools/call")).not.toContain("withCacheable")
  })

  it("resultType's type is OPEN upstream, so no closed-set gate is possible", () => {
    // Recorded as an assertion because the natural instinct is to gate the value
    // against an enum. There is none: schema.json gives a bare string, and
    // schema.ts unions the two known literals with `string`. A gate that invented
    // a closed set would be asserting something upstream does not say.
    const rt = defs().Result?.properties?.resultType as { enum?: unknown; const?: unknown } | undefined
    expect(rt?.enum).toBeUndefined()
    expect(rt?.const).toBeUndefined()
    expect(schemaSource()).toContain('export type ResultType = "complete" | "input_required" | string;')
  })

  it("identity is in _meta as a SHOULD — the changelog's \"and identity\" is wrong", () => {
    // Two-sided: the changelog makes the claim, the schema does not carry the field,
    // and our arm does not emit it. ADR 0064 §2.1. The fourth prose claim the lock
    // has falsified, after F4, F7, and D1.
    expect(changelog()).toContain("capabilities, and identity")
    const src = schemaSource()
    const start = src.indexOf("export interface DiscoverResult")
    const body = src.slice(start, src.indexOf("}", start))
    expect(body).not.toContain("serverInfo")
    expect(body).not.toContain("Implementation")
    // Where it actually lives: optional, on the RESPONSE's _meta.
    expect(src).toContain('"io.modelcontextprotocol/serverInfo"?: Implementation;')
    expect(codeOf("server/discover")).not.toContain("serverInfo")
  })

  it("supportedVersions is the negotiation set itself, not a second literal", () => {
    // Two arrays of version strings would be two sources of truth, and the "no
    // premature claim" gate below parses only one of them — so a literal here
    // could advertise 2026-07-28 while that gate stayed green.
    expect(discoverArm()).toMatch(/supportedVersions:\s*\[\s*\.\.\.SUPPORTED_PROTOCOL_VERSIONS\s*\]/)
    expect(codeOf("server/discover")).not.toContain("2026-07-28")
  })

  it("a conformant DiscoverRequest needs params._meta with TWO required keys — BOTH now read", () => {
    // M26-6 (ADR 0067) reversed the last line of this test. Until then the
    // capabilities key was measured-but-unread (ADR 0064 §5), and this assertion
    // was the named thing a landing batch had to edit — which is what happened.
    //
    // Reading both keys is not the same as enforcing both. The consequences of
    // omitting them differ, and that asymmetry is upstream's, not ours: an
    // unsupported version is refused (-32022), while a missing capability has a
    // separate on-demand error (-32021) this server can never legitimately send.
    // See the two tests below.
    const d = defs()
    expect(d.RequestParams?.required).toEqual(["_meta"])
    expect([...(d.RequestMetaObject?.required ?? [])].sort()).toEqual([
      "io.modelcontextprotocol/clientCapabilities",
      "io.modelcontextprotocol/protocolVersion",
    ])
    expect(schemaSource()).toContain("Servers MUST NOT infer capabilities from prior requests")
    // Our side: both required keys are now read.
    expect(serverSource()).toContain("io.modelcontextprotocol/protocolVersion")
    expect(serverSource()).toContain("io.modelcontextprotocol/clientCapabilities")
  })

  it("-32021 is upstream's remedy for a missing capability, and this server must never send it", () => {
    // Derived from the locked bytes, not restated: the code and the required
    // `requiredCapabilities` field both come out of the schema. That field is
    // the reason we cannot send it — it demands the capabilities THE SERVER
    // NEEDS, and CallLint's tools read committed bytes and run deterministic
    // rules. There is nothing to name.
    const d = defs()
    const err = d.MissingRequiredClientCapabilityError
    expect(err, "the locked schema must define MissingRequiredClientCapabilityError").toBeTypeOf(
      "object",
    )
    const variants = err?.properties?.error?.allOf ?? []
    const codes = variants.map((v) => v.properties?.code?.const).filter((c) => c !== undefined)
    expect(codes, "the error's code must be pinned as a const in the schema").toEqual([-32021])
    const dataRequired = variants.flatMap((v) => [...(v.properties?.data?.required ?? [])])
    expect(dataRequired).toContain("requiredCapabilities")

    // Every capability upstream knows about is optional, so "no capabilities" is
    // a conformant client, and an empty object is a real declaration.
    //
    // Asserted as ABSENCE OF THE KEY, and only after proving the definition is
    // there. The first form of this was `expect(d.ClientCapabilities?.required ??
    // null).toBeNull()`, which is vacuous: `?? null` maps a MISSING
    // `ClientCapabilities` to `null` too, so it passed whether upstream said
    // "nothing is required" or upstream had no such definition at all —
    // `absence-makes-a-gate-skip-itself`, inside the gate whose entire job is to
    // derive rather than restate. And the ADR that shipped it said the schema
    // "has `required: null`"; measured, the key is not present in any form.
    // Asserted as SET EQUALITY over the definition's own keys, which is the one
    // form that cannot go vacuous here. A boolean `hasOwnProperty` check reads
    // `false` both when the key is absent and when the whole definition is —
    // `expect(cc !== undefined && hasOwn(cc, "required")).toBe(false)` passes on a
    // deleted definition, which is the same hole in a new coat. A missing
    // definition yields `[]` and reds against the expected list.
    const cc: Def | undefined = d.ClientCapabilities
    expect(
      Object.keys(cc ?? {}).sort(),
      "ClientCapabilities must exist and carry exactly these keys — NO `required` among them. That absence is what makes every member optional and `{}` a conformant declaration; a deleted definition reds here as `[]`",
    ).toEqual(["description", "properties", "type"])
    expect(
      Object.keys(cc?.properties ?? {}).sort(),
      "and the optional members are enumerated, so upstream adding a REQUIRED one cannot slip past the absence check above",
    ).toEqual(["elicitation", "experimental", "extensions", "roots", "sampling"])

    // Therefore: absent from our server's CODE, and asserted so a future batch
    // that starts refusing has to change this line and say why.
    //
    // Scanned with comments stripped. The first run of this gate red on the
    // docblock that ARGUES FOR the rule — the same trap as
    // `source-scan-must-read-code-not-prose`: a forbidden-token scan over raw
    // text cannot tell a violation from an explanation. The stripper is guarded
    // two-sidedly below so it cannot pass by deleting everything.
    const code = serverCode()
    expect(code, "the stripper must leave real code behind").toContain("readClientCapabilities")
    expect(code, "the stripper must remove docblock prose").not.toContain("on-demand refusal")
    expect(code).not.toContain("32021")
  })

  it("the capabilities reader is request-scoped — MUST NOT infer from prior requests", () => {
    // #165 in the plan predicted this property had no guard on OUR side: `:583`
    // only asserts upstream SAYS it. This asserts our implementation obeys it.
    //
    // The observable form of "does not infer from prior requests" is that the
    // value is never stored: the reader takes `req` and returns, and no
    // module-scope binding holds its result.
    const src = serverSource()
    expect(src).toMatch(/export function readClientCapabilities\(req: JsonRpcRequest\)/)
    // No module-scope (column-0) binding is ever assigned from the reader.
    expect(src).not.toMatch(/^(?:const|let|var)\s+\w+\s*=\s*readClientCapabilities/m)
    // And the one call site passes the live request rather than anything retained.
    expect(src).toContain("void readClientCapabilities(req)")
    // The three assertions above were measured INSUFFICIENT while this batch was
    // being written. Control #165b declared `let lastCaps` with a neutral
    // initializer at module scope and assigned it INSIDE the handler:
    //
    //   let lastCaps: DeclaredClientCapabilities = { declared: false, capabilities: null }
    //   ...
    //   void readClientCapabilities(req)                       // literal preserved
    //   if (readClientCapabilities(req).declared) lastCaps = readClientCapabilities(req)
    //
    // That is a working cache, and all three passed it: the regex above matches a
    // declaration INITIALIZED from the reader, not an assignment to one declared
    // earlier, and the `void` literal was still present verbatim. A cache is the
    // conformance bug no behavioural test can see (it returns a plausible value),
    // so the gate cannot afford a hole this shape. What the mutation could not fake
    // is arity: it needed FOUR mentions of the reader where the honest form has
    // exactly TWO — the declaration and the single discarded call.
    const mentions = [...serverCode().matchAll(/readClientCapabilities\(/g)].length
    expect(
      mentions,
      "exactly two mentions in stripped code — the declaration and the one `void` call site; a retained value needs a third to read it back",
    ).toBe(2)
  })

  it("clientInfo is self-reported, so it must not reach a verdict path", () => {
    // Upstream's own words, and a hard constraint for a verdict engine: product
    // principles 3-5 forbid deciding on unverified input. Currently zero reads,
    // so this gate is written while it is cheap — it guards a property that is
    // true today and has nothing else stopping it from changing.
    // Read from the PARSED description with whitespace collapsed. Upstream wraps
    // this sentence mid-phrase, and the wrap survives in both vendored forms —
    // as a docblock line break in `schema.ts` and as an escaped `\n` inside the
    // JSON string. Two drafts of this gate red on that alone, against each file
    // in turn: the claim was right both times, the probe was matching a line
    // that upstream never wrote as one line.
    const clientInfoDoc = String(
      defs().RequestMetaObject?.properties?.["io.modelcontextprotocol/clientInfo"]?.description ??
        "",
    ).replace(/\s+/g, " ")
    expect(clientInfoDoc).toContain("SHOULD NOT rely on it for security decisions")
    const code = serverCode()
    expect(code, "the stripper must leave real code behind").toContain("readClientCapabilities")
    // Message spelled out because the bare form prints the whole stripped source and
    // names nothing — measured under control #166, which reads clientInfo in the
    // handler and produced `expected '\n\n\n\nimport ty...' not to contain 'clientInfo'`.
    expect(
      code.includes("clientInfo"),
      "server.ts reads io.modelcontextprotocol/clientInfo — upstream: SHOULD NOT rely on it for security decisions, and a verdict engine has no other kind of decision. If a batch needs this, it argues here first.",
    ).toBe(false)
  })

  it("resultType is emitted CONDITIONALLY — never unconditionally on a shared arm", () => {
    // ADR 0064 §4 forbade `resultType` on the other results; M26-4 (ADR 0066 §4)
    // supersedes that with the narrower rule the revision actually requires: the
    // field is owed at 2026-07-28 and must be absent at 2024-11-05, so on any arm
    // serving BOTH it can only appear behind the version branch.
    //
    // Asserted structurally, not by absence: the five shared arms must reach the
    // field through a helper that takes `servedAt`. A bare `resultType:` literal on
    // one of them would add a field to every 2024-11-05 client's results — exactly
    // what the old assertion protected against, now stated in a form that survives
    // the revision being claimed.
    for (const label of ["tools/list", "tools/call", "resources/list", "resources/templates/list", "resources/read"]) {
      expect(codeOf(label), `the ${label} arm must not emit a bare resultType literal`).not.toMatch(
        /resultType:\s*"/,
      )
      expect(arm(label), `the ${label} arm must shape its result by servedAt`).toMatch(
        /with(ResultType|Cacheable)\([\s\S]*servedAt/,
      )
    }
    // `initialize` is the one arm that must NEVER carry it: it is unreachable at the
    // revision that would require it, so a `resultType` there would be owed to
    // nobody. This is the surviving half of the old assertion.
    expect(codeOf("initialize")).not.toContain("resultType")
    // Non-vacuity, both ways. The discover arm carries it UNCONDITIONALLY (ADR 0066
    // §4 — the method exists only at the new revision), and the two helpers gate on
    // the version symbol rather than on something incidental.
    expect(discoverArm()).toContain("resultType: RESULT_TYPE_COMPLETE")
    const src = serverSource()
    for (const helper of ["withResultType", "withCacheable"]) {
      const start = src.indexOf(`function ${helper}`)
      expect(start, `server.ts must define ${helper}`).toBeGreaterThan(-1)
      const body = src.slice(start, src.indexOf("\n}", start))
      expect(body, `${helper} must branch on STATELESS_PROTOCOL_VERSION`).toContain(
        "STATELESS_PROTOCOL_VERSION",
      )
    }
  })

  it("an undeclared request resolves to the OLD revision, not the newest supported", () => {
    // The single most dangerous way dual-version serving could go wrong: reading
    // absence as "newest" would move every existing client — none of which sends
    // `_meta`, because 2024-11-05 has no such field — onto the stateless shapes
    // without any of them asking. Pinned at the source because the wire tests
    // exercise it per-method, and this states the rule once, where it is decided.
    expect(serverSource()).toMatch(/const servedAt = requested \?\? PROTOCOL_VERSION/)
  })

  it("upstream's examples/ is NOT vendored, so example payloads are ungated", () => {
    // ADR 0064 §6 records this bound rather than leaving a reader to assume the
    // `{@includeCode}` payloads were checked. If a later batch vendors them, the
    // `>= 5` floor lets the covered set grow without reding.
    expect(schemaSource()).toContain("{@includeCode ./examples/DiscoverRequest/")
    expect(lock.files.map((f) => f.path)).not.toContain("examples")
  })
})
