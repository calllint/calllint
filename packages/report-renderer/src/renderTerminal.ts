import type { ConfigSummaryReport, Finding, ScanReport } from "@mcpguard/types"
import { RISK_CLASS_LABEL } from "@mcpguard/types"
import {
  DEFAULT_STYLE,
  symbolList,
  verdictTag,
  type RenderStyle,
} from "./style.js"

function renderFindingLine(f: Finding): string[] {
  const lines: string[] = []
  const flag = f.blocker ? "[BLOCKER] " : ""
  lines.push(`  • ${flag}${f.title}  (${f.id}, ${f.mode.toLowerCase()}, confidence ${f.confidence})`)
  if (f.evidence.length > 0) {
    const e = f.evidence[0]!
    const ev = e.value ?? e.snippet ?? e.key ?? e.path ?? ""
    lines.push(`      evidence: ${e.key ?? e.type}${ev ? ` = ${ev}` : ""}`)
  }
  lines.push(`      impact: ${f.impact}`)
  lines.push(`      fix: ${f.fix}`)
  return lines
}

function renderServer(r: ScanReport, style: RenderStyle): string[] {
  const lines: string[] = []
  lines.push("")
  lines.push(`${verdictTag(r.verdict, style)}  ${r.target.name}    ${symbolList(r.symbols, style)}`)
  lines.push(`  ${r.riskClass} ${RISK_CLASS_LABEL[r.riskClass]} · reproducibility ${r.reproducibility.level} · confidence ${r.confidence}`)
  lines.push(`  ${r.summary}`)

  if (r.policyApplied) {
    const note = r.diagnostics.find((d) => d.code === "policy.applied")
    if (note) lines.push(`  ⚑ ${note.message}`)
  }

  const top = r.topFindings
  if (top.length > 0) {
    lines.push("")
    for (const f of top) lines.push(...renderFindingLine(f))
  }

  if (r.reproducibility.reasons.length > 0) {
    lines.push("")
    lines.push(`  reproducibility notes: ${r.reproducibility.reasons.join("; ")}`)
  }

  lines.push("")
  lines.push(`  autonomous use: ${r.policy.autonomousUse} · manual approval: ${r.policy.manualApproval} · sandbox: ${r.policy.sandbox}`)
  return lines
}

/**
 * Full terminal report. Verdict-first, evidence-backed, one card per server.
 */
export function renderTerminal(
  summary: ConfigSummaryReport,
  style: RenderStyle = DEFAULT_STYLE,
): string {
  const lines: string[] = []
  lines.push("MCPGuard scan")
  lines.push(`config: ${summary.configPath}`)
  lines.push(
    `result: ${verdictTag(summary.verdict, style)}   ` +
      `(BLOCK ${summary.counts.BLOCK} · UNKNOWN ${summary.counts.UNKNOWN} · REVIEW ${summary.counts.REVIEW} · SAFE ${summary.counts.SAFE})`,
  )
  lines.push("─".repeat(60))
  for (const r of summary.reports) lines.push(...renderServer(r, style))
  return lines.join("\n")
}
