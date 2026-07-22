/**
 * PR-D3 — Gate-B human-calibration gate tests (new12 §2.6/§6.1; ADR 0053 §4).
 *
 * Proves the gate is honest and closed-by-construction:
 *   - it selects exactly the negative-verdict pages (BLOCK + high-sev REVIEW),
 *   - it reads verdicts/findings verbatim and never re-scores,
 *   - it is PENDING (pass=false) with an empty review store,
 *   - it PASSES only when every negative artifact has ≥2 DISTINCT human sign-offs
 *     AND blocker precision ≥ 90% AND zero false-SAFE,
 *   - a single reviewer, or a reviewer signing twice, is NOT dual review,
 *   - a false-positive-heavy blocker set fails the precision floor.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect } from "vitest"
import {
  runCalibrationAudit,
  CALIBRATION_THRESHOLDS,
  EMPTY_REVIEW_STORE,
  type ReviewStore,
  type ReviewerSignoff,
} from "../src/calibration.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const storePath = path.join(repoRoot, "packages", "trust-index", "calibration", "review-store.json")

/** The negatives are fixed by the ADR-locked fixtures cohort — recompute, never hardcode. */
const base = runCalibrationAudit(EMPTY_REVIEW_STORE)

/** Build a review store that gives every negative artifact `n` distinct confirmed reviewers. */
function storeWith(
  decisionFor: (verdict: string) => ReviewerSignoff["decision"] = () => "confirmed",
  reviewers: number = CALIBRATION_THRESHOLDS.reviewersPerArtifact,
): ReviewStore {
  const signoffs: Record<string, ReviewerSignoff[]> = {}
  for (const n of base.negatives) {
    signoffs[n.artifactDigest] = Array.from({ length: reviewers }, (_, i) => ({
      reviewer: `reviewer-${i + 1}`,
      decision: decisionFor(n.verdict),
      at: "2026-07-22T00:00:00.000Z",
    }))
  }
  return { schema: "calllint.calibration-review.v0", signoffs }
}

describe("runCalibrationAudit — selection & verbatim projection", () => {
  it("selects only BLOCK and high-severity REVIEW pages as negatives", () => {
    for (const n of base.negatives) {
      expect(["BLOCK", "REVIEW"]).toContain(n.verdict)
      if (n.verdict === "REVIEW") {
        // a REVIEW negative MUST carry a critical/high finding (that is what made it negative)
        expect(n.findings.some((f) => f.severity === "critical" || f.severity === "high")).toBe(true)
      }
    }
    // SAFE/UNKNOWN pages are never negatives.
    expect(base.negatives.some((n) => n.verdict === "SAFE" || n.verdict === "UNKNOWN")).toBe(false)
  })

  it("reads findings verbatim (ids + severities present, never empty for a negative)", () => {
    for (const n of base.negatives) {
      expect(n.findings.length).toBeGreaterThan(0)
      for (const f of n.findings) expect(f.id).toBeTruthy()
    }
  })

  it("is byte-reproducible and reports zero dangerous false-SAFE", () => {
    expect(base.deterministic).toBe(true)
    expect(base.measures.falseSafeCount).toBe(0)
  })

  it("has the expected shape: 7 BLOCK + 2 high-sev REVIEW = 9 negatives", () => {
    expect(base.measures.blockerCount).toBe(7)
    expect(base.measures.negativeCount).toBe(9)
  })
})

describe("Gate-B pass decision (closed-by-construction)", () => {
  it("NEGATIVE: empty review store ⇒ pass=false, every artifact pending", () => {
    const r = runCalibrationAudit(EMPTY_REVIEW_STORE)
    expect(r.pass).toBe(false)
    expect(r.measures.dualReviewedCount).toBe(0)
    expect(r.blockedReasons.join(" ")).toContain("distinct human sign-offs")
  })

  it("NEGATIVE: a single reviewer per artifact is NOT dual review", () => {
    const r = runCalibrationAudit(storeWith(() => "confirmed", 1))
    expect(r.pass).toBe(false)
    expect(r.measures.dualReviewedCount).toBe(0)
  })

  it("NEGATIVE: the same reviewer signing twice is not two DISTINCT reviewers", () => {
    const signoffs: Record<string, ReviewerSignoff[]> = {}
    for (const n of base.negatives) {
      signoffs[n.artifactDigest] = [
        { reviewer: "same-person", decision: "confirmed", at: "2026-07-22T00:00:00.000Z" },
        { reviewer: "same-person", decision: "confirmed", at: "2026-07-22T01:00:00.000Z" },
      ]
    }
    const r = runCalibrationAudit({ schema: "calllint.calibration-review.v0", signoffs })
    expect(r.pass).toBe(false)
    expect(r.measures.dualReviewedCount).toBe(0)
  })

  it("NEGATIVE: dual-reviewed but all BLOCKs false-positive ⇒ precision 0% < 90% ⇒ fail", () => {
    // Every reviewer marks the conclusion a false-positive → blocker precision collapses.
    const r = runCalibrationAudit(storeWith(() => "false-positive"))
    expect(r.measures.dualReviewedCount).toBe(base.measures.negativeCount) // reviewed…
    expect(r.measures.blockerPrecision).toBe(0) // …but every BLOCK was called wrong
    expect(r.pass).toBe(false)
    expect(r.blockedReasons.join(" ")).toContain("blocker precision")
  })

  it("POSITIVE: two distinct reviewers per artifact, all confirmed ⇒ pass=true", () => {
    const r = runCalibrationAudit(storeWith(() => "confirmed"))
    expect(r.measures.dualReviewedCount).toBe(r.measures.negativeCount)
    expect(r.measures.falseSafeCount).toBe(0)
    expect(r.measures.blockerPrecision).toBe(1)
    expect(r.blockedReasons).toEqual([])
    expect(r.pass).toBe(true)
  })

  it("thresholds are the ADR-locked kill-gate values (never weakened in code)", () => {
    expect(CALIBRATION_THRESHOLDS.falseSafe).toBe(0)
    expect(CALIBRATION_THRESHOLDS.blockerPrecision).toBe(0.9)
    expect(CALIBRATION_THRESHOLDS.reviewersPerArtifact).toBe(2)
  })
})

describe("committed calibration artifact (no drift)", () => {
  // Binds the committed report to a fresh projection over the CURRENT review store, so
  // `pnpm test` catches artifact drift on every PR (mirrors benchmark.test.ts's
  // "coverage-audit report agrees with the gate"). The .md byte-drift is additionally
  // guarded by `pnpm audit:calibration --check` in ci:local.
  it("packages/trust-index/calibration/calibration.json matches a fresh render", () => {
    const committedPath = path.join(repoRoot, "packages", "trust-index", "calibration", "calibration.json")
    if (!fs.existsSync(committedPath)) {
      throw new Error("calibration.json is missing — run `pnpm audit:calibration:write` and commit it.")
    }
    const committed = JSON.parse(fs.readFileSync(committedPath, "utf8"))
    const store: ReviewStore = fs.existsSync(storePath)
      ? JSON.parse(fs.readFileSync(storePath, "utf8"))
      : EMPTY_REVIEW_STORE
    const fresh = runCalibrationAudit(store)
    expect(committed).toEqual(JSON.parse(JSON.stringify(fresh)))
  })
})
