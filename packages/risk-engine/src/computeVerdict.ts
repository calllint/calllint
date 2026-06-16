import type {
  Confidence,
  Finding,
  RecommendedPolicy,
  RuntimeBinding,
  Verdict,
} from "@calllint/types"

/**
 * Deterministic verdict rules (priority order):
 *   1. Any critical blocker finding        → BLOCK
 *   2. Unknown/unverifiable executable src  → UNKNOWN
 *   3. Any high-severity finding            → REVIEW
 *   4. Any finding at all                   → REVIEW
 *   5. No findings, source known            → SAFE
 *
 * UNKNOWN never auto-upgrades to SAFE. The LLM is not consulted here.
 */
export function computeVerdict(
  findings: Finding[],
  binding: RuntimeBinding,
): Verdict {
  if (findings.some((f) => f.blocker)) return "BLOCK"

  // An unverifiable source we cannot inspect is UNKNOWN, not SAFE.
  // This is a remote endpoint we don't recognize, or a runtime with no
  // identifiable source.
  const unverifiable =
    !binding.sourceKnown && (Boolean(binding.remoteUrl) || binding.runtimeExecutable)
  if (unverifiable) return "UNKNOWN"

  if (findings.some((f) => f.severity === "high" || f.severity === "critical")) {
    return "REVIEW"
  }
  if (findings.length > 0) return "REVIEW"

  return "SAFE"
}

/** Overall confidence: lowest confidence among findings, or high if none. */
export function computeConfidence(findings: Finding[]): Confidence {
  if (findings.length === 0) return "high"
  const rank: Record<Confidence, number> = { low: 0, medium: 1, high: 2 }
  let worst: Confidence = "high"
  for (const f of findings) {
    if (rank[f.confidence] < rank[worst]) worst = f.confidence
  }
  return worst
}

/** Recommended runtime policy derived from verdict + findings. */
export function computeRecommendedPolicy(
  verdict: Verdict,
  findings: Finding[],
): RecommendedPolicy {
  const hasExec = findings.some((f) => f.symbol === "EXEC" || f.symbol === "MONEY")
  const hasFiles = findings.some((f) => f.symbol === "FILES")

  if (verdict === "BLOCK") {
    return {
      autonomousUse: "deny",
      manualApproval: "required",
      sandbox: hasExec || hasFiles ? "required" : "recommended",
    }
  }
  if (verdict === "UNKNOWN") {
    return {
      autonomousUse: "deny",
      manualApproval: "required",
      sandbox: "required",
    }
  }
  if (verdict === "REVIEW") {
    return {
      autonomousUse: "warn",
      manualApproval: "recommended",
      sandbox: "recommended",
    }
  }
  return {
    autonomousUse: "allow",
    manualApproval: "none",
    sandbox: "none",
  }
}
