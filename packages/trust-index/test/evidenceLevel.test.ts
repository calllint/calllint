/**
 * PR-D2 — evidence-level (E0–E6) + four-dimension status projection tests
 * (new12 §7; ADR 0053 §5). Proves the projection is honest and pure: it reads only
 * shipped baked fields, never re-scores, tops out at E2 for a config-only page, and
 * never collapses the four dimensions into one score.
 */
import { describe, it, expect } from "vitest"
import {
  bakeTrustPage,
  fixtureCohort,
  evidenceLevel,
  fourDimensionStatus,
  EVIDENCE_LEVEL_META,
} from "../src/index.js"

const cohort = fixtureCohort()
const pages = cohort
  .filter((e) => e.case.expect !== "parse-error")
  .map((e) => bakeTrustPage(e.input))

describe("evidenceLevel", () => {
  it("reaches E2 for every config-baked page (install config observed → authority)", () => {
    for (const page of pages) {
      const { level, rationale } = evidenceLevel(page)
      expect(level).toBe("E2")
      expect(rationale).toContain("install config observed")
    }
  })

  it("never claims a level above E2 for a static page (honest ceiling)", () => {
    for (const page of pages) {
      expect(["E3", "E4", "E5", "E6"]).not.toContain(evidenceLevel(page).level)
    }
  })

  it("has metadata for every level E0–E6", () => {
    for (const lvl of ["E0", "E1", "E2", "E3", "E4", "E5", "E6"] as const) {
      expect(EVIDENCE_LEVEL_META[lvl].level).toBe(lvl)
      expect(EVIDENCE_LEVEL_META[lvl].label.length).toBeGreaterThan(0)
    }
  })
})

describe("fourDimensionStatus — independence (ADR 0053 §5)", () => {
  it("reports four separate dimensions + an evidence level, never a combined score", () => {
    const page = pages[0]!
    const status = fourDimensionStatus(page)
    // The four dimensions are present and distinct.
    expect(status.verdict).toBe(page.verdict)
    expect(["complete", "partial"]).toContain(status.completeness)
    expect(typeof status.authorityClaimed).toBe("boolean")
    expect(status.reproducibility.pageDigest).toBe(page.pageDigest)
    expect(status.reproducibility.observedAt).toBe(page.observedAt)
    expect(status.evidenceLevel).toBe("E2")
    // There is deliberately no single numeric/graded "score" field.
    expect("score" in status).toBe(false)
    expect("grade" in status).toBe(false)
  })

  it("is deterministic — same page in, identical status out", () => {
    const page = pages[0]!
    expect(JSON.stringify(fourDimensionStatus(page))).toBe(JSON.stringify(fourDimensionStatus(page)))
  })
})
