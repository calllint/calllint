/**
 * calllint.apply-result.v1 — the outcome of `trust apply` (G6).
 *
 * `trust apply` is the ONLY writer in CallLint. It takes an approved Install Plan
 * and drives AWAITING_APPROVAL → REVALIDATING → APPLIED → VERIFIED, or lands in a
 * terminal failure (PLAN_STALE · APPLY_CONFLICT · ROLLBACK_REQUIRED ·
 * VERIFICATION_FAILED). This object records what actually happened on disk so a
 * receipt (G7) can prove it. It is produced AFTER I/O — not a plan, an outcome.
 *
 * Invariants (ADR 0036 / 0037):
 * - `outcome: "applied"` ⇒ the config was written atomically AND re-verified.
 * - a stale/conflicting plan is NEVER applied (fail-closed before any write).
 * - a failed verify ⇒ rollback is attempted; `rolledBack` records whether the
 *   original bytes were restored (digest match), never a silent half-write.
 */
import type { TrustPrepareState } from "./trustGateway.js"

export type ApplyOutcome =
  | "applied" // written + verified
  | "already_applied" // idempotent no-op (plan already in effect)
  | "stale" // upstream/plan digest or expiry mismatch → PLAN_STALE
  | "conflict" // target config drifted since planning → APPLY_CONFLICT
  | "rolled_back" // apply happened but verify failed → original restored
  | "rollback_failed" // verify failed AND restore failed → ROLLBACK_REQUIRED (worst)

export interface ApplyResult {
  schema: "calllint.apply-result.v1"
  /** Where the apply-half state machine stopped. */
  state: TrustPrepareState
  outcome: ApplyOutcome
  /** The plan that was applied (its sealed digest — the approval bound this). */
  planId: string
  planDigest: `sha256:${string}`
  /** Host + config path that was (or would have been) written. */
  host: string
  configPath: string
  /** sha256 of the config bytes BEFORE apply (or "absent"). */
  configDigestBefore: `sha256:${string}` | "absent"
  /** sha256 of the config bytes AFTER a successful apply; null otherwise. */
  configDigestAfter: `sha256:${string}` | null
  /** Backup file written before the change (null when nothing was written). */
  backupPath: string | null
  /** True only when a verify failure triggered a restore that matched the original digest. */
  rolledBack: boolean
  /** Human-readable trail of every transition + guard decision. */
  notes: string[]
  /** ISO-8601 UTC, injected from the CLI edge. */
  appliedAt: string
}

export const APPLY_RESULT_SCHEMA = "calllint.apply-result.v1" as const
