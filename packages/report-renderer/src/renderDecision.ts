import type { CompactDecision, NextAction, Verdict } from "@calllint/types"
import { REASON_CODE_META } from "@calllint/types"
import { DEFAULT_STYLE, verdictTag, type RenderStyle } from "./style.js"

// ---------------------------------------------------------------------------
// P1.7 — Compact decision renderer (new4 L2 default output — ADR 0020).
//
// The default human+agent view: ≤30 lines for a single surface. Renders a
// CompactDecision (verdict + reason codes + next action), not the rich
// ScanReport (which is the Evidence layer behind --explain).
// ---------------------------------------------------------------------------

const NEXT_ACTION_HINT: Record<NextAction, string> = {
  continue: "No blockers observed — safe to continue.",
  ask_before_continue: "Review required — confirm before continuing.",
  stop: "Blocked — do not proceed without resolving the blocker.",
  gather_more_evidence: "Insufficient evidence — gather more before continuing.",
}

/** Surface label, trimmed to keep the compact view tidy. */
function shortSurface(surface: string): string {
  return surface.length > 60 ? "…" + surface.slice(-59) : surface
}

/**
 * Render a single compact decision. ≤ ~6 lines: a verdict line, the reason
 * codes, and the next-action hint.
 */
export function renderDecision(
  decision: CompactDecision,
  style: RenderStyle = DEFAULT_STYLE,
): string {
  const lines: string[] = []
  lines.push(`${verdictTag(decision.verdict, style)} ${shortSurface(decision.surface)}`)

  if (decision.reasonCodes.length > 0) {
    lines.push(`Reasons: ${decision.reasonCodes.join(", ")}`)
  } else {
    lines.push("Reasons: none observed")
  }

  lines.push(`Next: ${NEXT_ACTION_HINT[decision.nextAction]}`)
  return lines.join("\n")
}

/**
 * Render many decisions as a scan-all table. One line per surface plus a header
 * count. Stays compact for repo-wide views.
 */
export function renderDecisionTable(
  decisions: CompactDecision[],
  style: RenderStyle = DEFAULT_STYLE,
): string {
  if (decisions.length === 0) {
    return "0 agent-tool surfaces found"
  }
  const lines: string[] = [
    `${decisions.length} agent-tool surface${decisions.length === 1 ? "" : "s"} found`,
    "",
  ]
  for (const d of decisions) {
    const codes = d.reasonCodes.length > 0 ? d.reasonCodes.join(", ") : "no blockers observed"
    lines.push(`${verdictTag(d.verdict, style)}\t${shortSurface(d.surface)}\t${codes}`)
  }
  return lines.join("\n")
}

/** Reason-code label lookup for callers that want the human label. */
export function reasonCodeLabel(code: keyof typeof REASON_CODE_META): string {
  return REASON_CODE_META[code].label
}

export type { Verdict }
