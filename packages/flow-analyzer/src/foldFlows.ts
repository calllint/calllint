import type { DecisionReason, Flow, Verdict } from "@calllint/types"

/**
 * foldFlowsIntoReasons (F4) — project static toxic-flows onto `calllint.decision.v0`
 * `reasons` (ADR 0040 §1 / ADR 0044). A flow FEEDS the verdict; it is never a second
 * verdict.
 *
 * Only a flow whose `decisionHint` is `BLOCK` or `REVIEW` contributes — an `ALLOW` flow
 * adds nothing, exactly as a benign capability adds nothing. Each contributing flow
 * becomes one `DecisionReason` with:
 *   - `code`: the appended public code `TOXIC_FLOW_COMPOSITION` (ADR 0044),
 *   - `contributes`: the flow's hint mapped to a verdict (BLOCK→BLOCK, REVIEW→REVIEW),
 *   - `evidenceSource`: the flow's `flowId` + its first evidence byte, so the reason is
 *     sourced (I-07) and points back at the exact composition.
 *
 * The caller (`decideOverAuthority`, wired at the edge) aggregates these with the SAME
 * `mostSevereVerdict` rule as every other reason: a dangerous flow raises the verdict to
 * at least its `contributes` level and can never lower one (I-04). PURE & DETERMINISTIC:
 * no clock, no I/O; input flows (already digest-stable) → byte-identical reasons.
 */

/** Map a flow's decisionHint to the verdict it contributes. ALLOW contributes nothing (filtered out). */
function hintToVerdict(hint: Flow["decisionHint"]): Verdict | null {
  switch (hint) {
    case "BLOCK":
      return "BLOCK"
    case "REVIEW":
      return "REVIEW"
    default:
      return null // ALLOW → no contribution
  }
}

/**
 * Project flows onto decision reasons. Returns a deterministically-ordered,
 * deduplicated list of `TOXIC_FLOW_COMPOSITION` reasons (empty when no flow is
 * BLOCK/REVIEW). Order: by `evidenceSource` then severity, matching the decision layer's
 * own reason ordering so the merged set stays stable.
 */
export function foldFlowsIntoReasons(flows: readonly Flow[]): DecisionReason[] {
  const byKey = new Map<string, DecisionReason>()

  for (const flow of flows) {
    const contributes = hintToVerdict(flow.decisionHint)
    if (contributes === null) continue // ALLOW flows never appear

    // Source the reason at the composition: flowId + the first evidence byte. Never empty
    // (a flow always carries evidence, I-07); fall back to the flowId alone if somehow bare.
    const firstEvidence = flow.evidence[0]
    const evidenceSource = firstEvidence ? `${flow.flowId} (${firstEvidence})` : flow.flowId

    const reason: DecisionReason = {
      code: "TOXIC_FLOW_COMPOSITION",
      evidenceSource,
      contributes,
    }

    // Dedupe by (evidenceSource); keep the most severe contribution if two collide.
    const prev = byKey.get(evidenceSource)
    if (!prev || severity(contributes) > severity(prev.contributes)) {
      byKey.set(evidenceSource, reason)
    }
  }

  return [...byKey.values()].sort(
    (a, b) => cmp(a.evidenceSource, b.evidenceSource) || severity(b.contributes) - severity(a.contributes),
  )
}

/** Local severity rank (BLOCK > REVIEW). Only BLOCK/REVIEW ever reach here. */
function severity(v: Verdict): number {
  return v === "BLOCK" ? 3 : v === "UNKNOWN" ? 2 : v === "REVIEW" ? 1 : 0
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
