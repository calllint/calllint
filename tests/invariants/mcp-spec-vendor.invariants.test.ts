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

  it("initialize and ping are REMOVED upstream — recorded, and deliberately still served here", () => {
    // The finding that reshaped M26-1: `proposed-file-map.md` scoped it as "make
    // `initialize` compare the requested version", but 2026-07-28 deletes the
    // method outright (changelog Major #2) along with `ping` (Major #5). This
    // batch keeps both, because REMOVING them is a public-surface change that
    // needs `server/discover` (MUST implement, owned by M26-2) to replace them.
    // Asserted two-sidedly so neither half can drift: gone upstream, present here.
    const upstream = schemaSource()
    expect(upstream).not.toMatch(/nitialize/)
    expect(upstream).not.toContain('"ping"')
    expect(readText(`${VENDOR_DIR}/changelog.snapshot.md`)).toContain(
      "remove the `initialize`/`notifications/initialized` handshake",
    )
    const ours = serverSource()
    expect(ours).toContain('case "initialize":')
    expect(ours).toContain('case "ping":')
  })

  it("2026-07-28 is absent from the supported set — the omission is gated, not pending", () => {
    // The single line that separates "negotiation implemented" from "revision
    // claimed". Adding the revision here without M26-2's `server/discover`
    // would advertise support for a surface that does not exist.
    const m = /SUPPORTED_PROTOCOL_VERSIONS:\s*readonly string\[\]\s*=\s*\[([^\]]*)\]/.exec(
      serverSource(),
    )
    expect(m, "SUPPORTED_PROTOCOL_VERSIONS must exist and be a literal array").not.toBeNull()
    expect(m![1]).not.toContain("2026-07-28")
    expect(m![1]).toContain("PROTOCOL_VERSION")
    // Non-vacuity: read upstream's own revision string, so this assertion cannot
    // be satisfied by the revision simply never having been vendored.
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
  const schemaSource = () => readText(`${VENDOR_DIR}/schema.ts`)
  const changelog = () => readText(`${VENDOR_DIR}/changelog.snapshot.md`)
  interface Def {
    readonly required?: readonly string[]
    readonly properties?: Record<string, { readonly enum?: readonly string[]; readonly minimum?: number }>
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
    const scope = defs().DiscoverResult?.properties?.cacheScope?.enum
      ?? defs().CacheableResult?.properties?.cacheScope?.enum
      ?? []
    expect([...scope].sort()).toEqual(["private", "public"])
    const arm = discoverArm()
    const emitted = /cacheScope:\s*"([^"]+)"/.exec(arm)
    expect(emitted, "the arm must emit a literal cacheScope").not.toBeNull()
    expect(scope).toContain(emitted![1])
    const min = defs().CacheableResult?.properties?.ttlMs?.minimum ?? 0
    const ttl = /ttlMs:\s*(\d+)/.exec(arm)
    expect(ttl, "the arm must emit a literal ttlMs").not.toBeNull()
    expect(Number(ttl![1])).toBeGreaterThanOrEqual(min)
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
    expect(discoverArm()).not.toContain("serverInfo")
  })

  it("supportedVersions is the negotiation set itself, not a second literal", () => {
    // Two arrays of version strings would be two sources of truth, and the "no
    // premature claim" gate below parses only one of them — so a literal here
    // could advertise 2026-07-28 while that gate stayed green.
    expect(discoverArm()).toMatch(/supportedVersions:\s*\[\s*\.\.\.SUPPORTED_PROTOCOL_VERSIONS\s*\]/)
    expect(discoverArm()).not.toContain("2026-07-28")
  })

  it("a conformant DiscoverRequest needs params._meta with TWO required keys", () => {
    // Measured, and unread by this server on purpose (ADR 0064 §5). Pinned because
    // "we implement server/discover" would otherwise read as "we handle its params".
    const d = defs()
    expect(d.RequestParams?.required).toEqual(["_meta"])
    expect([...(d.RequestMetaObject?.required ?? [])].sort()).toEqual([
      "io.modelcontextprotocol/clientCapabilities",
      "io.modelcontextprotocol/protocolVersion",
    ])
    expect(schemaSource()).toContain("Servers MUST NOT infer capabilities from prior requests")
    // Our side: the version key is read, the capabilities key is not.
    expect(serverSource()).toContain("io.modelcontextprotocol/protocolVersion")
    expect(serverSource()).not.toContain("io.modelcontextprotocol/clientCapabilities")
  })

  it("resultType is NOT added to the other results — 2024-11-05 defines its absence", () => {
    // ADR 0064 §4. The `initialize` arm is the witness: if a batch adopts the
    // revision it must add `resultType` there, and this assertion is what makes
    // that a deliberate edit rather than a silent byte change for every client.
    expect(arm("initialize")).not.toContain("resultType")
    // Non-vacuity: the discover arm DOES carry it, so this is a measured asymmetry
    // rather than the token simply never appearing in the file.
    expect(discoverArm()).toContain("resultType")
  })

  it("upstream's examples/ is NOT vendored, so example payloads are ungated", () => {
    // ADR 0064 §6 records this bound rather than leaving a reader to assume the
    // `{@includeCode}` payloads were checked. If a later batch vendors them, the
    // `>= 5` floor lets the covered set grow without reding.
    expect(schemaSource()).toContain("{@includeCode ./examples/DiscoverRequest/")
    expect(lock.files.map((f) => f.path)).not.toContain("examples")
  })
})
