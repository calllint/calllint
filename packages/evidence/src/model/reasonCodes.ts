// ---------------------------------------------------------------------------
// Evidence-Gap Reason Codes v0 (new11 P1 §4.4 — the central gap vocabulary)
//
// These are DISTINCT from @calllint/types REASON_CODES: those explain why a
// verdict is risky (a projection of findings); THESE explain why an artifact's
// identity/evidence could not be RESOLVED. A gap is the evidence-layer analog of
// UNKNOWN — it never reads as clean, and it always carries an actionable reason.
//
// Invariant (mirrors the engine): a missing/unreachable signal is a GAP, never a
// silent pass. Every code states {category, severity, userMessage, maintainerAction,
// retryable} so the surface can tell the user WHAT is missing and WHO can fix it.
// See docs/new11-requirements-traceability.md §C and ADR 0049 §2.
// ---------------------------------------------------------------------------

/** The 16 frozen evidence-gap codes (order is stable; append only). */
export const EVIDENCE_GAP_CODES = [
  "ARTIFACT_VERSION_UNRESOLVED",
  "ARTIFACT_DIGEST_UNAVAILABLE",
  "PACKAGE_NOT_FOUND",
  "REPOSITORY_UNRESOLVED",
  "REPOSITORY_MISMATCH",
  "REGISTRY_ENTRY_MISSING",
  "PUBLISHER_UNVERIFIED",
  "PROVENANCE_UNAVAILABLE",
  "TOOL_METADATA_UNAVAILABLE",
  "AUTHORITY_SCOPE_INCOMPLETE",
  "REMOTE_OWNER_UNVERIFIED",
  "NETWORK_UNAVAILABLE",
  "RATE_LIMITED",
  "UNSUPPORTED_SUBJECT_TYPE",
  "MALFORMED_METADATA",
  "CONFLICTING_EVIDENCE",
] as const

export type EvidenceGapCode = (typeof EVIDENCE_GAP_CODES)[number]

/** Which resolution dimension the gap sits in — for grouping in reports. */
export type GapCategory =
  | "identity"
  | "repository"
  | "registry"
  | "publisher"
  | "provenance"
  | "metadata"
  | "authority"
  | "network"
  | "input"
  | "conflict"

/** Blocking = cannot be clean; degrading = weakens completeness but not identity. */
export type GapSeverity = "blocking" | "degrading"

export interface EvidenceGapMeta {
  category: GapCategory
  severity: GapSeverity
  /** One stable, user-facing sentence. No secrets, no local paths. */
  userMessage: string
  /** What a verified maintainer could do to close it; null = not maintainer-fixable. */
  maintainerAction: string | null
  /** True ⇒ a later run with network/rate budget may resolve it (transient). */
  retryable: boolean
}

/** The single source of truth for what each gap means and who can close it. */
export const EVIDENCE_GAP_META: Record<EvidenceGapCode, EvidenceGapMeta> = {
  ARTIFACT_VERSION_UNRESOLVED: {
    category: "identity",
    severity: "blocking",
    userMessage: "The artifact's exact version could not be pinned to an immutable ref.",
    maintainerAction: "Publish a pinned version or tag so the artifact resolves to one immutable ref.",
    retryable: false,
  },
  ARTIFACT_DIGEST_UNAVAILABLE: {
    category: "identity",
    severity: "blocking",
    userMessage: "No content digest was available for the resolved artifact.",
    maintainerAction: "Publish with provenance so a content digest is recorded.",
    retryable: true,
  },
  PACKAGE_NOT_FOUND: {
    category: "identity",
    severity: "blocking",
    userMessage: "The named package does not exist in the registry.",
    maintainerAction: "Publish the package under the exact name referenced.",
    retryable: false,
  },
  REPOSITORY_UNRESOLVED: {
    category: "repository",
    severity: "degrading",
    userMessage: "No source repository could be mapped for the artifact.",
    maintainerAction: "Add a repository field pointing to the canonical source repo.",
    retryable: false,
  },
  REPOSITORY_MISMATCH: {
    category: "repository",
    severity: "blocking",
    userMessage: "The declared repository does not match the resolved artifact source.",
    maintainerAction: "Correct the repository field to the repo that actually publishes the artifact.",
    retryable: false,
  },
  REGISTRY_ENTRY_MISSING: {
    category: "registry",
    severity: "degrading",
    userMessage: "The artifact was not found in the expected MCP registry.",
    maintainerAction: "List the artifact in the MCP registry with a resolvable identity.",
    retryable: true,
  },
  PUBLISHER_UNVERIFIED: {
    category: "publisher",
    severity: "degrading",
    userMessage: "The publisher's identity could not be verified.",
    maintainerAction: "Verify publisher identity via a supported strong method (OIDC, provenance, registry namespace).",
    retryable: false,
  },
  PROVENANCE_UNAVAILABLE: {
    category: "provenance",
    severity: "degrading",
    userMessage: "No build provenance attestation was available for the artifact.",
    maintainerAction: "Publish with a provenance attestation (e.g. npm --provenance / SLSA).",
    retryable: true,
  },
  TOOL_METADATA_UNAVAILABLE: {
    category: "metadata",
    severity: "degrading",
    userMessage: "The tool's declared metadata could not be read without executing it.",
    maintainerAction: "Ship a static tool manifest so metadata resolves without running the server.",
    retryable: false,
  },
  AUTHORITY_SCOPE_INCOMPLETE: {
    category: "authority",
    severity: "degrading",
    userMessage: "The tool's authority scope (capabilities, side effects) is only partly declared.",
    maintainerAction: "Declare the full capability/authority scope in the tool manifest.",
    retryable: false,
  },
  REMOTE_OWNER_UNVERIFIED: {
    category: "publisher",
    severity: "degrading",
    userMessage: "Ownership of the remote endpoint's domain could not be verified.",
    maintainerAction: "Prove domain ownership via a supported method (well-known, DNS TXT).",
    retryable: true,
  },
  NETWORK_UNAVAILABLE: {
    category: "network",
    severity: "blocking",
    userMessage: "A required upstream could not be reached, so resolution is incomplete.",
    maintainerAction: null,
    retryable: true,
  },
  RATE_LIMITED: {
    category: "network",
    severity: "blocking",
    userMessage: "An upstream rate-limited the request before resolution completed.",
    maintainerAction: null,
    retryable: true,
  },
  UNSUPPORTED_SUBJECT_TYPE: {
    category: "input",
    severity: "blocking",
    userMessage: "No resolver supports this subject type.",
    maintainerAction: null,
    retryable: false,
  },
  MALFORMED_METADATA: {
    category: "metadata",
    severity: "blocking",
    userMessage: "Upstream metadata was malformed and could not be trusted.",
    maintainerAction: "Correct the malformed manifest/metadata so it parses to the expected shape.",
    retryable: false,
  },
  CONFLICTING_EVIDENCE: {
    category: "conflict",
    severity: "blocking",
    userMessage: "Two sources of equal priority disagreed on the same fact.",
    maintainerAction: "Reconcile the conflicting metadata so a single value resolves.",
    retryable: false,
  },
}

/** True when a code names a maintainer action a verified publisher could take. */
export function isMaintainerFixable(code: EvidenceGapCode): boolean {
  return EVIDENCE_GAP_META[code].maintainerAction !== null
}

/** True when a later run (network/rate budget restored) might resolve the gap. */
export function isNetworkRecoverable(code: EvidenceGapCode): boolean {
  return EVIDENCE_GAP_META[code].retryable
}
