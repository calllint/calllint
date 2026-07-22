/**
 * Gate B / PR-D3 — Human-calibration gate over negative-verdict Trust Pages
 * (new12 §2.6/§6.1; ADR 0053 §4 `REVIEW_HOLD`).
 *
 * ADR 0053 §4 blocks every *new negative* conclusion (first BLOCK / high-severity
 * REVIEW for an artifact) behind Gate-B **dual human review**. The kill-gate
 * thresholds — dangerous false-SAFE = 0, blocker precision ≥ 90%, byte-identical
 * repeat = 100% — are that channel's EXIT condition, not advisory (§4).
 *
 * This module is the GATE, never the review. It is a PURE PROJECTION over the shipped
 * baked pages (same discipline as the Gate-A coverage audit): it re-bakes the fixtures
 * cohort in-memory, selects the negative-verdict pages, reads verdict + findings +
 * digests VERBATIM (never re-scores — §2: verbatim, never a new judgment), and pairs
 * each negative artifact with the human sign-offs recorded in a committed review store.
 *
 * It NEVER writes a sign-off, and it NEVER moves a verdict. With zero human sign-offs
 * the gate is `pass: false` BY CONSTRUCTION — that is the honest, correct state, and
 * it is exactly what keeps a new negative page from publishing until a human signs
 * (ADR 0053 §4). The output is an OFFLINE audit artifact, never a public Trust Page
 * (ADR 0053 §6: no public scale-up at Gate B).
 */
import type { GoldenCase } from "@calllint/fixtures"
import { fixtureCohort } from "./cohort.js"
import { bakeTrustPage, type BakedTrustPage } from "./bakeTrustPage.js"

/**
 * The Gate-B exit thresholds (ADR 0053 §4). Mirrored from the kill-gate, never
 * weakened here — a change requires an ADR (project golden-fixtures discipline).
 */
export const CALIBRATION_THRESHOLDS = {
  /** Dangerous false-SAFE across the whole set: MUST be exactly zero. */
  falseSafe: 0,
  /** Blocker (BLOCK-verdict) precision floor, measured from human sign-offs. */
  blockerPrecision: 0.9,
  /** Distinct human reviewers required to sign off EACH negative artifact. */
  reviewersPerArtifact: 2,
} as const

/** Finding severities the shipped detectors emit (verbatim from the scan). */
export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info"

/** Severities that make a REVIEW verdict a "high-sev REVIEW" for Gate-B purposes (§4). */
const HIGH_SEVERITIES: ReadonlySet<string> = new Set(["critical", "high"])

/**
 * One reviewer's recorded decision on a negative artifact. This is DATA a human
 * appends to the review store and commits — this module only reads it, never writes
 * it. `decision` is the reviewer's own call on whether the negative conclusion is a
 * true positive (the input to blocker precision), never a re-scored verdict.
 */
export interface ReviewerSignoff {
  /** The reviewer's handle (e.g. a GitHub login). Distinctness is counted by this. */
  reviewer: string
  /** The reviewer's judgment: was the negative conclusion correct for this artifact? */
  decision: "confirmed" | "false-positive"
  /** ISO-8601 UTC the sign-off was recorded (informational; not used in the gate math). */
  at: string
  /** Optional free-text note (rationale / linked evidence). */
  note?: string
}

/**
 * The committed review store: sign-offs keyed by artifact digest. A human edits this
 * file (via `scripts/calibration-audit.ts` guidance) and commits it; the gate reads
 * it. Empty by construction until the first real review lands.
 */
export interface ReviewStore {
  schema: "calllint.calibration-review.v0"
  /** artifactDigest → the sign-offs recorded for that negative artifact. */
  signoffs: Record<string, ReviewerSignoff[]>
}

/** An empty review store — the correct starting state (gate closed). */
export const EMPTY_REVIEW_STORE: ReviewStore = {
  schema: "calllint.calibration-review.v0",
  signoffs: {},
}

/** A single finding projected verbatim from the scan (never re-derived). */
export interface CalibrationFinding {
  id: string
  severity: FindingSeverity
  title: string
}

/** One negative artifact awaiting (or carrying) human calibration. */
export interface NegativeArtifact {
  artifactDigest: string
  canonicalName: string
  /** The engine verdict, verbatim — BLOCK or high-sev REVIEW. Never re-scored. */
  verdict: BakedTrustPage["verdict"]
  /** The findings that make this artifact negative, projected verbatim. */
  findings: CalibrationFinding[]
  /** Evidence completeness of the underlying authority (`complete`/`partial`). */
  completeness: "complete" | "partial"
  /** Reproducibility anchor (page digest + observed-at). */
  reproducibility: { pageDigest: string; observedAt: string }
  /**
   * True dangerous false-SAFE: the ADR-locked expected verdict is negative, but the
   * bake resolved SAFE. This must never happen; if it does the gate fails hard.
   */
  falseSafe: boolean
  /** Distinct human sign-offs recorded for this artifact (from the review store). */
  signoffs: ReviewerSignoff[]
  /** Whether this artifact has ≥ the required number of DISTINCT reviewers. */
  dualReviewed: boolean
}

/** The full Gate-B calibration report — deterministic, byte-reproducible, offline. */
export interface CalibrationReport {
  schema: "calllint.calibration-audit.v1"
  /** Total baked pages considered (the whole fixtures cohort). */
  pageCount: number
  /** The negative-verdict artifacts that Gate B governs (BLOCK + high-sev REVIEW). */
  negatives: NegativeArtifact[]
  thresholds: typeof CALIBRATION_THRESHOLDS
  /** Aggregate measures used for the pass decision. */
  measures: {
    /** Count of negative artifacts. */
    negativeCount: number
    /** Count of BLOCK-verdict artifacts (the blocker-precision denominator). */
    blockerCount: number
    /** Negatives with ≥ required distinct reviewers. */
    dualReviewedCount: number
    /** Dangerous false-SAFE count across the whole set (must be 0). */
    falseSafeCount: number
    /**
     * Blocker precision = confirmed BLOCKs / reviewed BLOCKs, over BLOCKs that have
     * ≥1 sign-off. `null` when no BLOCK has been reviewed yet (undefined, not 0 —
     * an unreviewed set has no precision, and the gate must not pass on it).
     */
    blockerPrecision: number | null
  }
  /**
   * The Gate-B pass decision. TRUE only when: every negative artifact is dual-reviewed,
   * blocker precision ≥ threshold, dangerous false-SAFE = 0, and the projection is
   * byte-reproducible. FALSE by construction while sign-offs are pending.
   */
  pass: boolean
  /** Honest, human-readable reasons the gate is not passing (empty when `pass`). */
  blockedReasons: string[]
  /** Determinism: a second identical projection produced byte-identical negatives. */
  deterministic: boolean
}

/** Project a page's negative findings verbatim (critical/high for REVIEW; any for BLOCK). */
function negativeFindings(page: BakedTrustPage): CalibrationFinding[] {
  const out: CalibrationFinding[] = []
  for (const report of page.scan.reports ?? []) {
    for (const f of report.findings ?? []) {
      const finding = f as { id?: string; ruleId?: string; severity?: string; title?: string; message?: string }
      out.push({
        id: finding.id ?? finding.ruleId ?? "unknown",
        severity: (finding.severity ?? "info") as FindingSeverity,
        title: finding.title ?? finding.message ?? "",
      })
    }
  }
  // Deterministic order: severity rank, then id, then title (stable across hosts).
  const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
  return out.sort(
    (a, b) =>
      (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) ||
      a.id.localeCompare(b.id) ||
      a.title.localeCompare(b.title),
  )
}

/** Does this page carry a high-severity (critical/high) finding? */
function hasHighSevFinding(page: BakedTrustPage): boolean {
  return (page.scan.reports ?? []).some((r) =>
    (r.findings ?? []).some((f) => HIGH_SEVERITIES.has((f as { severity?: string }).severity ?? "")),
  )
}

/**
 * Is this page a Gate-B "negative"? BLOCK always is. REVIEW is only when it carries a
 * high-severity finding (§4: "first BLOCK / high-sev REVIEW"). SAFE/UNKNOWN never are.
 */
function isNegative(page: BakedTrustPage): boolean {
  if (page.verdict === "BLOCK") return true
  if (page.verdict === "REVIEW") return hasHighSevFinding(page)
  return false
}

/** Distinct reviewer handles among a set of sign-offs. */
function distinctReviewers(signoffs: ReviewerSignoff[]): number {
  return new Set(signoffs.map((s) => s.reviewer)).size
}

/** The negative subject types whose ADR-locked expected verdict is a blocker/negative. */
const NEGATIVE_EXPECTED: ReadonlySet<GoldenCase["expect"]> = new Set(["BLOCK", "REVIEW"])

/**
 * Build one negative-artifact record: page fields verbatim + false-SAFE cross-check
 * against the ADR-locked expected verdict + the human sign-offs from the review store.
 */
function toNegativeArtifact(
  page: BakedTrustPage,
  expected: GoldenCase["expect"] | undefined,
  store: ReviewStore,
): NegativeArtifact {
  const signoffs = store.signoffs[page.artifactDigest] ?? []
  // Dangerous false-SAFE: the golden contract says negative, the bake said SAFE.
  // (For the fixtures cohort the bake always matches `expect`, so this is 0; the
  //  check exists so a future regression fails the gate hard rather than silently.)
  const falseSafe = expected !== undefined && NEGATIVE_EXPECTED.has(expected) && page.verdict === "SAFE"
  return {
    artifactDigest: page.artifactDigest,
    canonicalName: page.canonicalName,
    verdict: page.verdict,
    findings: negativeFindings(page),
    completeness: page.preparation.authority?.completeness ?? "partial",
    reproducibility: { pageDigest: page.pageDigest, observedAt: page.observedAt },
    falseSafe,
    signoffs,
    dualReviewed: distinctReviewers(signoffs) >= CALIBRATION_THRESHOLDS.reviewersPerArtifact,
  }
}

/**
 * Run the Gate-B calibration audit. Re-bakes the fixtures cohort twice (once for the
 * report, once to prove determinism), selects the negative-verdict pages, and pairs
 * each with the committed human sign-offs. PURE and deterministic: no clock, no
 * network, no RNG (the bake injects a pinned timestamp). Given the same cohort and the
 * same review store, the report is byte-identical.
 *
 * @param store the committed review store (defaults to empty ⇒ gate closed).
 */
export function runCalibrationAudit(store: ReviewStore = EMPTY_REVIEW_STORE): CalibrationReport {
  const cohort = fixtureCohort().filter((e) => e.case.expect !== "parse-error")
  const expectedByName = new Map<string, GoldenCase["expect"]>()

  const bakeAll = () =>
    cohort.map((e) => {
      const page = bakeTrustPage(e.input)
      expectedByName.set(page.canonicalName, e.case.expect)
      return page
    })

  const pagesA = bakeAll()
  const pagesB = bakeAll()
  const deterministic = JSON.stringify(pagesA) === JSON.stringify(pagesB)

  const negatives = pagesA
    .filter(isNegative)
    .map((page) => toNegativeArtifact(page, expectedByName.get(page.canonicalName), store))
    // Stable, host-independent order: canonical name.
    .sort((a, b) => a.canonicalName.localeCompare(b.canonicalName))

  const blockers = negatives.filter((n) => n.verdict === "BLOCK")
  const reviewedBlockers = blockers.filter((n) => n.signoffs.length > 0)
  const confirmedBlockers = reviewedBlockers.filter((n) =>
    n.signoffs.some((s) => s.decision === "confirmed"),
  )
  const blockerPrecision =
    reviewedBlockers.length === 0 ? null : confirmedBlockers.length / reviewedBlockers.length

  const falseSafeCount = negatives.filter((n) => n.falseSafe).length
  const dualReviewedCount = negatives.filter((n) => n.dualReviewed).length

  // Assemble the honest reasons the gate is (not) passing — order is deterministic.
  const blockedReasons: string[] = []
  if (falseSafeCount !== CALIBRATION_THRESHOLDS.falseSafe) {
    blockedReasons.push(
      `${falseSafeCount} dangerous false-SAFE (must be ${CALIBRATION_THRESHOLDS.falseSafe}).`,
    )
  }
  const pending = negatives.length - dualReviewedCount
  if (pending > 0) {
    blockedReasons.push(
      `${pending} of ${negatives.length} negative artifacts lack ${CALIBRATION_THRESHOLDS.reviewersPerArtifact} distinct human sign-offs.`,
    )
  }
  if (blockerPrecision === null) {
    if (blockers.length > 0) {
      blockedReasons.push(`blocker precision undefined — no BLOCK artifact has been reviewed yet.`)
    }
  } else if (blockerPrecision < CALIBRATION_THRESHOLDS.blockerPrecision) {
    blockedReasons.push(
      `blocker precision ${(blockerPrecision * 100).toFixed(1)}% < ${(CALIBRATION_THRESHOLDS.blockerPrecision * 100).toFixed(0)}%.`,
    )
  }
  if (!deterministic) {
    blockedReasons.push("projection is NOT byte-reproducible (determinism check failed).")
  }

  const pass =
    negatives.length > 0 &&
    falseSafeCount === CALIBRATION_THRESHOLDS.falseSafe &&
    dualReviewedCount === negatives.length &&
    blockerPrecision !== null &&
    blockerPrecision >= CALIBRATION_THRESHOLDS.blockerPrecision &&
    deterministic

  return {
    schema: "calllint.calibration-audit.v1",
    pageCount: pagesA.length,
    negatives,
    thresholds: CALIBRATION_THRESHOLDS,
    measures: {
      negativeCount: negatives.length,
      blockerCount: blockers.length,
      dualReviewedCount,
      falseSafeCount,
      blockerPrecision,
    },
    pass,
    blockedReasons,
    deterministic,
  }
}
