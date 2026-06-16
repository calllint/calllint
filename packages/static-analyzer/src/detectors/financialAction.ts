import type { Evidence, Finding } from "@calllint/types"
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

/**
 * Explicit money-MOVING action verbs. These describe a capability the tool
 * actively performs, not merely a domain it belongs to. Matched against
 * provided tool metadata (name/description), which is OBSERVED model-visible
 * surface — not a name-based domain guess.
 */
const PAYMENT_ACTION_VERBS = [
  "create_payment",
  "create_charge",
  "create payment",
  "make_payment",
  "make payment",
  "send_payment",
  "send money",
  "send_money",
  "transfer_funds",
  "transfer funds",
  "create_payout",
  "create payout",
  "create_transfer",
  "charge_card",
  "charge card",
  "process_payment",
  "process payment",
  "issue_refund",
  "purchase",
  "buy_",
  "place_order",
  "place order",
  "withdraw",
]

function collectHints(text: string | undefined): string[] {
  if (!text) return []
  const lower = text.toLowerCase()
  // Word-ish boundary check to avoid matching substrings inside unrelated words
  // (e.g. "banking" should match "bank", but "embankment" should not match well
  // — we accept the simple includes() and document it as a name-based heuristic).
  return FINANCIAL_HINTS.filter((h) => lower.includes(h))
}

/** Collect explicit payment-action verbs present in a piece of tool metadata. */
function collectActionVerbs(text: string | undefined): string[] {
  if (!text) return []
  const lower = text.toLowerCase()
  return PAYMENT_ACTION_VERBS.filter((v) => lower.includes(v))
}

/**
 * Infers financial-action capability from package, tool names, and provided
 * tool metadata. Two distinct findings, by design (auditability: name-based
 * inference and observed capability must never be conflated):
 *
 *  - `action.financial` (INFERRED, name-based, non-blocking → REVIEW): a name
 *    like "stripe" or "payments" suggests a money domain. Low confidence.
 *
 *  - `action.financial-observed` (OBSERVED, blocking → BLOCK): a provided tool
 *    explicitly exposes a money-MOVING verb (create_payment, transfer_funds,
 *    issue_refund, …) AND the server carries a corroborating capability surface
 *    (credentials, or a network-capable runtime). An autonomous agent calling
 *    such a tool can move money irreversibly, so this is a hard blocker.
 *
 * This is the only producer of the MONEY symbol.
 */
export function detectFinancialAction(ctx: DetectorContext): Finding[] {
  const { server, binding } = ctx
  const findings: Finding[] = []

  // --- OBSERVED: an explicit money-moving tool verb in provided metadata. ---
  const actionEvidence: Evidence[] = []
  const verbs = new Set<string>()
  for (const tool of server.providedTools) {
    for (const v of collectActionVerbs(tool.name)) {
      verbs.add(v)
      actionEvidence.push({ type: "tool-metadata", key: "tool", value: tool.name })
    }
    for (const v of collectActionVerbs(tool.description)) {
      verbs.add(v)
      actionEvidence.push({
        type: "tool-metadata",
        key: tool.name ? `tools.${tool.name}.description` : "tools.description",
        snippet: v,
      })
    }
  }

  if (verbs.size > 0) {
    // Corroborating capability surface: a payment tool that also holds
    // credentials or can reach the network is a live money-movement risk,
    // not just a label. We require one of these to escalate to BLOCK so a
    // bare, capability-less mock cannot trip a hard block on a verb alone.
    const hasSecret = server.envKeys.some((k) =>
      /TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL|AUTH/i.test(k),
    )
    const networkCapable = Boolean(binding.remoteUrl) || binding.runtimeExecutable

    if (hasSecret) {
      actionEvidence.push({ type: "config", key: "env", value: "credential present" })
    }

    if (hasSecret || networkCapable) {
      findings.push({
        id: "action.financial-observed",
        title: "Exposes an observed money-moving action",
        severity: "critical",
        blocker: true,
        symbol: "MONEY",
        riskClass: "S5",
        mode: "OBSERVED",
        confidence: "high",
        detectionMethod: "tool-metadata",
        evidence: actionEvidence,
        impact:
          "A provided tool explicitly performs a financial action (e.g. create a payment, transfer funds, issue a refund) and the server carries credentials or network access. An autonomous agent invoking it could move money irreversibly.",
        fix: "Require explicit human approval for this tool, enforce a hard spending boundary, and never allow autonomous invocation.",
        falsePositiveNote:
          "If the tool only reads payment data (not moves money), reclassify it; this fires on money-moving verbs in the model-visible metadata.",
      })
      // An observed money-mover supersedes the name-based inference; don't
      // also emit the weaker INFERRED finding for the same server.
      return findings
    }
  }

  // --- INFERRED: name-based domain hint only. ---
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

  if (hints.size === 0) return findings

  findings.push({
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
  })

  return findings
}
