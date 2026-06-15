import type {
  Confidence,
  Finding,
  RecommendedPolicy,
  Reproducibility,
  RiskClass,
  RiskSymbol,
  RuntimeBinding,
  Verdict,
} from "@mcpguard/types"
import { computeRiskClass } from "./computeRiskClass.js"
import {
  computeConfidence,
  computeRecommendedPolicy,
  computeVerdict,
} from "./computeVerdict.js"
import { computeReproducibility } from "./computeReproducibility.js"

export interface RiskAssessment {
  verdict: Verdict
  riskClass: RiskClass
  symbols: RiskSymbol[]
  confidence: Confidence
  reproducibility: Reproducibility
  policy: RecommendedPolicy
  observed: Finding[]
  inferred: Finding[]
  topFindings: Finding[]
}

const SEVERITY_RANK: Record<Finding["severity"], number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

function uniqueSymbols(findings: Finding[]): RiskSymbol[] {
  const seen = new Set<RiskSymbol>()
  const out: RiskSymbol[] = []
  for (const f of findings) {
    if (!seen.has(f.symbol)) {
      seen.add(f.symbol)
      out.push(f.symbol)
    }
  }
  return out
}

function rankFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    if (a.blocker !== b.blocker) return a.blocker ? -1 : 1
    return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
  })
}

/**
 * The deterministic risk engine entry point: takes findings + runtime binding,
 * returns a complete assessment. Pure and side-effect free.
 */
export function assessServer(
  findings: Finding[],
  binding: RuntimeBinding,
): RiskAssessment {
  const verdict = computeVerdict(findings, binding)
  const riskClass = computeRiskClass(findings, binding)
  const symbols = uniqueSymbols(rankFindings(findings))
  const confidence = computeConfidence(findings)
  const reproducibility = computeReproducibility(binding, findings)
  const policy = computeRecommendedPolicy(verdict, findings)

  return {
    verdict,
    riskClass,
    symbols,
    confidence,
    reproducibility,
    policy,
    observed: findings.filter((f) => f.mode === "OBSERVED"),
    inferred: findings.filter((f) => f.mode === "INFERRED"),
    topFindings: rankFindings(findings).slice(0, 3),
  }
}
