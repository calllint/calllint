/**
 * I1a acceptance tests (ADR 0046 §4, ADR 0038 §2/§5).
 *
 * The load-bearing property is REPRODUCIBILITY: same fixture + same pinned
 * timestamps + same engine ⇒ byte-identical baked page. Plus the boundary checks:
 * the baked verdict is the engine's verdict verbatim (never re-scored), parse errors
 * are surfaced honestly, and no rendered page uses forbidden "certified/verified
 * safe" language.
 */
import { describe, it, expect } from "vitest"
import {
  bakeTrustPage,
  fixtureCohort,
  renderHtml,
  renderSidecar,
  ConfigParseError,
  type BakeInput,
} from "../src/index.js"

const cohort = fixtureCohort()
const parseErrorCases = cohort.filter((e) => e.case.expect === "parse-error")
const verdictCases = cohort.filter((e) => e.case.expect !== "parse-error")

// Forbidden by ADR 0038 §2 — a Trust Page never *asserts* a safety guarantee or a
// third-party endorsement. These are the affirmative overclaims; matched
// case-insensitively over the rendered output. (A disclaimer that *denies* a
// guarantee — "not a guarantee of safety" — is correct copy and is checked for
// separately below, so we do not blanket-ban the word "guarantee".)
const FORBIDDEN = [
  "certified safe",
  "verified safe",
  "calllint approved",
  "calllint-approved",
  "guaranteed safe",
]

describe("fixtureCohort", () => {
  it("is non-empty and deterministically ordered by file name", () => {
    expect(cohort.length).toBeGreaterThan(0)
    const files = cohort.map((e) => e.case.file)
    expect(files).toEqual([...files].sort())
  })

  it("covers every verdict plus a parse error (the safety floor)", () => {
    const verdicts = new Set(verdictCases.map((e) => e.case.expect))
    expect(verdicts).toContain("SAFE")
    expect(verdicts).toContain("REVIEW")
    expect(verdicts).toContain("BLOCK")
    expect(verdicts).toContain("UNKNOWN")
    expect(parseErrorCases.length).toBeGreaterThan(0)
  })
})

describe("bakeTrustPage — verdict fidelity (never re-scored)", () => {
  for (const entry of verdictCases) {
    it(`bakes ${entry.case.file} with the fixture's expected verdict ${entry.case.expect}`, () => {
      const page = bakeTrustPage(entry.input)
      // The baked verdict is the engine verdict verbatim — the golden expectation
      // is the ADR-locked safety floor, so this proves the bake did not weaken it.
      expect(page.verdict).toBe(entry.case.expect)
      expect(page.artifactDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(page.pageDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(page.canonicalName.startsWith("calllint-fixtures/")).toBe(true)
    })
  }
})

describe("bakeTrustPage — reproducibility (ADR 0046 §4)", () => {
  for (const entry of verdictCases) {
    it(`re-bakes ${entry.case.file} byte-identically (page + sidecar + html)`, () => {
      const a = bakeTrustPage(entry.input)
      const b = bakeTrustPage(entry.input)
      // Same digest ⇒ same content address.
      expect(b.pageDigest).toBe(a.pageDigest)
      expect(b.artifactDigest).toBe(a.artifactDigest)
      // Same rendered bytes ⇒ the CI diff-gate would see no change.
      expect(renderSidecar(b)).toBe(renderSidecar(a))
      expect(renderHtml(b)).toBe(renderHtml(a))
    })
  }

  it("the artifact digest is a pure content hash (same bytes ⇒ same digest)", () => {
    const [first] = verdictCases
    const again = bakeTrustPage({ ...first!.input })
    const once = bakeTrustPage({ ...first!.input })
    expect(again.artifactDigest).toBe(once.artifactDigest)
  })

  it("is line-ending-independent (CRLF checkout ≡ LF checkout) — cross-OS gate", () => {
    // The Windows CI leg checks fixtures out as CRLF; Linux/macOS as LF. The baked
    // page MUST be identical either way, or the committed tree can never match on
    // all three OSes. Canonicalization guarantees it: prove LF and CRLF inputs bake
    // byte-identically.
    const [first] = verdictCases
    const lf: BakeInput = { ...first!.input, configText: first!.input.configText.replace(/\r\n/g, "\n") }
    const crlf: BakeInput = { ...lf, configText: lf.configText.replace(/\n/g, "\r\n") }
    const bakedLf = bakeTrustPage(lf)
    const bakedCrlf = bakeTrustPage(crlf)
    expect(bakedCrlf.artifactDigest).toBe(bakedLf.artifactDigest)
    expect(bakedCrlf.pageDigest).toBe(bakedLf.pageDigest)
    expect(renderSidecar(bakedCrlf)).toBe(renderSidecar(bakedLf))
    expect(renderHtml(bakedCrlf)).toBe(renderHtml(bakedLf))
  })
})

describe("bakeTrustPage — parse errors are surfaced, never silently SAFE", () => {
  for (const entry of parseErrorCases) {
    it(`throws ConfigParseError for ${entry.case.file}`, () => {
      // A malformed config must not bake to a page that reads as "no blockers".
      // I1a surfaces it; I1b decides whether it becomes an `incomplete` page.
      expect(() => bakeTrustPage(entry.input)).toThrow(ConfigParseError)
    })
  }
})

describe("rendered pages — language boundary (ADR 0038 §2)", () => {
  for (const entry of verdictCases) {
    it(`neither the HTML nor the sidecar of ${entry.case.file} uses forbidden language`, () => {
      const page = bakeTrustPage(entry.input)
      const html = renderHtml(page).toLowerCase()
      const sidecar = renderSidecar(page).toLowerCase()
      for (const phrase of FORBIDDEN) {
        expect(html).not.toContain(phrase)
        expect(sidecar).not.toContain(phrase)
      }
      // And it DOES carry the required boundary framing + the explicit disclaimer.
      const rawHtml = renderHtml(page)
      expect(rawHtml).toContain("Observed at artifact digest")
      expect(rawHtml).toContain("Report a correction")
      expect(rawHtml).toContain("not a certification")
      expect(rawHtml).toContain("guarantee of safety")
    })
  }
})
