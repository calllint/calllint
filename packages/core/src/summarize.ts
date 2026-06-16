import type { RiskAssessment } from "@calllint/risk-engine"
import type { Verdict } from "@calllint/types"
import { RISK_CLASS_LABEL, RISK_SYMBOL_LABEL } from "@calllint/types"

/** A one-line human summary for a server report. Deterministic, no LLM. */
export function summarize(
  name: string,
  verdict: Verdict,
  a: RiskAssessment,
  policyApplied: boolean,
): string {
  const symbolText =
    a.symbols.length > 0
      ? a.symbols.map((s) => RISK_SYMBOL_LABEL[s]).join(", ")
      : "no risk surface observed"

  const cls = `${a.riskClass} ${RISK_CLASS_LABEL[a.riskClass]}`

  switch (verdict) {
    case "BLOCK":
      return policyApplied
        ? `"${name}" would be blocked but was downgraded by policy. Risk: ${symbolText} (${cls}).`
        : `"${name}" is blocked. Risk: ${symbolText} (${cls}).`
    case "UNKNOWN":
      return `"${name}" could not be verified (insufficient evidence). Risk: ${symbolText} (${cls}).`
    case "REVIEW":
      return `"${name}" needs review. Risk: ${symbolText} (${cls}).`
    case "SAFE":
      return `"${name}" has no blockers observed (${cls}).`
  }
}
