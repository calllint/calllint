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
  TRUST_PAGE_FORBIDDEN_PHRASES,
  CLAIM_APP_URL,
  type BakeInput,
} from "../src/index.js"

const cohort = fixtureCohort()
const parseErrorCases = cohort.filter((e) => e.case.expect === "parse-error")
const verdictCases = cohort.filter((e) => e.case.expect !== "parse-error")

// The language boundary (ADR 0038 §2) is owned by src/language.ts — a single
// source of truth shared with the CI guard. A disclaimer that *denies* a guarantee
// ("not a guarantee of safety") is correct copy and is asserted present below, so
// the word "guarantee" is not blanket-banned; only affirmative overclaims are.
const FORBIDDEN = TRUST_PAGE_FORBIDDEN_PHRASES

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

// PR-D5 (Gate C): every page carries the reproduction command + scan history quality
// fields, in the sidecar (machine-readable) and the HTML (human-readable), and both
// stay boundary-safe + byte-reproducible.
describe("Gate-C quality fields — reproduction command + scan history", () => {
  for (const entry of verdictCases) {
    it(`${entry.case.file} carries both quality fields, boundary-safe + reproducibly`, () => {
      const page = bakeTrustPage(entry.input)
      const sidecar = JSON.parse(renderSidecar(page))
      // Reproduction: the exact scan command + the pinned digest it reproduces.
      expect(sidecar.reproduction.command).toBe(
        `npx calllint scan ${page.preparation.artifact.source}`,
      )
      expect(sidecar.reproduction.artifactDigest).toBe(page.artifactDigest)
      // Scan history: an honest single-entry list of this artifact's observation.
      expect(Array.isArray(sidecar.scanHistory)).toBe(true)
      expect(sidecar.scanHistory).toHaveLength(1)
      expect(sidecar.scanHistory[0].observedAt).toBe(page.observedAt)
      // The HTML surfaces both as sections.
      const html = renderHtml(page)
      expect(html).toContain("How to reproduce")
      expect(html).toContain("Scan history")
      expect(html).toContain("npx calllint scan")
      // Boundary: neither field leaks a forbidden phrase, and it re-bakes identically.
      const lc = (renderHtml(page) + renderSidecar(page)).toLowerCase()
      for (const phrase of FORBIDDEN) expect(lc, phrase).not.toContain(phrase)
      expect(renderSidecar(bakeTrustPage(entry.input))).toBe(renderSidecar(page))
      expect(renderHtml(bakeTrustPage(entry.input))).toBe(renderHtml(page))
    })
  }
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

describe("claimed page render — Verified Publisher boundary (ADR 0048 §6)", () => {
  const publisher = {
    owner: "octo-org",
    verifiedAt: "2026-07-17T00:00:00.000Z",
    observedArtifactDigest: "sha256:deadbeef" as const,
  }
  const anyCase = verdictCases[0]!

  it("a claimed page states control (never safety) and stays boundary-safe", () => {
    const page = bakeTrustPage(anyCase.input)
    const claimed = renderHtml(page, publisher)
    // Shows the claim, framed as control, distinct from a verdict.
    expect(claimed).toContain("Verified Publisher")
    expect(claimed).toContain("controls the")
    expect(claimed).toContain("github.com/octo-org")
    expect(claimed).toContain("it is not a safety claim")
    // Still carries the base disclaimer, and no forbidden phrase leaks in.
    expect(claimed).toContain("not a certification")
    const lc = claimed.toLowerCase()
    for (const phrase of FORBIDDEN) expect(lc, phrase).not.toContain(phrase)
  })

  it("an unclaimed render is byte-identical with or without an undefined publisher", () => {
    const page = bakeTrustPage(anyCase.input)
    expect(renderHtml(page, undefined)).toBe(renderHtml(page))
    expect(renderSidecar(page, undefined)).toBe(renderSidecar(page))
  })
})

describe("unclaimed page — claim funnel (DX-1, ADR 0047 §1 / 0048 §6)", () => {
  const anyCase = verdictCases[0]!
  const publisher = {
    owner: "octo-org",
    verifiedAt: "2026-07-17T00:00:00.000Z",
    observedArtifactDigest: "sha256:deadbeef" as const,
  }

  it("POSITIVE: an unclaimed page invites a claim via the public App funnel, framed as control", () => {
    const page = bakeTrustPage(anyCase.input)
    const html = renderHtml(page)
    expect(html).toContain(CLAIM_APP_URL)
    expect(html).toContain("claim this page")
    expect(html).toContain("Are you the maintainer?")
    // Control, never safety — and it must not leak the claimed-only heading.
    expect(html).toContain("not a safety claim")
    expect(html).toContain("does not change the observed verdict")
    expect(html).not.toContain("Verified Publisher")
  })

  it("NEGATIVE: a claimed page shows Verified Publisher and NOT the claim funnel", () => {
    const page = bakeTrustPage(anyCase.input)
    const html = renderHtml(page, publisher)
    expect(html).toContain("Verified Publisher")
    expect(html).not.toContain(CLAIM_APP_URL)
    expect(html).not.toContain("Are you the maintainer?")
  })

  it("the claim CTA uses no forbidden overclaim language", () => {
    const page = bakeTrustPage(anyCase.input)
    const lc = renderHtml(page).toLowerCase()
    for (const phrase of FORBIDDEN) expect(lc, phrase).not.toContain(phrase)
  })

  it("the CTA is HTML-only — the unclaimed sidecar carries no funnel or claim key", () => {
    const page = bakeTrustPage(anyCase.input)
    const sidecar = renderSidecar(page)
    expect(sidecar).not.toContain(CLAIM_APP_URL)
    expect(sidecar).not.toContain("verifiedPublisher")
  })
})

// Gate A / PR-D2 (ADR 0053 §5): a SAFE label is NEVER bare. Every rendered page that
// shows the public SAFE label ("No blockers observed") must scope it with the
// four-dimension status block — an evidence level (E0–E6) AND a completeness
// statement. This binds the renderer to `check-public-copy.mjs` check #20.
describe("no bare SAFE — the label is always scoped", () => {
  const SAFE_LABEL = "No blockers observed"
  const safeCases = verdictCases.filter((e) => e.case.expect === "SAFE")

  // The exact predicate check #20 applies to served bytes, kept in lock-step here.
  const isScoped = (html: string) =>
    /Evidence level:/i.test(html) && /\bE[0-6]\b/.test(html) && /Evidence completeness:/i.test(html)

  it("has at least one SAFE fixture to scope", () => {
    expect(safeCases.length).toBeGreaterThan(0)
  })

  it("POSITIVE: every SAFE page carries the evidence level + completeness scope block", () => {
    for (const entry of safeCases) {
      const html = renderHtml(bakeTrustPage(entry.input))
      expect(html, entry.case.file).toContain(SAFE_LABEL)
      expect(isScoped(html), `${entry.case.file} must scope SAFE`).toBe(true)
      // The block also states the four dimensions are not combined into one score.
      expect(html).toContain("not combined into a")
    }
  })

  it("NEGATIVE: the guard predicate rejects a bare SAFE (label with the block stripped)", () => {
    const html = renderHtml(bakeTrustPage(safeCases[0]!.input))
    // Remove the scope block to simulate a bare-SAFE regression → must be detected.
    const bare = html
      .replace(/Evidence level:/gi, "")
      .replace(/Evidence completeness:/gi, "")
    expect(bare).toContain(SAFE_LABEL)
    expect(isScoped(bare)).toBe(false)
  })

  it("the evidence level appears in the sidecar too (machine-readable, uncombined)", () => {
    const sidecar = renderSidecar(bakeTrustPage(safeCases[0]!.input))
    const parsed = JSON.parse(sidecar)
    expect(parsed.status.evidenceLevel).toMatch(/^E[0-6]$/)
    expect(parsed.status).not.toHaveProperty("score")
  })
})
