/**
 * calllint.receipt.v1 — the gateway Decision Receipt (object 6 of the six).
 *
 * Produced by `trust apply` AFTER an apply outcome. It is a durable, portable
 * proof of *what was approved, under what evidence and policy, by whom, and when
 * it expires* — binding the full six-digest chain (artifact → evidence →
 * authority → decision/policy → install-plan → this receipt).
 *
 * This is a NEW sibling schema, not a mutation of the shipped scan receipt
 * `calllint.receipt.v0` (ADR 0028), which keeps serving `scan --receipt`.
 *
 * Hard rules (ADR 0039):
 * - The body is DETERMINISTIC: `approvedAt`, `approver`, `scannerVersion` and
 *   every timestamp are INPUTS injected from the CLI edge — no Date.now()/random
 *   inside the builder. `receiptId` is derived from installPlanDigest+approvedAt.
 * - A receipt proves PROVENANCE, not safety. `verify` never re-judges, re-scans,
 *   executes the target, or touches the network.
 * - The optional `signature` covers the canonical body MINUS `signature`
 *   (reusing @calllint/signature, same rule as ADR 0032).
 */

/** How the plan was approved. v1.3.0 only supports a local human approval. */
export interface ReceiptApproval {
  type: "local-human"
  /** ISO-8601 UTC — an injected input, part of the deterministic body. */
  approvedAt: string
  /** Attribution (e.g. OS user); null when unattributed. */
  approver: string | null
  /** The exact planDigest the human approved (== installPlanDigest). */
  approvedDigest: `sha256:${string}`
}

/** Optional revocation marker (a receipt can be voided after the fact). */
export interface ReceiptRevocation {
  revokedAt: string
  reason: string
}

/** Result of the apply this receipt records. */
export type ReceiptResult = "applied" | "rolled-back" | "prepared-only"

/** ed25519 signature block (identical shape to the v0 receipt signature). */
export interface ReceiptSignature {
  algorithm: "ed25519"
  key_id: string
  value: string
  /** The ONLY non-deterministic value; sits OUTSIDE the signed body. */
  signed_at: string
  public_key_url?: string
}

export interface DecisionReceipt {
  schema: "calllint.receipt.v1"
  /** `clrec_<base64url>` — DERIVED from installPlanDigest+approvedAt, never random. */
  receiptId: string
  // ---- the six-digest provenance chain ----
  /** Object 1: null when the artifact was unpinned/absent. */
  artifactDigest: `sha256:${string}` | null
  /** Object 2: sorted, deduped; [] when no evidence was attached. */
  evidenceDigests: `sha256:${string}`[]
  /** Object 3. */
  authorityDigest: `sha256:${string}`
  /** Object 4. */
  policyDigest: `sha256:${string}`
  decisionDigest: `sha256:${string}`
  /** Object 5: the approved plan. */
  installPlanDigest: `sha256:${string}`
  // ---- approval + apply outcome ----
  approval: ReceiptApproval
  result: ReceiptResult
  host: string
  configPath: string
  configDigestBefore: `sha256:${string}` | "absent"
  configDigestAfter: `sha256:${string}` | null
  // ---- provenance metadata (all injected inputs) ----
  policyVersion: string | null
  /** CLI semver at apply time — the basis for scanner-version drift. */
  scannerVersion: string
  exceptionReason: string | null
  /** ISO-8601 UTC — inherited from the plan's expiresAt. */
  expiration: string
  /** receiptId of a prior receipt this supersedes, or null. */
  supersedes: string | null
  revocation: ReceiptRevocation | null
  /** Optional local ed25519 signature; null/absent ⇒ unsigned local receipt. */
  signature: ReceiptSignature | null
}

export const DECISION_RECEIPT_SCHEMA = "calllint.receipt.v1" as const
