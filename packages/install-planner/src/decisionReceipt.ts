import { sha256, hashJson } from "@calllint/fingerprint"
import { signReceipt as signReceiptCrypto, type Ed25519Keypair } from "@calllint/signature"
import type {
  ApplyResult,
  DecisionReceipt,
  InstallPlan,
  ReceiptResult,
} from "@calllint/types"

/** Context injected from the CLI edge — keeps the builder deterministic. */
export interface ReceiptContext {
  /** ISO-8601 UTC the human approved (part of the deterministic body + id). */
  approvedAt: string
  /** Attribution (e.g. OS user); null when unattributed. */
  approver: string | null
  /** CLI semver at apply time — the basis for scanner-version drift. */
  scannerVersion: string
  /** Evidence object digests bound to the decision (sorted+deduped here). */
  evidenceDigests?: `sha256:${string}`[]
  /** Optional policy version string. */
  policyVersion?: string | null
  /** Optional exception reason. */
  exceptionReason?: string | null
  /** receiptId of a prior receipt this supersedes. */
  supersedes?: string | null
}

/** Map an ApplyOutcome to the receipt's coarser result field. */
function resultFor(outcome: ApplyResult["outcome"]): ReceiptResult {
  if (outcome === "applied" || outcome === "already_applied") return "applied"
  if (outcome === "rolled_back") return "rolled-back"
  return "prepared-only" // stale / conflict / rollback_failed → nothing durable applied
}

/**
 * Derive a deterministic receiptId from the plan digest + approval time. Same
 * approval ⇒ same id (so the receipt can name its backup file). NOT random.
 */
function deriveReceiptId(installPlanDigest: string, approvedAt: string): string {
  const h = sha256(`${installPlanDigest}|${approvedAt}`).slice(7) // strip "sha256:"
  // base64url of the first 16 hex-bytes → short, url-safe, deterministic.
  const b64 = Buffer.from(h.slice(0, 32), "hex")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
  return `clrec_${b64}`
}

function sortedUnique(xs: readonly `sha256:${string}`[]): `sha256:${string}`[] {
  return [...new Set(xs)].sort()
}

/**
 * Build a `calllint.receipt.v1` decision receipt from an apply outcome and the
 * plan it applied. PURE + DETERMINISTIC (ADR 0039 §2): identical inputs ⇒
 * byte-identical receipt. No Date.now()/random — every timestamp is an input.
 * The upstream digests are read straight from the plan (never recomputed here).
 * The receipt is emitted UNSIGNED; `signReceipt` attaches a signature separately.
 */
export function buildDecisionReceipt(
  result: ApplyResult,
  plan: InstallPlan,
  ctx: ReceiptContext,
): DecisionReceipt {
  return {
    schema: "calllint.receipt.v1",
    receiptId: deriveReceiptId(plan.planDigest, ctx.approvedAt),
    artifactDigest: (plan.artifactDigest as `sha256:${string}` | null) ?? null,
    evidenceDigests: sortedUnique(ctx.evidenceDigests ?? []),
    authorityDigest: plan.authorityDigest as `sha256:${string}`,
    policyDigest: plan.policyDigest as `sha256:${string}`,
    decisionDigest: plan.decisionDigest as `sha256:${string}`,
    installPlanDigest: plan.planDigest,
    approval: {
      type: "local-human",
      approvedAt: ctx.approvedAt,
      approver: ctx.approver,
      approvedDigest: plan.planDigest,
    },
    result: resultFor(result.outcome),
    host: plan.host,
    configPath: result.configPath,
    configDigestBefore: result.configDigestBefore,
    configDigestAfter: result.configDigestAfter,
    policyVersion: ctx.policyVersion ?? null,
    scannerVersion: ctx.scannerVersion,
    exceptionReason: ctx.exceptionReason ?? null,
    expiration: plan.expiresAt,
    supersedes: ctx.supersedes ?? null,
    revocation: null,
    signature: null,
  }
}

/** The canonical digest of a receipt's BODY (minus `signature`). */
export function receiptBodyDigest(receipt: DecisionReceipt): `sha256:${string}` {
  const { signature, ...body } = receipt
  void signature
  return hashJson(body) as `sha256:${string}`
}

/**
 * Attach a local ed25519 signature, reusing @calllint/signature (ADR 0032/0039).
 * The signature covers the receipt body MINUS `signature`, so verify recomputes
 * over the same bytes. Returns a NEW receipt (input is not mutated).
 */
export function signDecisionReceipt(receipt: DecisionReceipt, keypair: Ed25519Keypair): DecisionReceipt {
  const { signature: _drop, ...body } = receipt
  void _drop
  const sig = signReceiptCrypto(body as Record<string, unknown>, keypair)
  return { ...receipt, signature: { ...sig, algorithm: "ed25519" } }
}
