/**
 * Gateway drift taxonomy (ADR 0039 §4).
 *
 * `classifyReceiptDrift` compares a DecisionReceipt against a `current` snapshot
 * of freshly-computed digests and emits typed drift entries. It is PURE: the
 * caller computes the current digests; the classifier does no I/O, never
 * re-scans, and never executes the target.
 */

/** The four change classes a drift signal is labeled into. */
export type DriftClass = "artifact" | "authority" | "evidence" | "policy"

/** The nine drift signals (each maps to exactly one DriftClass). */
export type DriftSignal =
  | "artifact" // artifactDigest moved
  | "config" // live config no longer matches configDigestAfter (gateway-downstream)
  | "tool-metadata" // tool/skill metadata digest moved
  | "permission" // authority capabilities/permissions changed
  | "authority" // authorityDigest moved
  | "evidence" // evidenceDigests set changed
  | "evidence-expiry" // attached evidence is stale vs now
  | "policy" // policyDigest / policyVersion moved
  | "scanner-version" // scannerVersion differs from current CLI

/** One detected change between the receipt and the current world. */
export interface DriftChange {
  signal: DriftSignal
  class: DriftClass
  /** What the receipt recorded (digest / version / marker). */
  was: string | null
  /** What the world shows now. */
  now: string | null
  /** Human-readable one-liner. */
  reason: string
}

/**
 * The current snapshot to compare a receipt against. Every field is OPTIONAL:
 * a caller supplies only the digests it can compute. A field left undefined is
 * NOT compared (absence of data is never reported as drift).
 */
export interface ReceiptDriftInput {
  artifactDigest?: `sha256:${string}` | null
  configDigest?: `sha256:${string}` | "absent"
  toolMetadataDigest?: `sha256:${string}`
  /** Sorted digest of the authority's capability/permission set. */
  permissionDigest?: `sha256:${string}`
  authorityDigest?: `sha256:${string}`
  evidenceDigests?: `sha256:${string}`[]
  /** Earliest evidence expiry as ISO-8601; compared against `now`. */
  evidenceExpiresAt?: string | null
  policyDigest?: `sha256:${string}`
  policyVersion?: string | null
  scannerVersion?: string
  /** ISO-8601 UTC used for expiry checks (receipt + evidence). */
  now: string
}

/**
 * Result of classifying drift. `drifted` is true when any change class fired.
 * `expired` and `signatureChainBroken` are INTEGRITY flags, reported alongside
 * the change classes but not themselves change classes (ADR 0039 §4).
 */
export interface ReceiptDriftReport {
  schema: "calllint.receipt-drift.v1"
  receiptId: string
  drifted: boolean
  /** now > receipt.expiration. */
  expired: boolean
  /** Distinct change classes that fired (sorted). */
  classes: DriftClass[]
  changes: DriftChange[]
  generatedAt: string
}

export const RECEIPT_DRIFT_SCHEMA = "calllint.receipt-drift.v1" as const
