/**
 * new12 PR-D4 — build + sign the Evidence Manifest (`calllint.evidence-manifest.v1`).
 *
 * This is the PROJECTION half of the manifest (the portable TYPE lives in
 * `@calllint/evidence`). It is a PURE, DETERMINISTIC projection over a `BakedTrustPage`
 * — the same discipline as `evidenceLevel()`/`fourDimensionStatus()` (D2) and the
 * `verifiedPublisher` overlay: it reads shipped fields and re-serializes them, and it
 * NEVER re-scores. The verdict + authority + completeness + digests are carried
 * VERBATIM (ADR 0053 §2; `new12-integration.md` §2.2). If a value cannot be carried
 * verbatim, that is a bug, not a new judgment.
 *
 * The committed manifest body ships `signature: null`, so a re-bake is byte-identical
 * and the committed-tree reproducibility gate holds (ADR 0046 §4) — exactly the shape
 * `buildDecisionReceipt` uses (`signature: null` in the body; sign as a separate step).
 * `signEvidenceManifest`/`verifyEvidenceManifest` mirror `signDecisionReceipt` and
 * reuse `@calllint/signature` verbatim (no new signing scheme). The signature attests
 * WHO emitted the projection, never that the artifact is safe (ADR 0053 §2).
 */
import { VERDICT_PUBLIC_LABEL } from "@calllint/types"
import type { AuthorityManifest } from "@calllint/types"
import { hashJson } from "@calllint/fingerprint"
import { signReceipt, verifyReceipt, type Ed25519Keypair } from "@calllint/signature"
import type {
  EvidenceManifest,
  EvidenceManifestAuthority,
  EvidenceManifestCapability,
} from "@calllint/evidence"
import { EVIDENCE_MANIFEST_SCHEMA_VERSION } from "@calllint/evidence"
import type { BakedTrustPage } from "./bakeTrustPage.js"
import { evidenceLevel } from "./evidenceLevel.js"
import { CORRECTION_URL } from "./renderPage.js"

/** Context the emitter injects. `authorityClaimed` mirrors the (revocable) claim overlay. */
export interface EvidenceManifestContext {
  /** Whether a verified namespace claim overlays this page (control, never safety). */
  authorityClaimed?: boolean
}

/**
 * Project the shipped authority inventory onto the manifest's public, portable slice.
 * Carries the shipped (action × resource) vocabulary VERBATIM and drops only the
 * provenance-bearing fields (`evidenceSource`/`scope`/`destination`) — those stay
 * fetchable at `/…/authority`. A page with no authority (unresolved artifact) yields
 * an honest empty inventory rather than a fabricated one.
 */
function projectAuthority(authority: AuthorityManifest | null): EvidenceManifestAuthority {
  if (authority === null) {
    return {
      digest: hashJson({ empty: true }) as `sha256:${string}`,
      completeness: "partial",
      capabilityCount: 0,
      approvalRequired: [],
      capabilities: [],
    }
  }
  const capabilities: EvidenceManifestCapability[] = authority.capabilities.map((c) => ({
    action: c.action,
    resource: c.resource,
    mutability: c.mutability,
    reversibility: c.reversibility,
    approvalRequirement: c.approvalRequirement,
  }))
  return {
    digest: authority.digest,
    completeness: authority.completeness,
    capabilityCount: capabilities.length,
    // Verbatim from the shipped inventory (already sorted+deduped by buildAuthorityManifest).
    approvalRequired: [...authority.approval.required],
    capabilities,
  }
}

/**
 * Build the Evidence Manifest for a baked page. PURE + DETERMINISTIC: identical inputs
 * ⇒ byte-identical manifest. No clock, no RNG — `generatedAt` is the page's pinned
 * `observedAt`. Emitted with `signature: null`; `signEvidenceManifest` attaches one
 * separately.
 */
export function buildEvidenceManifest(
  page: BakedTrustPage,
  ctx: EvidenceManifestContext = {},
): EvidenceManifest {
  const completeness = page.preparation.authority?.completeness ?? "partial"
  const authorityClaimed = ctx.authorityClaimed === true
  const ev = evidenceLevel(page)
  const reproducibility = { pageDigest: page.pageDigest, observedAt: page.observedAt }
  // Policy digest is carried verbatim from a bound decision; a static config-only page
  // carries no decision, so this is an honest null (never fabricated).
  const policyDigest = (page.preparation.decision?.policyDigest as `sha256:${string}` | undefined) ?? null

  return {
    schema: EVIDENCE_MANIFEST_SCHEMA_VERSION,
    subject: { canonicalName: page.canonicalName, artifactDigest: page.artifactDigest },
    verdict: page.verdict,
    verdictLabel: VERDICT_PUBLIC_LABEL[page.verdict],
    completeness,
    evidenceLevel: ev.level,
    evidenceRationale: ev.rationale,
    status: {
      verdict: page.verdict,
      completeness,
      authorityClaimed,
      reproducibility,
      evidenceLevel: ev.level,
    },
    authority: projectAuthority(page.preparation.authority),
    policyDigest,
    reproducibility,
    engine: { name: "calllint" },
    correctionUrl: CORRECTION_URL,
    generatedAt: page.observedAt,
    signature: null,
  }
}

/**
 * The canonical digest of a manifest's BODY (minus `signature`). Reused by verify so
 * the signed and verified bytes are identical regardless of the signature block —
 * mirrors `receiptBodyDigest`.
 */
export function evidenceManifestBodyDigest(manifest: EvidenceManifest): `sha256:${string}` {
  const { signature, ...body } = manifest
  void signature
  return hashJson(body) as `sha256:${string}`
}

/**
 * Attach an ed25519 signature over the manifest body (minus `signature`), reusing
 * `@calllint/signature` (ADR 0032/0039). Returns a NEW manifest; the input is not
 * mutated. The signature attests the EMITTER of the projection, never safety
 * (ADR 0053 §2). Mirrors `signDecisionReceipt`.
 */
export function signEvidenceManifest(
  manifest: EvidenceManifest,
  keypair: Ed25519Keypair,
): EvidenceManifest {
  const { signature: _drop, ...body } = manifest
  void _drop
  const sig = signReceipt(body as Record<string, unknown>, keypair)
  return { ...manifest, signature: { ...sig, algorithm: "ed25519" } }
}

/**
 * Verify a signed manifest. The signature covers the body minus `signature`, so
 * `verifyReceipt` recomputes over the same bytes. Returns `false` for an unsigned
 * manifest (there is nothing to verify) or a bad/tampered signature — fail closed.
 */
export function verifyEvidenceManifest(
  manifest: EvidenceManifest,
  publicKey: Uint8Array | string,
): boolean {
  if (manifest.signature === null) return false
  return verifyReceipt(manifest as unknown as Record<string, unknown>, publicKey).valid
}
