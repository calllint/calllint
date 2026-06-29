import type { ApprovedDriftReport } from "@calllint/types"

/** Machine-readable approved-drift report. Stable, emoji-free contract. */
export function renderApprovedDriftJson(report: ApprovedDriftReport): string {
  return JSON.stringify(report, null, 2)
}

const STATUS_TAG: Record<string, string> = {
  unchanged: "OK   ",
  "hash-changed": "HASH ",
  "verdict-changed": "VRDCT",
  added: "ADD  ",
  removed: "DEL  ",
}

/**
 * Human-readable approved-drift report (ADR 0024). Leads with the headline then
 * one line per surface. Plain text, CI-friendly. Drift never reads as SAFE.
 */
export function renderApprovedDrift(report: ApprovedDriftReport): string {
  const lines: string[] = []
  lines.push("CallLint verify (drift vs approved state)")

  const headline = report.drifted
    ? `DRIFT — approved capability surface changed (${report.verdict})`
    : "no drift — matches approved state"
  lines.push(`result: ${headline}`)
  lines.push("─".repeat(60))

  for (const e of report.entries) {
    const tag = STATUS_TAG[e.status] ?? e.status
    lines.push(`${tag}  ${e.surface}`)
    if (e.status === "hash-changed") {
      lines.push(`        • ${e.approvedHash} → ${e.currentHash}`)
    } else if (e.status === "verdict-changed") {
      lines.push(`        • verdict ${e.approvedVerdict} → ${e.currentVerdict}`)
    } else if (e.status === "added") {
      lines.push(`        • new surface, not in approved state (${e.currentVerdict})`)
    } else if (e.status === "removed") {
      lines.push(`        • approved surface no longer present`)
    }
  }

  return lines.join("\n")
}
