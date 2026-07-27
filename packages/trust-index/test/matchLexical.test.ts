/**
 * The deterministic lexical matcher (ADR 0055 §4/§5): the single source of truth shared by
 * the server-side `matchLexical` and the browser script the lookup page inlines. These cases
 * pin THREE things:
 *
 *   1. Determinism + correct tiering (exact → prefix → substring, alphabetical within a tier).
 *   2. It orders only — it carries each entry through verbatim and computes NO verdict/score.
 *   3. The typed function and the `LEXICAL_MATCH_BROWSER_JS` text agree on every query — so the
 *      "one ranker, no second implementation" invariant (Product Principle 4/5) is mechanical,
 *      not a promise. If someone edits one form and not the other, this fails.
 *
 * Pure: no I/O, no clock, no network.
 */
import { describe, it, expect } from "vitest"
import { matchLexical, LEXICAL_MATCH_BROWSER_JS, type LexicalNamed } from "../src/matchLexical.js"

interface Row extends LexicalNamed {
  canonicalName: string
  verdict: string
}

const ROWS: Row[] = [
  { canonicalName: "mcp-registry/io.github.time", verdict: "SAFE" },
  { canonicalName: "mcp-registry/io.github.timezone", verdict: "REVIEW" },
  { canonicalName: "mcp-registry/io.github.filesystem", verdict: "BLOCK" },
  { canonicalName: "time", verdict: "UNKNOWN" },
]

/**
 * Reconstruct the browser `match(query)` from the SHARED source text, closing over `entries`
 * exactly as `LOOKUP_SCRIPT` does. This executes the very string the page ships, so a drift
 * between it and `matchLexical` is caught here rather than in production.
 */
function browserMatch(entries: readonly Row[], query: string): Row[] {
  // eslint-disable-next-line no-new-func -- exercises the SHIPPED browser text, not user input.
  const factory = new Function(
    "entries",
    "query",
    `${LEXICAL_MATCH_BROWSER_JS}\n  return match(query);`,
  ) as (e: readonly Row[], q: string) => Row[]
  return factory(entries, query)
}

const QUERIES = ["", "  ", "time", "TIME", "io.github", "mcp-registry/", "zone", "filesys", "nomatch", "e"]

describe("matchLexical — determinism and tiering", () => {
  it("blank query returns every entry sorted by name", () => {
    const out = matchLexical(ROWS, "")
    expect(out.map((r) => r.canonicalName)).toEqual([
      "mcp-registry/io.github.filesystem",
      "mcp-registry/io.github.time",
      "mcp-registry/io.github.timezone",
      "time",
    ])
  })

  it("exact match ranks before prefix ranks before substring", () => {
    // "time": exact "time" (tier 0) first; then names CONTAINING time (tier 2), alphabetical.
    const out = matchLexical(ROWS, "time").map((r) => r.canonicalName)
    expect(out[0]).toBe("time")
    expect(out).toEqual([
      "time",
      "mcp-registry/io.github.time",
      "mcp-registry/io.github.timezone",
    ])
  })

  it("is case-insensitive and deterministic across repeated calls", () => {
    const a = matchLexical(ROWS, "TIME")
    const b = matchLexical(ROWS, "time")
    expect(a).toEqual(b)
    expect(matchLexical(ROWS, "io.github")).toEqual(matchLexical(ROWS, "io.github"))
  })

  it("does not mutate the input array", () => {
    const copy = [...ROWS]
    matchLexical(ROWS, "time")
    expect(ROWS).toEqual(copy)
  })

  it("carries each entry through verbatim — orders only, computes no verdict/score", () => {
    for (const r of matchLexical(ROWS, "time")) {
      const original = ROWS.find((x) => x.canonicalName === r.canonicalName)!
      expect(r).toBe(original) // same object reference — nothing recomputed or copied
      expect(r.verdict).toBe(original.verdict)
    }
  })

  it("an unmatched query returns nothing", () => {
    expect(matchLexical(ROWS, "nomatch")).toEqual([])
  })
})

describe("one ranker: the browser script text agrees with matchLexical on every query", () => {
  for (const q of QUERIES) {
    it(`query ${JSON.stringify(q)} → identical order`, () => {
      const fromFn = matchLexical(ROWS, q).map((r) => r.canonicalName)
      const fromBrowser = browserMatch(ROWS, q).map((r) => r.canonicalName)
      expect(fromBrowser).toEqual(fromFn)
    })
  }
})
