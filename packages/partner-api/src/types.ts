import type { Verdict } from "@calllint/types"

/** The API schema version — every response carries it (ADR 0038 §4: versioned). */
export const API_SCHEMA = "calllint.partner-api.v0" as const

/** Base path all routes live under (ADR 0046 §5: same origin). */
export const API_BASE = "/v1/public" as const

/**
 * A read accessor over the committed Trust artifacts. The ONLY capability the
 * router is given: read a static file by repo-relative path (e.g.
 * "trust/index.json"). It cannot resolve, fetch, or scan — that is what keeps
 * "no scanner in the serving deployable" (ADR 0046 §4) structural, not merely
 * disciplinary. Returns the file text, or null if absent.
 */
export type AssetReader = (relPath: string) => Promise<string | null>

/** A minimal, framework-agnostic request the router understands. */
export interface ApiRequest {
  method: string
  /** Pathname only, no query string (e.g. "/v1/public/resources/mcp-registry/ai.foo"). */
  path: string
  /** Lower-cased header lookup; used for conditional GET (if-none-match). */
  headers?: Record<string, string | undefined>
}

/** A framework-agnostic response the adapter turns into a platform Response. */
export interface ApiResponse {
  status: number
  headers: Record<string, string>
  /** Already-serialized body (JSON text), or "" for 204/304. */
  body: string
}

/**
 * A baked maintainer-claim overlay as it appears on a sidecar (ADR 0048 §2/§6).
 * NAMESPACE CONTROL, never safety. Structurally mirrored here (partner-api reads no
 * scanner package, so it cannot import the trust-index type) and surfaced verbatim.
 */
export interface EnvelopePublisher {
  owner: string
  verifiedAt: string
  observedArtifactDigest: string
}

/** The public envelope wrapping a pre-baked Trust Page sidecar. */
export interface ApiEnvelope {
  schema: typeof API_SCHEMA
  kind: "resource" | "artifact" | "authority" | "manifest"
  canonicalName: string
  artifactDigest: string
  pageDigest: string
  verdict: Verdict
  verdictLabel: string
  observedAt: string
  completeness: string
  /**
   * Optional maintainer-claim overlay (ADR 0048). Present iff the baked page carried
   * a `verifiedPublisher` (a verified namespace claim). Omitted otherwise — never a
   * safety signal, and its absence NEVER implies unsafe (just unclaimed).
   */
  verifiedPublisher?: EnvelopePublisher
  trustPageUrl: string
  correctionUrl: string
  /** The pre-baked sidecar payload (or its authority slice). Already PII-free. */
  data: unknown
}
