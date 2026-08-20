import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
// The real plane evaluator, not a re-implementation. It strips comments before walking rules, so
// these assertions are about DECLARATIONS a browser would apply rather than about text that
// happens to appear in the file — the distinction that a plain `grep` cannot make and that cost
// this batch one red gate when a prose mention of an at-rule name tripped a regex-based check.
import { resolveDeclarations } from "@calllint/trust-index"

// Why this file exists.
//
// A responsive sweep of all 245 served pages found every one of the 99 install pages scrolling
// sideways at every viewport below 280px, and the cause was a CLASS, not an incident: a grid track
// whose minimum is a fixed pixel length. `repeat(auto-fit, minmax(220px, 1fr))` stops shrinking at
// 220px, so once the container is narrower than that the track — and with it the page — stops
// fitting. Measured on a 240px viewport (225px real, 185px of content): page width pinned at 259px
// regardless of content, on all 99 pages.
//
// The class had already been fixed SEVEN times by hand in two stylesheets. Nothing forbade the
// eighth, which is the only reason there was a seventh. That is what this file is for: the fix is
// a `min()` wrapper, and the invariant is that no `auto-fit` track may carry a bare pixel floor
// again. Writing this test immediately surfaced one instance the by-hand pass had missed.
//
// WHAT THIS FILE DOES NOT CLAIM — stated because a guard that is trusted for more than it measures
// is worse than no guard:
//   * It is NOT responsive QA. It opens no browser, renders nothing, and measures no width. It
//     asserts the presence of two specific CSS constructs and the absence of one.
//   * It therefore cannot catch a NEW blowout mechanism — a fixed `width`, a `white-space: nowrap`,
//     a `min-width` floor, or a long unbreakable token in a new element outside `main`. Those are
//     found by rendering, and rendering is not what this file does.
//   * `.hero-inner`'s `minmax(120px, 180px) 1fr` is deliberately NOT covered. It is an explicit
//     two-track grid, not `auto-fit`, and it measured clean at 240px on the page that uses it.
//     Forbidding it would forbid a construct with no measured defect.
const repoRoot = new URL("../../", import.meta.url)
const read = (path: string): string => readFileSync(new URL(path, repoRoot), "utf8")

const MARKETING = "apps/web/public/styles.css"
const PLANE_SOURCE = "apps/web/styles/tokens.css"
const PLANE_SERVED = "apps/web/public/styles/tokens.css"

/** The defect shape: an `auto-fit`/`auto-fill` track whose minimum is a bare pixel length. */
const BARE_AUTOFIT_FLOOR = /repeat\(\s*auto-fi(?:t|ll)\s*,\s*minmax\(\s*\d/g
/** The fixed shape: the same track with its floor wrapped so it can collapse below itself. */
const GUARDED_AUTOFIT_FLOOR = /repeat\(\s*auto-fi(?:t|ll)\s*,\s*minmax\(\s*min\(/g

const count = (css: string, re: RegExp): number => (css.match(re) ?? []).length

describe("responsive width floors — the fixed-track class stays closed", () => {
  // LAYER 1 — the class itself, in both served stylesheets.
  //
  // The non-vacuity assertion is not ceremony. This whole layer is a regex over text, so a
  // renamed property, a reformatted declaration, or a file moved out from under this path would
  // make the "zero bare floors" assertion pass by scanning nothing. Pinning a FLOOR on the number
  // of guarded tracks means the scan has to still be finding its subject to report clean.
  for (const [path, minGuarded] of [
    [MARKETING, 6],
    [PLANE_SOURCE, 1],
    [PLANE_SERVED, 1],
  ] as const) {
    it(`${path} declares no auto-fit track with a bare pixel floor`, () => {
      const css = read(path)
      const bare = css.match(BARE_AUTOFIT_FLOOR) ?? []
      expect(bare, `bare fixed-floor auto-fit tracks in ${path}: ${bare.join(", ")}`).toEqual([])
      expect(
        count(css, GUARDED_AUTOFIT_FLOOR),
        `non-vacuity: ${path} should still hold >= ${minGuarded} min()-wrapped auto-fit tracks, ` +
          `otherwise the check above passed without examining anything`,
      ).toBeGreaterThanOrEqual(minGuarded)
    })
  }

  // LAYER 2 — the wrap policy that removes the OTHER floor.
  //
  // A fixed track is one way to set a minimum on page width; an unbreakable token is the other,
  // and on this surface it is the common one — a registry name, an obligation key, a digest. At a
  // 305px viewport the widest served name measured 577px and made the page 597px wide. Only
  // `anywhere` participates in min-content sizing, so only `anywhere` removes that floor;
  // `break-word` measured as no change on the install plane.
  it(`${PLANE_SOURCE} keeps the min-content-breaking wrap policy on \`main\``, () => {
    const rules = resolveDeclarations(read(PLANE_SOURCE), [])
    const main = rules.filter((r) => r.selector === "main")
    expect(main.length, "expected exactly one `main` rule in the token plane").toBe(1)
    expect(main[0]?.declarations).toContain("overflow-wrap: anywhere")
  })

  it(`${MARKETING} keeps a wrap policy on \`body\``, () => {
    // Text-scoped, not evaluated: this sheet has media blocks, and the plane evaluator is a flat
    // rule walk with no nesting support — running it here would mis-parse rather than measure.
    const body = /(^|\n)body\s*\{([^}]*)\}/.exec(read(MARKETING))
    expect(body, `no top-level \`body\` rule found in ${MARKETING}`).not.toBeNull()
    expect(body?.[2] ?? "").toMatch(/overflow-wrap:\s*(anywhere|break-word)/)
  })

  // LAYER 3 — the two rules that opt back OUT, and why breaking them is a safety regression.
  //
  // Everything on an install page may break to fit; a command a human is asked to copy and run may
  // not. Under the `main` net the full command re-fractured — a 531px digest run was chopped into
  // 224/224/142, and `--contract` had already been seen splitting as `- -contract`. A command that
  // cannot be read cannot be checked before it is run, so these two declarations are load-bearing
  // rather than defensive symmetry, and a future tidy-up that deletes them as redundant reds here
  // by name instead of shipping a mis-copyable command.
  it(`${PLANE_SOURCE} keeps both command rules opted out of the wrap net`, () => {
    const rules = resolveDeclarations(read(PLANE_SOURCE), [])
    for (const selector of [".install-fallback code", ".install-command-full code"]) {
      const rule = rules.filter((r) => r.selector === selector)
      expect(rule.length, `expected exactly one \`${selector}\` rule`).toBe(1)
      expect(rule[0]?.declarations, `\`${selector}\` must not inherit the breaking policy`).toContain(
        "overflow-wrap: normal",
      )
    }
  })
})
