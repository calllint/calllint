export interface Fingerprints {
  /** Hash of the raw config object for this server. */
  configHash: string
  /** Hash of the normalized target spec (command + args + envKeys). */
  targetSpecHash: string
  /** Hash of the package spec (name@version) when applicable. */
  packageSpecHash?: string
  /** Hash of provided source text, when applicable. */
  sourceHash?: string
  /** Hash of provided tool metadata, when applicable. */
  toolMetadataHash?: string
  /** Hash of the set of risk symbols + finding ids (the "risk surface"). */
  riskSurfaceHash: string
}

export const REPRODUCIBILITY_LEVELS = ["HIGH", "MEDIUM", "LOW"] as const
export type ReproducibilityLevel = (typeof REPRODUCIBILITY_LEVELS)[number]

export interface Reproducibility {
  level: ReproducibilityLevel
  reasons: string[]
}

// ---------------------------------------------------------------------------
// Capability Fingerprint v0 (new4 L1 contract — ADR 0019)
//
// The minimal, hashable, HOST-AGNOSTIC description of one capability about to
// enter the workspace. Additive to the Evidence-layer `Fingerprints` above:
// `Fingerprints` are content hashes for reproducibility; `CapabilityFingerprint`
// is the risk identity that the same MCP capability shares across any host.
// ---------------------------------------------------------------------------

/** What kind of capability surface this fingerprint describes. */
export const FP_KINDS = [
  "mcp_server",
  "install_snippet",
  "action_step",
  "gateway_runtime",
  "unknown",
] as const
export type FpKind = (typeof FP_KINDS)[number]

/** How the capability is launched (resolved beyond the surface command). */
export const FP_LAUNCH = [
  "local:npx",
  "local:uvx",
  "local:node",
  "local:python",
  "local:docker",
  "remote:http",
  "remote:sse",
  "unknown",
] as const
export type FpLaunch = (typeof FP_LAUNCH)[number]

/** Transport the capability speaks over. */
export const FP_TRANSPORT = ["stdio", "http", "sse", "unknown"] as const
export type FpTransport = (typeof FP_TRANSPORT)[number]

/** Where the capability is scoped (derived from the surface origin). */
export const FP_SCOPE = [
  "workspace",
  "user",
  "system",
  "external",
  "unknown",
] as const
export type FpScope = (typeof FP_SCOPE)[number]

/** Coarse, closed-vocabulary effect hints (derived from detector findings). */
export const FP_EFFECTS = [
  "local_execution",
  "filesystem_broad",
  "network_egress",
  "external_mutation_unknown",
  "payment",
  "messaging",
  "prompt_instruction",
  "oauth_scope",
  "gateway_runtime",
] as const
export type FpEffect = (typeof FP_EFFECTS)[number]

/** Provenance of the capability. Never "verified" without a real check. */
export const FP_IDENTITY = ["verified", "known", "unknown"] as const
export type FpIdentity = (typeof FP_IDENTITY)[number]

/**
 * The canonical L1 contract. Exactly 8 semantic fields (ADR 0019). `authority`
 * carries env KEY NAMES only, never values. The hash (see core/extract) sorts
 * and dedupes `authority`/`effects` before hashing and excludes `schemaVersion`.
 */
export interface CapabilityFingerprint {
  schemaVersion: "calllint.fingerprint.v0"
  kind: FpKind
  /** Canonical origin: npm:NAME@SPEC | git:… | url:… | local:… | unknown. */
  source: string
  launch: FpLaunch
  transport: FpTransport
  /** Declared powers, KEY NAMES only — never secret values. */
  authority: string[]
  scope: FpScope
  effects: FpEffect[]
  identity: FpIdentity
}
