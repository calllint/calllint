/**
 * calllint.evidence-manifest.v1 — the portable Evidence Manifest TYPE (new12 PR-D4;
 * ADR 0053 §2/§5; docs/new12-integration.md §2.2).
 *
 * The manifest is a READ-ONLY PROJECTION of an already-decided Trust Page onto the
 * ADR 0034 evidence discipline — "the Decision Receipt's public, tool-portable
 * sibling: same facts, projected" (`new12-integration.md:222`). It carries the
 * verdict + authority + completeness + digests VERBATIM and introduces NO new score,
 * verdict vocabulary, or authority model (ADR 0053 §2). If it cannot carry a value
 * verbatim, that is a bug, not a new judgment.
 *
 * This module holds only the TYPE + the schema-version const — the portable model,
 * with zero crypto and zero trust-index dependencies, so any consumer that has
 * `@calllint/evidence` can type a manifest. The PROJECTION BUILDER and the ed25519
 * sign/verify live in `@calllint/trust-index` (which already depends on
 * `@calllint/signature`/`@calllint/fingerprint`), exactly as `signMaintainerContext`
 * and `buildDecisionReceipt` keep their crypto next to the emitter, not in the model.
 *
 * The `signature` attests WHO emitted the projection, never that the artifact is
 * safe (ADR 0053 §2). The committed body ships `signature: null` and is
 * byte-reproducible; signing is a separate, non-deterministic step.
 */

/** The four CallLint verdicts, carried verbatim (never a new vocabulary). */
export type EvidenceManifestVerdict = "SAFE" | "REVIEW" | "BLOCK" | "UNKNOWN"

/** Evidence completeness of the underlying authority. */
export type EvidenceManifestCompleteness = "complete" | "partial"

/** The evidence level (E0–E6) reached — projected from the shipped pipeline (D2). */
export type EvidenceManifestLevel = "E0" | "E1" | "E2" | "E3" | "E4" | "E5" | "E6"

/**
 * An ed25519 signature envelope, attesting the emitter of the projection. Mirrored
 * structurally from `@calllint/signature`'s `SignatureMetadata` so this package need
 * not depend on the signer (same discipline as partner-api's `EnvelopePublisher`).
 * `null` in the committed body.
 */
export interface EvidenceManifestSignature {
  algorithm: "ed25519"
  key_id: string
  value: string
  signed_at: string
  public_key_url?: string
}

/**
 * One capability, projected VERBATIM from the shipped `calllint.authority.v0`
 * inventory — the decision-relevant slice of `AuthorityCapability`, in the shipped
 * (action × resource) vocabulary. Never a renamed or re-bucketed capability list
 * (`new12-integration.md:210-212`). Provenance-carrying fields (`evidenceSource`,
 * `scope`, `destination`) are intentionally NOT projected: the manifest is the public
 * sibling, and the full authority slice remains fetchable at `/…/authority`.
 */
export interface EvidenceManifestCapability {
  action:
    | "read"
    | "write"
    | "execute"
    | "connect"
    | "send"
    | "mutate"
    | "spend"
    | "delegate"
    | "persist"
  resource:
    | "filesystem"
    | "secret"
    | "process"
    | "network"
    | "database"
    | "message"
    | "financial"
    | "identity"
    | "agent"
    | "configuration"
  mutability: "read-only" | "mutating"
  reversibility: "reversible" | "irreversible" | "n/a"
  approvalRequirement: "none" | "review" | "block"
}

/** The authority projection — the shipped inventory's public, portable slice. */
export interface EvidenceManifestAuthority {
  /** The authority manifest's own digest — a consumer can fetch /authority and verify. */
  digest: `sha256:${string}`
  completeness: EvidenceManifestCompleteness
  capabilityCount: number
  /** Normalized approval labels (sorted, deduped) — verbatim from authority.approval.required. */
  approvalRequired: string[]
  capabilities: EvidenceManifestCapability[]
}

/**
 * The four INDEPENDENT status dimensions (ADR 0053 §5) — reported separately and
 * NEVER combined into a single rating. Mirrors the trust-page sidecar `status` block.
 */
export interface EvidenceManifestStatus {
  verdict: EvidenceManifestVerdict
  completeness: EvidenceManifestCompleteness
  /** Namespace control present/absent (control only, never safety). */
  authorityClaimed: boolean
  reproducibility: { pageDigest: `sha256:${string}`; observedAt: string }
  evidenceLevel: EvidenceManifestLevel
}

/**
 * The Evidence Manifest — a projection of one baked Trust Page. Every field maps to
 * an already-shipped source; nothing is invented (ADR 0053 §2).
 */
export interface EvidenceManifest {
  schema: "calllint.evidence-manifest.v1"
  /** Subject identity — page canonicalName + immutable artifact digest, verbatim. */
  subject: { canonicalName: string; artifactDigest: `sha256:${string}` }
  /** The engine verdict, VERBATIM — never recomputed by the projection. */
  verdict: EvidenceManifestVerdict
  /** The boundary-safe public label for the verdict. */
  verdictLabel: string
  completeness: EvidenceManifestCompleteness
  evidenceLevel: EvidenceManifestLevel
  evidenceRationale: string
  status: EvidenceManifestStatus
  authority: EvidenceManifestAuthority
  /** Policy digest from the bound decision, or honest null for a config-only page. */
  policyDigest: `sha256:${string}` | null
  reproducibility: { pageDigest: `sha256:${string}`; observedAt: string }
  /** The projecting engine. `version` is deliberately omitted (mutable ⇒ not gated). */
  engine: { name: "calllint" }
  correctionUrl: string
  /** ISO-8601 UTC = the page's pinned observedAt (keeps the committed body reproducible). */
  generatedAt: string
  /** ed25519 signature (who emitted the projection), or null in the committed body. */
  signature: EvidenceManifestSignature | null
}

/** The manifest schema version — the single source for the `schema` const. */
export const EVIDENCE_MANIFEST_SCHEMA_VERSION = "calllint.evidence-manifest.v1" as const
