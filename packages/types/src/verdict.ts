/**
 * The four verdicts. Order in this array is NOT severity order.
 * See VERDICT_SEVERITY for aggregation.
 */
export const VERDICTS = ["SAFE", "REVIEW", "BLOCK", "UNKNOWN"] as const

export type Verdict = (typeof VERDICTS)[number]

/**
 * Severity order for aggregating multiple servers into one config verdict.
 * Higher number = more severe. BLOCK is most severe; UNKNOWN outranks REVIEW
 * because "insufficient evidence" must not be treated as merely needing review.
 */
export const VERDICT_SEVERITY: Record<Verdict, number> = {
  SAFE: 0,
  REVIEW: 1,
  UNKNOWN: 2,
  BLOCK: 3,
}

/** CLI symbol shown for each verdict (developer mode). */
export const VERDICT_CLI_SYMBOL: Record<Verdict, string> = {
  SAFE: "🛡 SAFE",
  REVIEW: "⚠ REVIEW",
  BLOCK: "⛔ BLOCK",
  UNKNOWN: "◇ UNKNOWN",
}

/** Plain-text symbol for --no-emoji / CI logs. */
export const VERDICT_TEXT_SYMBOL: Record<Verdict, string> = {
  SAFE: "SAFE",
  REVIEW: "REVIEW",
  BLOCK: "BLOCK",
  UNKNOWN: "UNKNOWN",
}

/** Legally careful label for public / web reports. */
export const VERDICT_PUBLIC_LABEL: Record<Verdict, string> = {
  SAFE: "No blockers observed",
  REVIEW: "Review required",
  BLOCK: "Blocked by policy",
  UNKNOWN: "Insufficient evidence",
}

/** Pick the most severe verdict from a list. Empty list defaults to SAFE. */
export function mostSevereVerdict(verdicts: readonly Verdict[]): Verdict {
  let worst: Verdict = "SAFE"
  for (const v of verdicts) {
    if (VERDICT_SEVERITY[v] > VERDICT_SEVERITY[worst]) worst = v
  }
  return worst
}
