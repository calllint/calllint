/**
 * calllint.decision.v0 — Trust-Gateway Policy Decision (object 4 of the six).
 *
 * NOTE: distinct from `decision.ts` (the new4 CompactDecision / reason-code
 * projection attached to every ScanReport). This is the Trust Gateway's
 * DETERMINISTIC verdict computed over an Authority Manifest (object 3) under a
 * policy. It binds three digests — artifact (object 1), authority (object 3),
 * and policy — so a receipt can later prove WHAT was decided over WHICH
 * authority under WHICH policy.
 *
 * Core rule — **Evidence ≠ Decision**: external evidence may add `reasons` or
 * tighten `completeness`, but it can never set the verdict alone, and a
 * degraded/failed external scan never yields SAFE. The verdict comes from the
 * normalized authority + policy, never from a scanner's say-so.
 *
 * Fully deterministic: no clock, no I/O. `digest` = hashJson over the object
 * minus its own `digest`. See ADR 0035 / 0036 and schemas/decision.schema.json.
 */
import type { Verdict } from "./verdict.js"
import type { ReasonCode } from "./reasonCodes.js"
import type { AuthorityCompleteness } from "./authority.js"

/**
 * One reason a verdict landed where it did. `code` is drawn from the frozen
 * 12-code public vocabulary (ADR 0020) so agents/CI/badges read a stable
 * language. `evidenceSource` cites the byte that grounds it (e.g. "server.url",
 * "SKILL.md:42") — a decision reason is never unsourced.
 */
export interface DecisionReason {
  code: ReasonCode
  /** Provenance for this reason: the capability's evidenceSource. Never empty. */
  evidenceSource: string
  /** Verdict this reason contributes on its own (before aggregation). */
  contributes: Verdict
}

export interface TrustDecision {
  schema: "calllint.decision.v0"
  /** Object-1 digest (artifact). null only when decided over an unpinned target. */
  artifactDigest: string | null
  /** Object-3 digest (authority manifest). Binds the exact inventory decided over. */
  authorityDigest: string
  /** Digest of the policy applied (hashJson over the Policy object). */
  policyDigest: string
  /** Digests of any external evidence factored in (sorted, deduped). Provenance only. */
  evidenceDigests: string[]
  /** The deterministic verdict: SAFE | REVIEW | BLOCK | UNKNOWN. */
  verdict: Verdict
  /** Sourced reasons, deterministically ordered. */
  reasons: DecisionReason[]
  /** Normalized approval labels this decision would require before apply (sorted, deduped). */
  requiredApprovals: string[]
  /** Gaps that kept the decision from being fully grounded (so silence never reads as SAFE). */
  unknowns: string[]
  /** Whether the decision was made over complete authority + evidence, or partial. */
  completeness: AuthorityCompleteness
  /** sha256 over this object minus `digest` (hashJson). */
  digest: `sha256:${string}`
}

export const DECISION_SCHEMA_VERSION = "calllint.decision.v0" as const
