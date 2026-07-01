import type { Verdict } from "@calllint/types"

/**
 * `calllint.receipt.v0` — a local, unsigned receipt (ADR 0028).
 *
 * A receipt is a *reporting layer* over an existing `ScanReport`. It proves that
 * a specific CallLint version produced a specific verdict over a specific
 * normalized input under a specific policy/ruleset context. It NEVER re-scans,
 * re-judges, executes a target, or contacts the network. It is not a proof of
 * runtime safety and never certifies a tool.
 *
 * The `trust_boundaries` literals below are the type-level encoding of the
 * project invariants: the fields that must always be `false` are `false`-typed,
 * so a receipt that claims otherwise cannot type-check.
 */
export interface CallLintReceipt {
  schema_version: "calllint.receipt.v0"
  /** `clrec_<base64url>` from >=128 bits of randomness. Not hashed. */
  receipt_id: string
  /** ISO-8601. Not hashed (non-deterministic by design). */
  created_at: string
  tool: { name: "calllint"; version: string }
  subject: { type: "scan"; target?: string }
  verdict: Verdict
  hashes: {
    input_hash: `sha256:${string}`
    policy_hash: `sha256:${string}`
    report_hash: `sha256:${string}`
    ruleset_hash: `sha256:${string}`
  }
  corpus?: { phase?: string; release_gate?: boolean }
  risk_counts: { safe: number; review: number; block: number; unknown: number }
  finding_refs: Array<{ rule_id: string; severity: string; evidence_path?: string }>
  trust_boundaries: {
    executed_target: false
    network_used: boolean
    llm_in_verdict_path: false
    secret_values_read: false
  }
  /**
   * Reserved for R6 cloud signing (ADR 0028 / new5 R6). NEVER populated in
   * v0.8 — a v0.8 receipt is always an unsigned local receipt.
   */
  signature?: { algorithm: string; key_id: string; value: string }
}

/**
 * Inputs to `createReceipt`. Every derived field (`verdict`, `risk_counts`,
 * `finding_refs`, `corpus`) comes from `scanReport`; nothing is recomputed.
 */
export interface CreateReceiptInput {
  /** Runtime CLI version — read from the CLI package, never hardcoded. */
  toolVersion: string
  subject: { type: "scan"; target?: string }
  /** Normalized scan input to hash (raw text is acceptable; never abs paths). */
  inputForHash: unknown
  /** Effective policy object, or `{ policy: "default" }` when none loaded. */
  effectivePolicyForHash: unknown
  /** The existing ScanReport / ConfigSummaryReport — SOURCE of verdict/counts. */
  scanReport: unknown
  /** Ruleset identity: `{ toolVersion, ruleIds: string[] }` (sorted). */
  rulesetForHash: unknown
  /** True only when the scan ran with `--online`. Describes CallLint, not the target. */
  networkUsed?: boolean
  /** Optional corpus provenance to stamp (phase + release_gate). */
  corpus?: { phase?: string; release_gate?: boolean }
}
