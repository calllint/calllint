/**
 * S-2 — the freshness refresh script's served plane, and the cross-plane agreement that keeps
 * two independent implementations of one label from drifting apart.
 *
 * This suite exists because S-2 introduces the project's second computation of the same
 * display value: `freshness.ts` computes it at bake time into `index.json`, and
 * `trust-freshness.js` recomputes it in the browser so a human sees a current age. Two
 * planes computing one label is a real hazard — a page reading "AGING" in its JSON and
 * "stale" in its body has no single source of truth to appeal to — so the agreement is
 * ASSERTED on the literals, not trusted to review.
 *
 * The served-asset claims follow the shipped `install-copy.js` pattern verbatim (source
 * exists, served exists, byte-identical, the emitted `src` matches the constant), because a
 * reference in HTML is not a file: all 38 pages point at this path, and a missing served copy
 * is a 404 that every HTML-side assertion still reads as satisfied.
 */
import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { TRUST_FRESHNESS_SCRIPT_SRC, renderHtml } from "../src/renderPage.js"
import { CADENCE_DAYS, AGING_MULTIPLE } from "../src/freshness.js"
import { FIXTURE_OBSERVED_AT } from "../src/cohort.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const SOURCE = path.join(repoRoot, "apps", "web", "scripts", "trust-freshness.js")
const SERVED = path.join(repoRoot, "apps", "web", "public", "scripts", "trust-freshness.js")
const TRUST_TREE = path.join(repoRoot, "apps", "web", "public", "trust")

/** The served JS, comment-stripped. A source scan must read CODE, not prose: this file's own
 *  docblock names `fetch` and `navigate` while ARGUING AGAINST them, so an unstripped scan
 *  would go red on the very text that documents the rule. */
function codeOf(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
}

describe("the freshness script's served plane", () => {
  it("exists on both sides and is byte-identical", () => {
    expect(fs.existsSync(SOURCE)).toBe(true)
    expect(fs.existsSync(SERVED)).toBe(true)
    expect(fs.readFileSync(SERVED, "utf8")).toBe(fs.readFileSync(SOURCE, "utf8"))
  })

  it("is the path the renderer actually emits, derived rather than restated", () => {
    expect(path.posix.join("/", "scripts", "trust-freshness.js")).toBe(TRUST_FRESHNESS_SCRIPT_SRC)
  })

  it("is referenced by every served Trust Page, external and deferred", () => {
    const pages = fs
      .readdirSync(TRUST_TREE, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".html") && !f.endsWith("lookup.html") && !f.endsWith("app-created.html"))
      .map((f) => path.join(TRUST_TREE, f))
    // Non-vacuity floor first: an empty page list would make the tally below trivially green.
    expect(pages.length).toBeGreaterThan(20)
    const missing = pages
      .filter((p) => !/<script src="\/scripts\/trust-freshness\.js" defer><\/script>/.test(fs.readFileSync(p, "utf8")))
      .map((p) => path.relative(TRUST_TREE, p))
    expect(missing).toEqual([])
  })

  it("carries the `data-freshness` hook on the observation time, and only there", () => {
    const html = fs.readFileSync(path.join(TRUST_TREE, "mcp-registry", "ai.agenticshelf-mcp.html"), "utf8")
    const hooks = [...html.matchAll(/<time[^>]*data-freshness[^>]*>/g)].map((m) => m[0])
    expect(hooks.length).toBe(1)
    // The instant must remain machine-readable in the markup — the script rewrites the TEXT,
    // never the `datetime` attribute, and SEO/JSON-LD read the attribute.
    expect(hooks[0]).toMatch(/datetime="\d{4}-\d\d-\d\dT[^"]+"/)
  })

  it("rewrites nothing but a `data-freshness` element (the whole licence, as code)", () => {
    const js = codeOf(SERVED)
    // Its one permitted write target, and its one permitted read.
    expect(js).toMatch(/querySelectorAll\("time\[data-freshness\]\[datetime\]"\)/)
    expect(js).toMatch(/getAttribute\("datetime"\)/)
    // Forbidden, enumerated as a closed set rather than described. Same list the copy-assist
    // guard uses, plus storage — this script has no reason to persist anything.
    const forbidden: readonly [RegExp, string][] = [
      [/\bfetch\s*\(/, "fetch"],
      [/XMLHttpRequest/, "XMLHttpRequest"],
      [/\beval\s*\(/, "eval"],
      [/new\s+Function\s*\(/, "new Function"],
      [/location\s*=/, "location assignment"],
      [/\.href\s*=/, "href assignment"],
      [/import\s*\(/, "dynamic import"],
      [/localStorage|sessionStorage|document\.cookie/, "storage"],
    ]
    const violations = forbidden.filter(([re]) => re.test(js)).map(([, name]) => name)
    expect(violations).toEqual([])
    // POSITIVE CONTROL on the stripper: it must not be so aggressive that it erases real code.
    // Measured both ways — the docblock's own mention of `fetch` is gone, the code is intact.
    expect(js).not.toMatch(/must never decide/)
    expect(js.length).toBeGreaterThan(400)
  })

  it("never displays, derives, or alters a verdict — freshness is not a safety signal", () => {
    const js = codeOf(SERVED)
    // ADR 0053 §5 / 0061 §4. The strings a verdict would have to travel as simply do not occur.
    const verdictTokens = ["verdict", "BLOCK", "SAFE", "REVIEW", "UNKNOWN", "computeVerdict", "score"]
    const found = verdictTokens.filter((t) => js.includes(t))
    expect(found).toEqual([])
  })
})

describe("cross-plane agreement — the two implementations cannot drift", () => {
  const js = codeOf(SERVED)

  it("mirrors the cadence and the aging multiple from the TypeScript constants", () => {
    // Read out of the JS and compared to the imported TS values, so changing either side alone
    // reds this test. A comment claiming they match would not.
    const cadence = js.match(/CADENCE_DAYS\s*=\s*(\d+)/)
    const multiple = js.match(/AGING_MULTIPLE\s*=\s*(\d+)/)
    expect(cadence?.[1], "the served JS must declare CADENCE_DAYS").toBeDefined()
    expect(multiple?.[1], "the served JS must declare AGING_MULTIPLE").toBeDefined()
    expect(Number(cadence?.[1])).toBe(CADENCE_DAYS)
    expect(Number(multiple?.[1])).toBe(AGING_MULTIPLE)
  })

  it("mirrors the fixture anchor exactly, so a fixture is never aged in either plane", () => {
    expect(js).toContain(FIXTURE_OBSERVED_AT)
  })

  it("uses the same day divisor, the one place a unit error would silently rescale every age", () => {
    expect(js).toMatch(/MS_PER_DAY\s*=\s*86400000/)
  })

  it("applies the same inclusive-low boundary shape as `computeFreshness`", () => {
    // `<=` on both thresholds. A `<` on either would move the classification of an entry that
    // sits exactly on a cadence boundary — the case the TS suite pins explicitly.
    expect(js).toMatch(/ageDays\s*<=\s*CADENCE_DAYS\)\s*return\s*"FRESH"/)
    expect(js).toMatch(/ageDays\s*<=\s*CADENCE_DAYS\s*\*\s*AGING_MULTIPLE\)\s*return\s*"AGING"/)
  })
})

describe("the renderer emits the hook and the script together", () => {
  it("both appear in freshly rendered HTML, not merely in the committed copy", () => {
    // Committed bytes could be stale relative to the renderer; this reads the function's output.
    const page = JSON.parse(
      fs.readFileSync(path.join(TRUST_TREE, "mcp-registry", "ai.agenticshelf-mcp.json"), "utf8"),
    ) as Parameters<typeof renderHtml>[0]
    const html = renderHtml(page)
    expect(html).toContain(`<script src="${TRUST_FRESHNESS_SCRIPT_SRC}" defer></script>`)
    expect(html).toMatch(/<time datetime="[^"]+" data-freshness>/)
  })
})
