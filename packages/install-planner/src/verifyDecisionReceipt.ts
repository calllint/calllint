import { verifyReceipt as verifyCrypto } from "@calllint/signature"
import type { DecisionReceipt } from "@calllint/types"

/** Outcome of verifying a decision receipt (ADR 0039 §5). */
export interface VerifyDecisionResult {
  /** True only when every STRUCTURAL + signature (if checked) check passed. */
  valid: boolean
  errors: string[]
  /** True when a signature block is present (shape-checked). */
  signed: boolean
  /** now > expiration. Reported but NOT fatal to `valid` (a true past record). */
  expired: boolean
  /** True when a signature was present but failed crypto verification. */
  tampered: boolean
}

const SHA256 = /^sha256:[0-9a-f]{64}$/
const RECEIPT_ID = /^clrec_[A-Za-z0-9_-]+$/
const RESULTS = new Set(["applied", "rolled-back", "prepared-only"])

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}
function isSha(v: unknown): v is string {
  return typeof v === "string" && SHA256.test(v)
}
function isShaOrNull(v: unknown): boolean {
  return v === null || isSha(v)
}

/**
 * Verify a decision receipt (ADR 0039 §5). Read-only and fail-closed: it checks
 * the schema shape, all six digests, the approval binding, expiry, and — when a
 * `publicKey` is supplied and the receipt is signed — the ed25519 signature over
 * the body minus `signature`. It NEVER re-judges a verdict, re-scans, executes
 * the target, touches the network, or rewrites anything.
 *
 * `now` (ISO-8601) is injected so expiry is deterministic. Expiry is REPORTED
 * (`expired`) but is not a structural error — an expired receipt is still a
 * valid record of a past approval.
 */
export function verifyDecisionReceipt(
  input: unknown,
  opts: { now: string; publicKey?: Uint8Array | string },
): VerifyDecisionResult {
  const errors: string[] = []
  const push = (m: string) => errors.push(m)
  const fail = (msg: string): VerifyDecisionResult => ({
    valid: false,
    errors: [msg],
    signed: false,
    expired: false,
    tampered: false,
  })

  if (!isObj(input)) return fail("receipt is not a JSON object")
  const r = input as Partial<DecisionReceipt> & Record<string, unknown>

  if (r.schema !== "calllint.receipt.v1") push('schema must be "calllint.receipt.v1"')
  if (typeof r.receiptId !== "string" || !RECEIPT_ID.test(r.receiptId)) push("receiptId must match /^clrec_/")
  if (!isShaOrNull(r.artifactDigest)) push("artifactDigest must be sha256 or null")
  if (!Array.isArray(r.evidenceDigests) || !r.evidenceDigests.every(isSha)) push("evidenceDigests must be an array of sha256")
  for (const k of ["authorityDigest", "policyDigest", "decisionDigest", "installPlanDigest"] as const) {
    if (!isSha(r[k])) push(`${k} must be sha256`)
  }
  if (typeof r.result !== "string" || !RESULTS.has(r.result)) push("result must be applied|rolled-back|prepared-only")
  if (typeof r.host !== "string" || r.host.length === 0) push("host must be a non-empty string")
  if (typeof r.configPath !== "string" || r.configPath.length === 0) push("configPath must be a non-empty string")
  if (!(r.configDigestBefore === "absent" || isSha(r.configDigestBefore))) push('configDigestBefore must be sha256 or "absent"')
  if (!isShaOrNull(r.configDigestAfter)) push("configDigestAfter must be sha256 or null")
  if (typeof r.scannerVersion !== "string" || r.scannerVersion.length === 0) push("scannerVersion must be a non-empty string")
  if (typeof r.expiration !== "string" || Number.isNaN(Date.parse(r.expiration))) push("expiration must be ISO-8601")

  // Approval binding: approvedDigest MUST equal installPlanDigest (ADR 0036).
  if (!isObj(r.approval)) {
    push("approval must be an object")
  } else {
    const a = r.approval
    if (a.type !== "local-human") push('approval.type must be "local-human"')
    if (typeof a.approvedAt !== "string" || Number.isNaN(Date.parse(a.approvedAt))) push("approval.approvedAt must be ISO-8601")
    if (!(a.approver === null || typeof a.approver === "string")) push("approval.approver must be string|null")
    if (!isSha(a.approvedDigest)) push("approval.approvedDigest must be sha256")
    else if (isSha(r.installPlanDigest) && a.approvedDigest !== r.installPlanDigest) {
      push("approval.approvedDigest must equal installPlanDigest (approval binding broken)")
    }
  }

  // Signature: shape-check always; crypto-verify only when a public key is given.
  let signed = false
  let tampered = false
  if (r.signature != null) {
    signed = true
    const sig = r.signature as unknown as Record<string, unknown>
    if (sig.algorithm !== "ed25519" || typeof sig.key_id !== "string" || typeof sig.value !== "string") {
      push("signature, when present, must have ed25519 algorithm + string key_id + value")
    } else if (opts.publicKey !== undefined) {
      const res = verifyCrypto(r as Record<string, unknown>, opts.publicKey)
      if (!res.valid) {
        tampered = true
        push(`signature verification failed: ${res.error ?? "invalid signature"}`)
      }
    }
  }

  const expired = typeof r.expiration === "string" && !Number.isNaN(Date.parse(r.expiration))
    ? Date.parse(opts.now) > Date.parse(r.expiration)
    : false

  return { valid: errors.length === 0, errors, signed, expired, tampered }
}
