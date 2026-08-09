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
