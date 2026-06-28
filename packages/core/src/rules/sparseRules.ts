import type { Finding, NextAction, ReasonCode, Verdict } from "@calllint/types"
import { VERDICT_NEXT_ACTION } from "@calllint/types"
import { findingsToReasonCodes } from "./reasonCodes.js"

// ---------------------------------------------------------------------------
// P1.3 — Sparse Risk Kernel (new4 L2 — ADR 0020).
//
// Combines the already-computed verdict (from the risk engine, unchanged) with
// the reason-code projection and the deterministic next action. This does NOT
// recompute risk — the verdict is passed in. The kernel only names why and what
// to do next, in stable language.
// ---------------------------------------------------------------------------

export interface SparseDecision {
  verdict: Verdict
  reasonCodes: ReasonCode[]
  nextAction: NextAction
}

/**
 * Build the sparse decision from the engine verdict + findings. UNKNOWN never
 * maps to `continue` (enforced by VERDICT_NEXT_ACTION; ADR 0020).
 */
export function sparseDecision(
  verdict: Verdict,
  findings: Finding[],
): SparseDecision {
  return {
    verdict,
    reasonCodes: findingsToReasonCodes(findings),
    nextAction: VERDICT_NEXT_ACTION[verdict],
  }
}
