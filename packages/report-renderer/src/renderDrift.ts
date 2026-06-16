import type { DriftReport } from "@calllint/types"

/** Machine-readable drift report. Stable, emoji-free contract. */
export function renderDriftJson(report: DriftReport): string {
  return JSON.stringify(report, null, 2)
}

const STATUS_TAG: Record<string, string> = {
  unchanged: "OK   ",
  "config-changed": "CFG  ",
  "risk-surface-changed": "RISK ",
  "verdict-changed": "VRDCT",
  "package-changed": "RUG! ",
  added: "ADD  ",
  removed: "DEL  ",
}

/**
 * Human-readable drift report. Leads with the headline (drift / rug-pull) then
 * one line per server, with reasons indented. Plain text, CI-friendly.
 */
export function renderDrift(report: DriftReport): string {
  const lines: string[] = []
  lines.push("CallLint verify (drift vs baseline)")
  lines.push(`config: ${report.configPath}`)

  const headline = report.rugPullDetected
    ? "RUG-PULL SIGNAL — package/source changed since baseline"
    : report.drifted
      ? "DRIFT — risk surface changed since baseline"
      : "no drift — matches baseline"
  lines.push(`result: ${headline}`)
  lines.push("─".repeat(60))

  for (const e of report.entries) {
    const tag = STATUS_TAG[e.status] ?? e.status
    lines.push(`${tag}  ${e.server}`)
    for (const reason of e.reasons) {
      lines.push(`        • ${reason}`)
    }
  }

  return lines.join("\n")
}
