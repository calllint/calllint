/**
 * Anti-drift: the committed Trust-lookup projection bundled into the MCP server
 * (`src/data/lookup-index.json`) MUST stay byte-identical to the baked, served
 * `apps/web/public/trust/lookup-index.json` (ADR 0055 §4/§5). This is the package-boundary
 * form of the trust-index "a lookup entry can never exist without a baked index entry"
 * invariant: the search tool may surface only what the site already publishes, verbatim.
 *
 * If the bake moves (a new resource, a re-observed verdict), this fails until the bundled
 * copy is refreshed — so the published bundle can never quietly serve a stale verdict.
 * Pure: reads two committed files, no clock, no network.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { COMMITTED_LOOKUP_ENTRIES } from "../src/committedLookup.js"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..", "..")
const BAKED = join(repoRoot, "apps", "web", "public", "trust", "lookup-index.json")
const BUNDLED = join(here, "..", "src", "data", "lookup-index.json")

describe("committed lookup projection — anti-drift vs the baked served index", () => {
  it("the bundled copy is byte-identical to the baked lookup-index.json", () => {
    const baked = readFileSync(BAKED, "utf8")
    const bundled = readFileSync(BUNDLED, "utf8")
    expect(bundled).toBe(baked)
  })

  it("the imported entries equal the baked entries verbatim (same order, same fields)", () => {
    const baked = JSON.parse(readFileSync(BAKED, "utf8")) as {
      entries: (typeof COMMITTED_LOOKUP_ENTRIES)[number][]
    }
    expect(COMMITTED_LOOKUP_ENTRIES).toEqual(baked.entries)
  })

  it("carries only the shipped, boundary-safe projection — no score, no free-text", () => {
    for (const e of COMMITTED_LOOKUP_ENTRIES) {
      expect(Object.keys(e).sort()).toEqual(
        ["artifactDigest", "canonicalName", "observedAt", "url", "verdict", "verdictLabel"].sort(),
      )
      expect(e.url).toBe(`/trust/${e.canonicalName}`)
      expect(e.artifactDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    }
  })
})
