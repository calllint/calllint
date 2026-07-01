import type { CallLintReceipt } from "./types.js"

/** Outcome of a structural receipt verification. */
export interface VerifyReceiptResult {
  /** True only when every structural check passed. */
  valid: boolean
  /** Human-readable reasons a receipt was rejected (empty when valid). */
  errors: string[]
  /** True when a `signature` field is present (shape-checked only, never crypto-verified in v0). */
  signed: boolean
}

const SHA256_RE = /^sha256:[0-9a-f]{64}$/
const RECEIPT_ID_RE = /^clrec_[A-Za-z0-9_-]+$/
const VERDICTS = new Set(["SAFE", "REVIEW", "BLOCK", "UNKNOWN"])
const HASH_KEYS = ["input_hash", "policy_hash", "report_hash", "ruleset_hash"] as const
const COUNT_KEYS = ["safe", "review", "block", "unknown"] as const

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/**
 * Validate a parsed receipt object's STRUCTURE only. This is deliberately not a
 * second scanner: it never re-judges a verdict, never re-hashes inputs, and
 * never touches the network. It checks the schema shape, hash formats, integer
 * risk counts, the four fixed trust-boundary invariants, and — if present — the
 * SHAPE of the reserved signature field (no real crypto verify in v0.8).
 */
export function verifyReceipt(input: unknown): VerifyReceiptResult {
  const errors: string[] = []
  const push = (msg: string) => errors.push(msg)

  if (!isObject(input)) {
    return { valid: false, errors: ["receipt is not a JSON object"], signed: false }
  }
  const r = input as Partial<CallLintReceipt> & Record<string, unknown>

  if (r.schema_version !== "calllint.receipt.v0") {
    push(`schema_version must be "calllint.receipt.v0" (got ${JSON.stringify(r.schema_version)})`)
  }
  if (typeof r.receipt_id !== "string" || !RECEIPT_ID_RE.test(r.receipt_id)) {
    push("receipt_id must match /^clrec_[A-Za-z0-9_-]+$/")
  }
  if (typeof r.created_at !== "string" || Number.isNaN(Date.parse(r.created_at))) {
    push("created_at must be an ISO-8601 timestamp")
  }

  if (!isObject(r.tool) || r.tool.name !== "calllint" || typeof r.tool.version !== "string") {
    push('tool must be { name: "calllint", version: <string> }')
  }
  if (!isObject(r.subject) || r.subject.type !== "scan") {
    push('subject.type must be "scan"')
  }
  if (typeof r.verdict !== "string" || !VERDICTS.has(r.verdict)) {
    push("verdict must be one of SAFE | REVIEW | BLOCK | UNKNOWN")
  }

  if (!isObject(r.hashes)) {
    push("hashes must be an object")
  } else {
    for (const key of HASH_KEYS) {
      const val = r.hashes[key]
      if (typeof val !== "string" || !SHA256_RE.test(val)) {
        push(`hashes.${key} must match sha256:<64 lowercase hex>`)
      }
    }
  }

  if (!isObject(r.risk_counts)) {
    push("risk_counts must be an object")
  } else {
    for (const key of COUNT_KEYS) {
      const val = r.risk_counts[key]
      if (typeof val !== "number" || !Number.isInteger(val) || val < 0) {
        push(`risk_counts.${key} must be an integer >= 0`)
      }
    }
  }

  if (!Array.isArray(r.finding_refs)) {
    push("finding_refs must be an array")
  } else {
    r.finding_refs.forEach((ref, i) => {
      if (!isObject(ref) || typeof ref.rule_id !== "string" || typeof ref.severity !== "string") {
        push(`finding_refs[${i}] must have string rule_id and severity`)
      }
    })
  }

  if (!isObject(r.trust_boundaries)) {
    push("trust_boundaries must be an object")
  } else {
    const tb = r.trust_boundaries
    if (tb.executed_target !== false) push("trust_boundaries.executed_target must be false")
    if (tb.llm_in_verdict_path !== false) push("trust_boundaries.llm_in_verdict_path must be false")
    if (tb.secret_values_read !== false) push("trust_boundaries.secret_values_read must be false")
    if (typeof tb.network_used !== "boolean") push("trust_boundaries.network_used must be a boolean")
  }

  // Reserved signature: SHAPE only. Its presence never makes a receipt "more
  // trusted" in v0.8 — no real signature is generated or verified yet.
  const signed = isObject(r.signature)
  if (signed) {
    const sig = r.signature as Record<string, unknown>
    if (typeof sig.algorithm !== "string" || typeof sig.key_id !== "string" || typeof sig.value !== "string") {
      push("signature, when present, must have string algorithm, key_id, and value")
    }
  }

  return { valid: errors.length === 0, errors, signed }
}
