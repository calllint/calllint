/**
 * Evidence-refined verdict (ADR 0050) — PURE. Given a scan summary and the
 * resolved evidence bundles for its remote subjects, close the ONE gap that
 * produced UNKNOWN (unverified remote source) and re-derive under the unchanged
 * rules. It NEVER re-scores, NEVER reaches SAFE, and NEVER touches a confident
 * (BLOCK/REVIEW/SAFE) verdict — it only lifts an UNKNOWN-by-unverified-source
 * remote to REVIEW, with a stated "identity verified; tool surface not analyzed"
 * reason. No I/O, no clock: bake stays reproducible (ADR 0046 §4).
 */
import type { ConfigSummaryReport, ScanReport, Verdict } from "@calllint/types"
import { VERDICT_PUBLIC_LABEL, mostSevereVerdict } from "@calllint/types"
import { hasBlockingGap, type EvidenceBundle } from "@calllint/evidence"

/** The exact reproducibility reason a remote UNKNOWN carries (risk-engine). */
export const REMOTE_UNVERIFIED_REASON = "Remote endpoint could not be verified"
/** The residual reason once identity is verified but the surface is not analyzed. */
export const REMOTE_SURFACE_UNANALYZED_REASON =
  "Remote endpoint identity verified; tool surface not analyzed"
/** Residual reason when the endpoint is reachable but its domain ownership is unproven. */
export const REMOTE_OWNER_UNVERIFIED_REASON =
  "Remote endpoint domain ownership not verified"

/** The R6 field present once the endpoint's network identity (url/host/tls) is pinned. */
const NETWORK_IDENTITY_FIELD = "endpoint.url"

/** True when a report is UNKNOWN solely because its remote source was unverified. */
function isRemoteUnverifiedUnknown(r: ScanReport): boolean {
  return (
    r.verdict === "UNKNOWN" &&
    r.reproducibility.reasons.includes(REMOTE_UNVERIFIED_REASON)
  )
}

/**
 * True when evidence establishes the remote's NETWORK identity (ADR 0050 §2): R6
 * reached the endpoint and resolved its url/host/TLS, with NO blocking gap. A
 * NETWORK_UNAVAILABLE / unreachable endpoint (blocking gap, or a RETRYABLE_FAILURE
 * / UNRESOLVABLE state) stays UNKNOWN — fail-closed. Domain ownership may still be
 * unverified (a *degrading* gap); that never blocks the lift — it becomes a stated
 * residual reason on the REVIEW page, so we never imply ownership we didn't prove.
 */
function remoteIdentityEstablished(bundle: EvidenceBundle): boolean {
  return (
    bundle.subject.subjectType === "remote-endpoint" &&
    bundle.state !== "RETRYABLE_FAILURE" &&
    bundle.state !== "UNRESOLVABLE" &&
    !hasBlockingGap(bundle.gaps) &&
    bundle.items.some((i) => i.field === NETWORK_IDENTITY_FIELD)
  )
}

/** Build the residual reasons after the gap is closed — states exactly what we know. */
function residualReasons(base: string[], bundle: EvidenceBundle): string[] {
  const reasons = base.filter((x) => x !== REMOTE_UNVERIFIED_REASON)
  if (bundle.gaps.some((g) => g.code === "REMOTE_OWNER_UNVERIFIED")) {
    reasons.push(REMOTE_OWNER_UNVERIFIED_REASON)
  }
  reasons.push(REMOTE_SURFACE_UNANALYZED_REASON)
  return reasons
}

/** Recompute a reproducibility level from its reason count (same rule as the engine). */
function levelFor(reasons: string[]): "HIGH" | "MEDIUM" | "LOW" {
  return reasons.length === 0 ? "HIGH" : reasons.length === 1 ? "MEDIUM" : "LOW"
}

/**
 * Refine one report with its evidence bundle. Returns the report VERBATIM unless
 * it is an UNKNOWN-by-unverified-remote AND a cleanly-resolved remote-endpoint
 * bundle closes that gap — then it becomes REVIEW (never SAFE: the tool surface
 * was not analyzed; never BLOCK: an UNKNOWN report by definition had no blocker).
 */
function refineReport(report: ScanReport, bundle: EvidenceBundle | undefined): ScanReport {
  if (!isRemoteUnverifiedUnknown(report)) return report
  if (!bundle || !remoteIdentityEstablished(bundle)) return report
  // Gap closed: swap the "unverified" reason for the residual reasons (ownership
  // still unproven if applicable, plus surface-unanalyzed) and re-derive. The floor
  // is REVIEW — the single documented, bounded transform of ADR 0050 §2 (identity
  // known, ownership/surface unknown ⇒ needs a human). Never SAFE, never BLOCK.
  const reasons = residualReasons(report.reproducibility.reasons, bundle)
  const verdict: Verdict = "REVIEW"
  return {
    ...report,
    verdict,
    publicVerdictLabel: VERDICT_PUBLIC_LABEL[verdict],
    reproducibility: { level: levelFor(reasons), reasons },
    diagnostics: [
      ...report.diagnostics,
      {
        level: "info",
        code: "evidence.remote-identity-verified",
        message: `${REMOTE_SURFACE_UNANALYZED_REASON} (evidence: ${bundle.subject.id})`,
      },
    ],
  }
}

/**
 * Apply evidence refinement across a config summary, keyed by `report.target.source`
 * (the raw endpoint URL = the resolver subject id). Re-aggregates the summary verdict
 * from the refined per-server reports. Absent/empty bundle map ⇒ byte-identical input.
 */
export function refineSummaryWithEvidence(
  summary: ConfigSummaryReport,
  bundles: ReadonlyMap<string, EvidenceBundle>,
): ConfigSummaryReport {
  if (bundles.size === 0) return summary
  const reports = summary.reports.map((r) =>
    refineReport(r, r.target.source ? bundles.get(r.target.source) : undefined),
  )
  const counts: Record<Verdict, number> = { SAFE: 0, REVIEW: 0, BLOCK: 0, UNKNOWN: 0 }
  for (const r of reports) counts[r.verdict]++
  const verdict =
    reports.length === 0 ? "UNKNOWN" : mostSevereVerdict(reports.map((r) => r.verdict))
  return {
    ...summary,
    verdict,
    publicVerdictLabel: VERDICT_PUBLIC_LABEL[verdict],
    counts,
    reports,
  }
}
