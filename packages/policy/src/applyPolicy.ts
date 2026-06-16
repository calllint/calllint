import type { Finding, Policy, Verdict } from "@calllint/types"
import { isOverrideActive } from "./validatePolicy.js"

export interface PolicyDecision {
  /** Verdict after applying policy. */
  verdict: Verdict
  /** True when policy changed the verdict from the engine's raw verdict. */
  changed: boolean
  /** Human-readable note when a decision was made by policy. */
  note?: string
}

/**
 * Apply policy to a raw engine verdict for one server.
 *
 * v0.1 behavior:
 *  - An active, valid override for this target whose `allow` set covers all of
 *    the server's blocking risk symbols downgrades BLOCK → REVIEW (never SAFE).
 *  - Everything else passes through unchanged.
 *
 * Overrides are assumed pre-validated (see validatePolicy). `now` is injected so
 * the function stays pure/testable.
 */
export function applyPolicy(
  rawVerdict: Verdict,
  serverName: string,
  blockingFindings: Finding[],
  policy: Policy,
  now: number,
): PolicyDecision {
  if (rawVerdict !== "BLOCK") {
    return { verdict: rawVerdict, changed: false }
  }

  const override = policy.overrides.find(
    (o) => o.target === serverName && isOverrideActive(o, now),
  )
  if (!override) return { verdict: rawVerdict, changed: false }

  const allowed = new Set(override.allow ?? [])
  const blockingSymbols = new Set(
    blockingFindings.filter((f) => f.blocker).map((f) => f.symbol),
  )
  const allCovered = [...blockingSymbols].every((s) => allowed.has(s))
  if (!allCovered) return { verdict: rawVerdict, changed: false }

  return {
    verdict: "REVIEW",
    changed: true,
    note: `Policy decision: override for "${serverName}" (expires ${override.expiresAt}) — ${override.reason}`,
  }
}

/** Decide whether a verdict should fail a CI run under the policy. */
export function shouldFailCi(verdict: Verdict, policy: Policy): boolean {
  if (verdict === "REVIEW") return policy.ci.failOnReview
  return policy.ci.failOn.includes(verdict)
}
