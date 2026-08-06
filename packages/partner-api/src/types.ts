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

/**
 * The freshness projection as it appears on an `index.json` entry (S-2).
 *
 * STRUCTURALLY MIRRORED, not imported — `@calllint/trust-index` is in `SCANNER_PKGS`
 * (`no-scanner.test.ts:24`) and this package's only permitted dependency is
 * `@calllint/types` (`:43`). Same constraint that produced `EnvelopePublisher` above.
 * `freshness-envelope.test.ts` asserts this key set equals the one on live baked bytes,
 * because a mirror with no agreement assertion is just a second source of truth.
 *
 * DISPLAY AXIS, never safety. ADR 0053 §5 forbids combining the independent dimensions
 * into a score and ADR 0061 §4 makes `computeVerdict` the only verdict engine: a stale
 * page is not a less-safe page. Served VERBATIM from the baked entry — this package
 * cannot recompute it (the calculator lives in a forbidden package), and that constraint
 * is correct rather than inconvenient: a serving deployable that computes can drift.
 *
 * `ageDays` is null exactly when `state` is `TIMELESS` — the fixture anchor, which a
 * naive subtraction would report as ~20 671 days stale.
 */
export interface EnvelopeFreshness {
  ageDays: number | null
  state: FreshnessStateName
  cadenceDays: number
  basis: string
}

/**
 * The mirror's key set and state set as RUNTIME values.
 *
 * An `interface` is erased at compile time, so a runtime test that "checks the mirror"
 * against baked bytes can only ever check a restatement of it — and a restatement is a
 * second source of truth, the exact failure this mirror exists to avoid. So the runtime
 * constant is primary, the type is DERIVED from it, and `_FreshnessMirrorIsExhaustive`
 * below fails the typecheck if the two ever drift. That gives three-way coverage: drop a
 * key from either side and the compiler reds; stop emitting one at bake time and
 * `freshness-envelope.test.ts` reds on live bytes.
 */
export const FRESHNESS_KEYS = ["ageDays", "basis", "cadenceDays", "state"] as const
export const FRESHNESS_STATES = ["FRESH", "AGING", "STALE", "TIMELESS"] as const
export type FreshnessStateName = (typeof FRESHNESS_STATES)[number]

/** Compile-time bridge: non-empty on EITHER side of the difference ⇒ typecheck error. */
type AssertNever<T extends never> = T
export type _FreshnessMirrorIsExhaustive = AssertNever<
  | Exclude<keyof EnvelopeFreshness, (typeof FRESHNESS_KEYS)[number]>
  | Exclude<(typeof FRESHNESS_KEYS)[number], keyof EnvelopeFreshness>
>

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
  /**
   * The baked freshness projection (S-2). Present iff the index entry carried one —
   * omitted otherwise, so envelopes served from a tree baked before S-2 are unchanged
   * byte for byte. Its absence means "not measured", never "fresh": UNKNOWN is not SAFE
   * applies to the time axis too.
   */
  freshness?: EnvelopeFreshness
  trustPageUrl: string
  correctionUrl: string
  /** The pre-baked sidecar payload (or its authority slice). Already PII-free. */
  data: unknown
}
