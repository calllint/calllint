import type { Finding, RiskClass, RuntimeBinding } from "@calllint/types"
import { highestRiskClass } from "@calllint/types"

/**
 * Compute the risk class for a server from its findings and runtime binding.
 *
 * The class reflects the capability surface, derived primarily from findings.
 * A server with no findings sits at the S1 read-only floor (it is an active
 * server, not pure metadata). Findings raise the class to their highest level.
 */
export function computeRiskClass(
  findings: Finding[],
  binding: RuntimeBinding,
): RiskClass {
  const classes: RiskClass[] = findings.map((f) => f.riskClass)
  if (classes.length === 0) {
    return binding.runtimeExecutable || binding.remoteUrl ? "S1" : "S0"
  }
  return highestRiskClass(classes)
}
