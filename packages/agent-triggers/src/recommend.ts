/**
 * Core recommend-policy (new11 P2, PR-10) — bound by ADR 0051.
 *
 * Maps an ALREADY-COMPUTED deterministic verdict onto a preflight recommendation
 * that a distribution surface (plugin hook, `calllint integrate`, CI PR review)
 * may display. This module is DISPLAY-ONLY and NON-BLOCKING:
 *
 *   - It never computes or re-computes a verdict. The `Verdict` in is produced
 *     by `@calllint/risk-engine` `computeVerdict`; here we only translate it.
 *   - It never returns "block the action". The strongest recommendation is
 *     `stop-and-confirm` — advice to a human, not an enforced veto (ADR 0051 §1).
 *   - UNKNOWN and "no verdict yet" are surfaced as themselves; UNKNOWN is never
 *     rendered as SAFE (ADR 0010 / project principle 2).
 *
 * Runtime *blocking* enforcement stays deferred to ADR 0042 / H3 and is
 * intentionally not representable in this type.
 */
import type { Verdict } from "@calllint/types"

/**
 * What a preflight surface should advise. All four are non-blocking; they differ
 * only in how much human attention they ask for. There is deliberately no
 * "deny"/"block" member — enforcement is out of P2 scope (ADR 0051 §4).
 */
export const RECOMMENDATIONS = [
  "proceed", // SAFE — no blockers observed; proceed (state that, don't gate)
  "review", // REVIEW — human confirmation advised before autonomous use
  "gather-evidence", // UNKNOWN — surface could not be verified; get more evidence, never treat as SAFE
  "stop-and-confirm", // BLOCK — a policy/rule blocked it; strongly advise stopping, but do not force it
] as const

export type Recommendation = (typeof RECOMMENDATIONS)[number]

/**
 * The result of a preflight recommendation. Carries the source verdict verbatim
 * so a renderer can show it, plus a stable, human-facing line. `blocking` is
 * hard-coded `false` — it exists so downstream code and tests can assert the
 * ADR 0051 invariant structurally, not so it can ever be `true` in P2.
 */
export interface PreflightRecommendation {
  /** The verdict this recommendation was derived from; null = not scanned yet. */
  readonly verdict: Verdict | null
  readonly recommendation: Recommendation
  /** Stable, one-line human-facing guidance. No secrets, no invented cause. */
  readonly guidance: string
  /**
   * Always false in P2. Structural guarantee of ADR 0051: the preflight surface
   * never blocks. A future H3 blocking rung (ADR 0042) would be a SEPARATE type.
   */
  readonly blocking: false
}

const GUIDANCE: Record<Recommendation, string> = {
  proceed: "No blockers observed under current evidence. Proceeding; this is not a proof of runtime safety.",
  review: "Human confirmation advised before autonomous use. Review the findings and evidence first.",
  "gather-evidence":
    "Surface could not be verified statically. Gather more evidence before relying on this — UNKNOWN is never SAFE.",
  "stop-and-confirm":
    "A policy or rule blocked this. Strongly advised to stop and confirm; CallLint does not force the action.",
}

const VERDICT_TO_RECOMMENDATION: Record<Verdict, Recommendation> = {
  SAFE: "proceed",
  REVIEW: "review",
  UNKNOWN: "gather-evidence",
  BLOCK: "stop-and-confirm",
}

/**
 * Translate an existing verdict into a non-blocking preflight recommendation.
 * When `verdict` is null (the target has no prior scan / no baked verdict), the
 * recommendation is `gather-evidence` — the absence of a verdict is treated
 * exactly like UNKNOWN, never as SAFE (ADR 0051 §3).
 */
export function recommendFromVerdict(verdict: Verdict | null): PreflightRecommendation {
  if (verdict === null) {
    return {
      verdict: null,
      recommendation: "gather-evidence",
      guidance:
        "Not yet scanned — no verdict exists for this target. Run `calllint scan` before relying on it; absence of a verdict is never SAFE.",
      blocking: false,
    }
  }
  const recommendation = VERDICT_TO_RECOMMENDATION[verdict]
  return {
    verdict,
    recommendation,
    guidance: GUIDANCE[recommendation],
    blocking: false,
  }
}
