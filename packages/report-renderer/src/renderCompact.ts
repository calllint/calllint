import type { ConfigSummaryReport } from "@mcpguard/types"
import { DEFAULT_STYLE, symbolList, verdictTag, type RenderStyle } from "./style.js"

/**
 * One line per server — the 1-second view. Designed to fit a terminal width.
 * Example: "⛔ BLOCK   filesystem    📁 FILES   S2 Sensitive read"
 */
export function renderCompact(
  summary: ConfigSummaryReport,
  style: RenderStyle = DEFAULT_STYLE,
): string {
  const lines: string[] = []
  for (const r of summary.reports) {
    lines.push(
      `${verdictTag(r.verdict, style)}\t${r.target.name}\t${symbolList(r.symbols, style)}\t${r.riskClass}`,
    )
  }
  lines.push(
    `${verdictTag(summary.verdict, style)}\tTOTAL\tBLOCK ${summary.counts.BLOCK} · UNKNOWN ${summary.counts.UNKNOWN} · REVIEW ${summary.counts.REVIEW} · SAFE ${summary.counts.SAFE}`,
  )
  return lines.join("\n")
}
