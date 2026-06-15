import type { Evidence, Finding } from "@mcpguard/types"
import type { DetectorContext } from "../context.js"

/**
 * Name fragments suggesting financial / irreversible money movement (S5).
 * Kept distinct from generic external-mutation hints: a payout or transfer is
 * not just a side effect, it is potentially irreversible value movement.
 */
const FINANCIAL_HINTS = [
  "stripe",
  "paypal",
  "braintree",
  "adyen",
  "payment",
  "payments",
  "payout",
  "payouts",
  "payroll",
  "charge",
  "invoice",
  "invoicing",
  "billing",
  "refund",
  "transfer",
  "wire",
  "ach",
  "sepa",
  "wallet",
  "coinbase",
  "treasury",
  "bank",
  "checkout",
]

function collectHints(text: string | undefined): string[] {
  if (!text) return []
  const lower = text.toLowerCase()
  // Word-ish boundary check to avoid matching substrings inside unrelated words
  // (e.g. "banking" should match "bank", but "embankment" should not match well
  // — we accept the simple includes() and document it as a name-based heuristic).
  return FINANCIAL_HINTS.filter((h) => lower.includes(h))
}

/**
 * Infers financial-action capability from package or tool names. INFERRED,
 * name-based: a payments integration can move money on the agent's behalf,
 * which is the highest-consequence (S5) and irreversible side effect. This is
 * the only producer of the MONEY symbol; it pushes to REVIEW (not a hard BLOCK)
 * because the inference is name-based and low confidence.
 */
export function detectFinancialAction(ctx: DetectorContext): Finding[] {
  const { server, binding } = ctx
  const hints = new Set<string>()
  const evidence: Evidence[] = []

  for (const h of collectHints(binding.packageName)) {
    hints.add(h)
    evidence.push({
      type: "runtime-binding",
      key: "package",
      value: binding.packageName,
    })
  }
  for (const tool of server.providedTools) {
    for (const h of collectHints(tool.name)) {
      hints.add(h)
      evidence.push({ type: "tool-metadata", key: "tool", value: tool.name })
    }
  }

  if (hints.size === 0) return []

  return [
    {
      id: "action.financial",
      title: "May perform financial or irreversible actions",
      severity: "high",
      blocker: false,
      symbol: "MONEY",
      riskClass: "S5",
      mode: "INFERRED",
      confidence: "low",
      detectionMethod: "package-metadata",
      evidence,
      impact:
        "The server appears to integrate with a payments or financial system and could move money or take irreversible actions on the agent's behalf.",
      fix: "Confirm which financial tools are exposed, require manual approval, and never allow autonomous use without a hard spending boundary.",
      falsePositiveNote:
        "Name-based inference; a read-only reporting integration would not actually move money.",
    },
  ]
}
