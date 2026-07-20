/**
 * calllint.evidence-model.v0 — the identity-resolution model (new11 P1 §4.1–4.6).
 *
 * DISTINCT from the provider envelope (calllint.evidence-provider.v0 in ../types.ts,
 * which normalizes a third-party scanner's report). THIS model answers "what do we
 * know about WHO/WHAT this artifact is, and what's missing?" — the input to the
 * Trust Index and the reason UNKNOWN is UNKNOWN.
 *
 * The model is pure data. Resolvers (in @calllint/resolver) fill it; the CLI edge
 * does all I/O and injects results. Nothing here reaches the network or the clock.
 */
import type { EvidenceGapCode } from "./reasonCodes.js"

/** The kinds of thing evidence can be gathered about. */
export const SUBJECT_TYPES = [
  "npm-package",
  "github-repo",
  "mcp-registry-entry",
  "domain",
  "remote-endpoint",
  "tool",
] as const
export type SubjectType = (typeof SUBJECT_TYPES)[number]

/** WHAT evidence is about. `id` is the stable, resolver-agnostic locator. */
export interface EvidenceSubject {
  schema: "calllint.evidence-subject.v0"
  subjectType: SubjectType
  /** Stable locator, verbatim (e.g. "npm:foo@1.2.3", "github.com/o/r", host). */
  id: string
  /** Optional digest binding once the artifact identity is pinned. */
  artifactDigest?: `sha256:${string}` | null
}

/**
 * Evidence-source priority ladder (§4.6). Higher wins; a lower source NEVER
 * overrides a higher one. Equal-priority disagreement is CONFLICTING_EVIDENCE.
 */
export const EVIDENCE_TIERS = [
  "inferred", // 0 — heuristic / derived, weakest
  "repository", // 1
  "publisher-signed", // 2
  "registry", // 3
  "artifact-bound", // 4 — pinned to the digest, strongest
] as const
export type EvidenceTier = (typeof EVIDENCE_TIERS)[number]

/** The rank of a tier (index in EVIDENCE_TIERS); higher = more authoritative. */
export function tierRank(tier: EvidenceTier): number {
  return EVIDENCE_TIERS.indexOf(tier)
}

/** One resolved fact about a subject, tagged with the source tier that produced it. */
export interface EvidenceItem {
  /** Dotted field this item establishes, e.g. "identity.version", "repo.url". */
  field: string
  value: string
  tier: EvidenceTier
  /** Which resolver produced it (for replay/debug), e.g. "R1:npm". */
  source: string
}

/** A single unresolved gap instance: a code plus the specifics discovered here. */
export interface EvidenceGap {
  schema: "calllint.evidence-gap.v0"
  code: EvidenceGapCode
  /** Specific, non-secret detail for THIS occurrence (safe to show a user). */
  detail: string
  /** Dotted field names that are still missing. */
  missingFields: string[]
  /** Resolver ids that were tried before giving up, e.g. ["R1:npm"]. */
  triedResolvers: string[]
}

/** Terminal-ness of a resolver invocation (§4.2). */
export type ResolverStatus =
  | "complete"
  | "partial"
  | "unresolvable"
  | "retryable-failure"

/** What one resolver returns. Never throws to signal failure — it returns gaps. */
export interface ResolverResult {
  resolver: string
  status: ResolverStatus
  items: EvidenceItem[]
  gaps: EvidenceGap[]
}

/** Resolution state machine states (§4.5). */
export const RESOLUTION_STATES = [
  "DISCOVERED",
  "QUEUED",
  "RESOLVING",
  "COMPLETE",
  "PARTIAL",
  "UNRESOLVABLE",
  "RETRYABLE_FAILURE",
  "PUBLISHED",
] as const
export type ResolutionState = (typeof RESOLUTION_STATES)[number]

/** The aggregated evidence for a subject across all resolvers. */
export interface EvidenceBundle {
  schema: "calllint.evidence-bundle.v0"
  subject: EvidenceSubject
  state: ResolutionState
  items: EvidenceItem[]
  gaps: EvidenceGap[]
}
