import type { Finding, ScanReport } from "@calllint/types"
import { RISK_CLASS_LABEL, RISK_SYMBOL_LABEL } from "@calllint/types"
import { DEFAULT_STYLE, verdictTag, type RenderStyle } from "./style.js"

function renderFindingDetail(f: Finding, n: number): string[] {
  const lines: string[] = []
  lines.push(`${n}. ${f.title}  ${f.blocker ? "[BLOCKER]" : ""}`)
  lines.push(`   id:         ${f.id}`)
  lines.push(`   symbol:     ${RISK_SYMBOL_LABEL[f.symbol]} (${f.symbol})`)
  lines.push(`   class:      ${f.riskClass} ${RISK_CLASS_LABEL[f.riskClass]}`)
  lines.push(`   severity:   ${f.severity}`)
  lines.push(`   mode:       ${f.mode}   confidence: ${f.confidence}`)
  lines.push(`   method:     ${f.detectionMethod}`)
  if (f.evidence.length > 0) {
    lines.push(`   evidence:`)
    for (const e of f.evidence) {
      const loc = [e.path, e.line ? `:${e.line}` : ""].filter(Boolean).join("")
      const detail = e.value ?? e.snippet ?? ""
      lines.push(`     - [${e.type}] ${e.key ?? ""}${detail ? ` = ${detail}` : ""}${loc ? `  (${loc})` : ""}`)
    }
  }
  lines.push(`   impact:     ${f.impact}`)
  lines.push(`   fix:        ${f.fix}`)
  if (f.falsePositiveNote) lines.push(`   note:       ${f.falsePositiveNote}`)
  return lines
}

/**
 * Deep explanation for a single server report: every finding with full evidence,
 * fingerprints, and the recommended policy. Used by `calllint explain`.
 */
export function renderExplain(
  r: ScanReport,
  style: RenderStyle = DEFAULT_STYLE,
): string {
  const lines: string[] = []
  lines.push(`${verdictTag(r.verdict, style)}  ${r.target.name}`)
  lines.push(`label:   ${r.publicVerdictLabel}`)
  lines.push(`source:  ${r.target.source ?? "—"}${r.target.version ? `@${r.target.version}` : ""}`)
  lines.push(`class:   ${r.riskClass} ${RISK_CLASS_LABEL[r.riskClass]}`)
  lines.push(`symbols: ${r.symbols.length ? r.symbols.map((s) => RISK_SYMBOL_LABEL[s]).join(", ") : "none"}`)
  lines.push(`repro:   ${r.reproducibility.level}${r.reproducibility.reasons.length ? ` (${r.reproducibility.reasons.join("; ")})` : ""}`)
  lines.push("")
  lines.push(r.summary)

  if (r.findings.length > 0) {
    lines.push("")
    lines.push("Findings")
    lines.push("─".repeat(60))
    r.findings.forEach((f, i) => {
      lines.push(...renderFindingDetail(f, i + 1))
      lines.push("")
    })
  } else {
    lines.push("")
    lines.push("No findings.")
  }

  lines.push("Recommended policy")
  lines.push("─".repeat(60))
  lines.push(`autonomous use:  ${r.policy.autonomousUse}`)
  lines.push(`manual approval: ${r.policy.manualApproval}`)
  lines.push(`sandbox:         ${r.policy.sandbox}`)
  lines.push("")
  lines.push("Fingerprints")
  lines.push("─".repeat(60))
  lines.push(`config:      ${r.fingerprints.configHash}`)
  lines.push(`target spec: ${r.fingerprints.targetSpecHash}`)
  lines.push(`risk surface:${r.fingerprints.riskSurfaceHash}`)
  if (r.fingerprints.packageSpecHash) lines.push(`package:     ${r.fingerprints.packageSpecHash}`)

  return lines.join("\n")
}
