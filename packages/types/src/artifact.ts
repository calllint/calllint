/**
 * calllint.artifact.v1 — Artifact Identity.
 *
 * Pins WHAT a Trust Gateway run evaluates: source, the immutable resolved ref,
 * and the digest of fetched bytes. A mutable `requestedRef` (branch/tag/latest/
 * range) must be pinned to an immutable `resolvedRef` before the state machine
 * may leave RESOLVED. This is the anchor every downstream object binds.
 *
 * See ADR 0035 (Automated Trust Gateway & Authority Manifest) and
 * schemas/artifact-identity.schema.json.
 */

/** How the target was located. git/npm are remote; dir/file/mcp-config are local. */
export type ArtifactSourceType = "git" | "dir" | "file" | "npm" | "mcp-config"

/**
 * Whether the artifact was pinned to an immutable, digested identity.
 * - "resolved": resolvedRef + digest present (byte-identical, reproducible).
 * - "partial" / "unresolved": could not fully pin (e.g. offline remote target).
 *   Never reads as a verified target; blocks leaving RESOLVED.
 */
export type ArtifactResolution = "resolved" | "partial" | "unresolved"

export interface ArtifactIdentity {
  schema: "calllint.artifact.v1"
  sourceType: ArtifactSourceType
  /** The user-supplied locator, verbatim. */
  source: string
  /** What the user asked for; may be mutable; null for a bare local path. */
  requestedRef: string | null
  /** Immutable ref (git commit / exact version / local content marker). null ⇒ not fully resolved. */
  resolvedRef: string | null
  /** sha256 of fetched bytes. null ⇒ not fully resolved. */
  digest: `sha256:${string}` | null
  /** ISO-8601 UTC, injected from the CLI edge (never Date.now() in pure core). */
  resolvedAt: string
  resolution: ArtifactResolution
  /** Non-empty ⇒ resolution must be partial | unresolved. */
  resolutionReasons?: string[]
}

export const ARTIFACT_SCHEMA_VERSION = "calllint.artifact.v1" as const
