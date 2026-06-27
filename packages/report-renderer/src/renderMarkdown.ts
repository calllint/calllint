import type {
  ConfigSummaryReport,
  Finding,
  RecommendedPolicy,
  ScanReport,
  Verdict,
} from "@calllint/types"

/**
 * Render a config scan as GitHub-flavored Markdown for PR comments / the
 * GitHub Step Summary ($GITHUB_STEP_SUMMARY). Human-readable companion to the
 * machine SARIF output: a reviewer should understand the verdict, why, and the
 * fix without opening the SARIF or the JSON.
 *
 * Derived purely from the ScanReport contract and emoji-free (CI logs and the
 * step summary render plain text reliably). Deterministic: no timestamps beyond
 * the report's own generatedAt, stable ordering from the report arrays.
 *
 * Every section maps to a required PR-gate element:
 *   verdict · server · risk class · evidence · why it matters · fix ·
 *   policy recommendation · safety caveat.
 */
export function renderMarkdown(summary: ConfigSummaryReport): string {
  const out: string[] = []
  const c = summary.counts

  out.push(`## CallLint: ${summary.verdict} — ${summary.publicVerdictLabel}`)
  out.push("")
  out.push(
    `CallLint statically checked \`${summary.configPath}\` before the agent tool runs. ` +
      `It never executes, installs, or connects to the server it judges.`,
  )
  out.push("")

  // Per-server summary table — the 5-second view.
  out.push("| Server | Verdict | Risk class | Findings |")
  out.push("| --- | --- | --- | --- |")
  for (const r of summary.reports) {
    out.push(
      `| ${mdCell(r.target.name)} | ${r.verdict} | ${r.riskClass} | ${r.findings.length} |`,
    )
  }
  out.push(
    `| **TOTAL** | **${summary.verdict}** | — | BLOCK ${c.BLOCK} · UNKNOWN ${c.UNKNOWN} · REVIEW ${c.REVIEW} · SAFE ${c.SAFE} |`,
  )
  out.push("")

  // Per-server detail: findings (why + fix + evidence) and policy recommendation.
  for (const r of summary.reports) {
    renderServer(out, r)
  }

  // Safety caveat — never overclaim. Mirrors the project trust line.
  out.push("---")
  out.push("")
  out.push(
    "> CallLint does not prove runtime safety. `SAFE` means no blockers " +
      "observed under current evidence; `UNKNOWN` is never `SAFE`. Verdicts are " +
      "heuristic decision support, not a safety guarantee.",
  )

  return out.join("\n")
}

function renderServer(out: string[], r: ScanReport): void {
  out.push(`### ${r.target.name} — ${r.verdict}`)
  out.push("")
  if (r.summary) {
    out.push(r.summary)
    out.push("")
  }

  if (r.findings.length === 0) {
    out.push("_No findings._")
    out.push("")
  } else {
    for (const f of r.findings) {
      renderFinding(out, f)
    }
  }

  renderRecommendation(out, r.policy)
  out.push("")
}

function renderFinding(out: string[], f: Finding): void {
  const tag = f.blocker ? "BLOCKER" : f.severity.toUpperCase()
  out.push(`#### ${tag}: ${f.title}`)
  out.push("")
  out.push(`- Risk: ${f.symbol} · ${f.riskClass} · ${f.mode} · confidence ${f.confidence}`)

  const ev = f.evidence[0]
  if (ev) {
    const loc = ev.path ? ` \`${ev.path}\`${ev.line ? `:${ev.line}` : ""}` : ""
    const shown = ev.snippet ?? ev.value ?? ev.key
    out.push(`- Evidence:${loc}`)
    if (shown) {
      out.push("")
      out.push("  ```text")
      for (const line of String(shown).split("\n")) out.push(`  ${line}`)
      out.push("  ```")
    }
  }

  out.push("")
  out.push(`Why it matters: ${f.impact}`)
  out.push("")
  out.push(`Recommended fix: ${f.fix}`)
  if (f.falsePositiveNote) {
    out.push("")
    out.push(`Note: ${f.falsePositiveNote}`)
  }
  out.push("")
}

function renderRecommendation(out: string[], p: RecommendedPolicy): void {
  out.push("Policy recommendation:")
  out.push(`- Autonomous use: ${p.autonomousUse}`)
  out.push(`- Manual approval: ${p.manualApproval}`)
  out.push(`- Sandbox: ${p.sandbox}`)
}

/** Escape pipes/newlines so a value never breaks a Markdown table row. */
function mdCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ")
}

// Re-exported verdict type kept for callers that narrow on it.
export type { Verdict }
