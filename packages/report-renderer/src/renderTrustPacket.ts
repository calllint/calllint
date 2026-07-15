import type { ConfigSummaryReport, GatewayEvidence, Verdict } from "@calllint/types"
import { DEFAULT_STYLE, verdictTag, type RenderStyle } from "./style.js"

// ---------------------------------------------------------------------------
// Joint Trust Packet renderer (B4 / ADR 0034).
//
// Shows two verdicts SIDE-BY-SIDE and UNMERGED:
//   • Content scan   — an external scanner's evidence (e.g. SkillSpector),
//                      provenance-preserved, never re-scored.
//   • Authority scan — CallLint's own deterministic verdict.
// plus ONE line explaining WHY they differ. That explained difference is the
// user value: the two tools answer different questions (is the content
// malicious? vs. is the granted authority acceptable?), so they can and should
// disagree. This renderer never merges them into a single score, and the
// external result never changes the CallLint verdict (ADR 0034 no-upgrade).
// ---------------------------------------------------------------------------

/**
 * A short, human phrase for an evidence completeness level. Degraded/failed
 * evidence must read as "not a pass", never as an endorsement.
 */
const COMPLETENESS_HINT: Record<GatewayEvidence["completeness"], string> = {
  complete: "complete",
  partial: "partial (incomplete — treat as inconclusive)",
  degraded: "degraded (not a pass)",
  failed: "failed (not a pass)",
}

/** Highest provider-native severity across the envelope's findings, if any. */
function topProviderSeverity(ev: GatewayEvidence): string | undefined {
  const sevs = ev.findings
    .map((f) =>
      f && typeof f === "object" && "providerSeverity" in f
        ? String((f as { providerSeverity: unknown }).providerSeverity)
        : undefined,
    )
    .filter((s): s is string => Boolean(s))
  return sevs[0]
}

/**
 * One line explaining why the content scan and the authority scan can differ.
 * Deliberately generic and non-accusatory: it states the division of labour,
 * not a claim about a specific project.
 */
function whyTheyDiffer(ev: GatewayEvidence, authorityVerdict: Verdict): string {
  if (ev.completeness === "failed" || ev.completeness === "degraded") {
    return (
      "Why they differ: the content scan is " +
      COMPLETENESS_HINT[ev.completeness] +
      ", so it carries no weight here; CallLint's authority verdict stands on its own evidence."
    )
  }
  if (ev.findings.length === 0 && authorityVerdict !== "SAFE") {
    return (
      "Why they differ: the content scan found nothing malicious, but CallLint judges the " +
      "granted authority itself too broad — clean code can still request unsafe capabilities."
    )
  }
  return (
    "Why they differ: the two tools answer different questions — content risk (the scanner) " +
    "vs. whether the requested authority is acceptable (CallLint). Neither overrides the other."
  )
}

/**
 * Render the joint Trust Packet for a scan that has external evidence attached.
 * Returns an empty string when no evidence is present, so callers can append it
 * unconditionally without perturbing evidence-free output.
 */
export function renderTrustPacket(
  summary: ConfigSummaryReport,
  toolVersion: string,
  style: RenderStyle = DEFAULT_STYLE,
): string {
  const evidence = summary.evidence
  if (!evidence || evidence.length === 0) return ""

  const lines: string[] = ["", "Joint Trust Packet", "──────────────────"]

  // Content scan — one block per attached envelope, provider-native and unmerged.
  lines.push("Content scan")
  for (const ev of evidence) {
    const sev = topProviderSeverity(ev)
    const findingsLabel =
      ev.findings.length === 0
        ? "no findings"
        : `${ev.findings.length} finding${ev.findings.length === 1 ? "" : "s"}` +
          (sev ? ` (top severity: ${sev})` : "")
    lines.push(
      `  ${ev.provider} ${ev.providerVersion}  scanMode: ${ev.scanMode}  ` +
        `completeness: ${COMPLETENESS_HINT[ev.completeness]}`,
    )
    lines.push(`    ${findingsLabel}`)
    lines.push(`    raw report digest: ${ev.rawReportDigest}`)
    for (const reason of ev.degradedReasons) {
      lines.push(`    degraded: ${reason}`)
    }
  }

  // Authority scan — CallLint's own verdict, computed without the evidence.
  lines.push("Authority scan")
  lines.push(
    `  CallLint ${toolVersion}  ${verdictTag(summary.verdict, style)}  (${summary.publicVerdictLabel})`,
  )

  // The explained difference (uses the first / most relevant envelope).
  lines.push(whyTheyDiffer(evidence[0]!, summary.verdict))

  return lines.join("\n")
}
