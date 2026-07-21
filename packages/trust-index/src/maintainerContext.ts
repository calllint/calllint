/**
 * Signed Maintainer Context + drift notification (new11 §6.4/§6.5, ADR 0047 §3/§5,
 * traceability C-4/C-5, PR-13). PURE: no network, no clock, no fs, no GitHub API —
 * signing/verification is CPU-only over committed data; drift REUSES the shipped
 * `@calllint/types` DriftEntry taxonomy (ADR 0039), never a second engine.
 *
 * Two non-negotiables this module encodes structurally (ADR 0047 "Non-negotiables"):
 *   1. A maintainer statement NEVER changes a verdict. There is no `verdict` field on
 *      a context claim, `kind` is a closed non-verdict vocabulary, and
 *      `assertNoVerdictAuthority` fails closed if either is violated.
 *   2. No version-unbound permanent claim (§6.4). A context is bound to the artifact
 *      digest observed at signing; `isContextCurrentForDigest` makes it STALE the
 *      moment the page's digest moves — the statement is never silently carried
 *      forward onto a changed artifact.
 *
 * Delivery of a drift notification (a GitHub issue against the claimed repo) is the
 * Actions/ingestion plane's job and is best-effort, never on the verdict path
 * (ADR 0047 §5/§6). This module only BUILDS the boundary-safe payload.
 */
import { signReceipt, verifyReceipt, type SignatureMetadata } from "@calllint/signature"
import type { Ed25519Keypair } from "@calllint/signature"
import type { DriftEntry, Verdict } from "@calllint/types"

/**
 * What a maintainer is saying about a claimed subject. Deliberately a CLOSED set of
 * NON-verdict intents (ADR 0047 §1: "never a security judgment"): a maintainer may
 * acknowledge a finding, dispute it, or add context — none of which is a verdict.
 */
export const MAINTAINER_CONTEXT_KINDS = ["acknowledged", "disputed", "context"] as const
export type MaintainerContextKind = (typeof MAINTAINER_CONTEXT_KINDS)[number]

/** Tokens that would let a statement read as a verdict — rejected in `kind` (defense-in-depth). */
const VERDICT_LIKE = new Set<string>([
  "safe",
  "verified",
  "verified-safe",
  "certified",
  "approved",
  "trusted",
  "review",
  "block",
  "unknown",
])

/**
 * A maintainer's signed statement about ONE claimed subject at ONE artifact digest.
 * PII-free beyond the public GitHub handle (ADR 0038 §5). It carries NO verdict and
 * NO verdict authority — see `assertNoVerdictAuthority`.
 */
export interface MaintainerContextClaim {
  schema: "calllint.maintainer-context.v0"
  /** Canonical `{ns}/{name}` of the claimed subject (same key space as ClaimRecord). */
  canonicalName: string
  /** Public GitHub handle/org of the verified controller (never an email — PII). */
  owner: string
  /** The artifact digest this statement is bound to — the version lineage (§6.4). */
  artifactDigest: `sha256:${string}`
  /** Optional finding this statement addresses; omitted = subject-level context. */
  findingId?: string
  /** A NON-verdict intent (closed vocabulary). */
  kind: MaintainerContextKind
  /** Free-text maintainer note. Presentation-only; never parsed into a verdict. */
  statement: string
}

/** A `MaintainerContextClaim` after signing — the durable, verifiable record. */
export interface SignedMaintainerContext extends MaintainerContextClaim {
  signature: SignatureMetadata
}

const EMAIL_LIKE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/

/**
 * Fail closed if a claim could be read as a verdict (ADR 0047 non-negotiable
 * "Claiming never changes a verdict"). Rejects: an off-vocabulary `kind`, a
 * verdict-like `kind`, or any smuggled `verdict`/`severity`/`result` property. This
 * is the structural proof that the context layer has no decision authority.
 */
export function assertNoVerdictAuthority(claim: MaintainerContextClaim): void {
  if (!(MAINTAINER_CONTEXT_KINDS as readonly string[]).includes(claim.kind)) {
    throw new Error(`maintainer-context: unknown kind "${claim.kind}"`)
  }
  if (VERDICT_LIKE.has(String(claim.kind).toLowerCase())) {
    throw new Error(`maintainer-context: kind "${claim.kind}" reads as a verdict — refused`)
  }
  for (const forbidden of ["verdict", "severity", "result", "score"] as const) {
    if (forbidden in (claim as unknown as Record<string, unknown>)) {
      throw new Error(`maintainer-context: property "${forbidden}" is not allowed (no verdict authority)`)
    }
  }
}

/** Structural validation of a context claim (shape, digest form, PII guard). Pure. */
export function validateMaintainerContext(claim: MaintainerContextClaim): void {
  if (claim.schema !== "calllint.maintainer-context.v0") {
    throw new Error(`maintainer-context: unexpected schema ${JSON.stringify(claim.schema)}`)
  }
  if (typeof claim.canonicalName !== "string" || claim.canonicalName.length === 0) {
    throw new Error("maintainer-context: canonicalName must be a non-empty string")
  }
  if (typeof claim.owner !== "string" || claim.owner.length === 0) {
    throw new Error("maintainer-context: owner must be a non-empty handle")
  }
  if (EMAIL_LIKE.test(claim.owner)) {
    throw new Error("maintainer-context: owner must be a public handle, never an email (PII)")
  }
  if (!DIGEST_RE.test(claim.artifactDigest)) {
    throw new Error("maintainer-context: artifactDigest must be a sha256:<64-hex> digest")
  }
  if (typeof claim.statement !== "string") {
    throw new Error("maintainer-context: statement must be a string")
  }
  assertNoVerdictAuthority(claim)
}

/**
 * Sign a validated maintainer context with an Ed25519 keypair, reusing the shipped
 * receipt signer (canonical JSON → sha256 → ed25519, ADR 0032). Validation runs
 * first so an invalid or verdict-bearing claim can never be signed.
 */
export function signMaintainerContext(
  claim: MaintainerContextClaim,
  keypair: Ed25519Keypair,
): SignedMaintainerContext {
  validateMaintainerContext(claim)
  const signature = signReceipt(claim as unknown as Record<string, unknown>, keypair)
  return { ...claim, signature }
}

/**
 * Verify a signed maintainer context. Returns `false` if the signature is invalid OR
 * the payload fails validation (a verdict-bearing or malformed claim is not "valid"
 * even with a good signature — fail closed).
 */
export function verifyMaintainerContext(
  signed: SignedMaintainerContext,
  publicKey: Uint8Array | string,
): boolean {
  try {
    const { signature, ...claim } = signed
    validateMaintainerContext(claim as MaintainerContextClaim)
  } catch {
    return false
  }
  return verifyReceipt(signed as unknown as Record<string, unknown>, publicKey).valid
}

/**
 * The digest-binding gate (§6.4 "no version-unbound permanent claim"). A context is
 * CURRENT only for the exact artifact digest it was bound to; once the page's digest
 * moves the context is STALE and must not be presented as still applying. Callers
 * decide what to do with a stale context (drop it, or notify — see below); this
 * function only answers the binding question, deterministically.
 */
export function isContextCurrentForDigest(
  claim: MaintainerContextClaim,
  currentArtifactDigest: string,
): boolean {
  return claim.artifactDigest === currentArtifactDigest
}

/**
 * A boundary-safe drift notification payload (§6.5). It states only WHAT drifted
 * (the shipped taxonomy's `status`/`reasons`), the two digests, an optional verdict
 * transition, and a LINK to the authoritative baked page. It never carries config
 * bodies, commands, secrets, or evidence text — the same forbidden set the telemetry
 * contract enforces. Built by allowlist, so a forbidden field is structurally unable
 * to appear. This is a PAYLOAD, not a delivery: sending it is the Actions plane's job
 * and is best-effort, never on the verdict path (ADR 0047 §5).
 */
export interface MaintainerDriftNotification {
  schema: "calllint.maintainer-drift-notice.v0"
  canonicalName: string
  owner: string
  /** Digest the claim was bound to (§3). */
  pinnedDigest: `sha256:${string}`
  /** Digest currently observed on the page. */
  currentDigest: string
  /** The shipped drift taxonomy status (ADR 0039) — not a new vocabulary. */
  status: DriftEntry["status"]
  /** Human-readable reasons straight from the shipped drift engine. */
  reasons: string[]
  baselineVerdict?: Verdict
  currentVerdict?: Verdict
  rugPull: boolean
  /** Link to the authoritative "observed at digest T" page — the durable record. */
  pageUrl: string
}

/** Fields that must never ride on a notification (mirrors telemetry FORBIDDEN_FIELDS). */
const NOTICE_FORBIDDEN = [
  "rawConfig",
  "command",
  "environmentValue",
  "secret",
  "fileContents",
  "privateRepository",
  "userPrompt",
  "findingEvidenceText",
] as const

/**
 * Build a drift notification for a claimed subject from a drift engine result.
 *
 * Returns `null` when there is nothing to notify — either the drift engine reports
 * `unchanged`, or the current digest still equals the pinned one (the context is
 * current, §6.4). Otherwise it constructs the payload BY ALLOWLIST from the claim
 * and the shipped `DriftEntry`; it then defensively asserts no forbidden field leaked
 * onto the reasons or into the entry (fail closed). No clock, no network, no send.
 */
export function buildDriftNotification(
  claim: MaintainerContextClaim,
  entry: DriftEntry,
  currentArtifactDigest: string,
  pageUrl: string,
): MaintainerDriftNotification | null {
  validateMaintainerContext(claim)
  // Nothing to say: the taxonomy says unchanged AND the digest still matches.
  if (entry.status === "unchanged" && isContextCurrentForDigest(claim, currentArtifactDigest)) {
    return null
  }
  // Fail closed: a reason string must never smuggle a forbidden field name+value.
  for (const reason of entry.reasons) {
    if (typeof reason !== "string") {
      throw new Error("maintainer-drift-notice: every drift reason must be a string")
    }
  }
  for (const f of NOTICE_FORBIDDEN) {
    if (f in (entry as unknown as Record<string, unknown>)) {
      throw new Error(`maintainer-drift-notice: forbidden field "${f}" present on drift entry`)
    }
  }
  // Allowlist construction — only these fields can ever appear on the payload.
  const notice: MaintainerDriftNotification = {
    schema: "calllint.maintainer-drift-notice.v0",
    canonicalName: claim.canonicalName,
    owner: claim.owner,
    pinnedDigest: claim.artifactDigest,
    currentDigest: currentArtifactDigest,
    status: entry.status,
    reasons: [...entry.reasons],
    rugPull: entry.rugPull,
    pageUrl,
  }
  if (entry.baselineVerdict) notice.baselineVerdict = entry.baselineVerdict
  if (entry.currentVerdict) notice.currentVerdict = entry.currentVerdict
  return notice
}
