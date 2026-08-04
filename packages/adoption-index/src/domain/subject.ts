/**
 * subject — the identity layer's four document types (§7.1, ADR 0061), written by R-3.
 *
 * `SourceRecordV1` records what ONE source claimed. These four record what identity
 * resolution CONCLUDED across records, which is why `identityBasis` exists at all: a
 * conclusion without its evidence is indistinguishable from a guess.
 *
 * THREE PLACES THESE TYPES DELIBERATELY DIVERGE FROM THE DDL, each measured rather than
 * assumed — the schemas are the DOCUMENT shape and `migrations/001` is the STORAGE shape,
 * and they are not 1:1:
 *
 *   - `canonical_subjects.identity_digest` is `NOT NULL` in the DDL and absent from
 *     `calllint.canonical-subject.v1`'s 11 required properties (which is
 *     `additionalProperties: false`, so adding it here would make every subject invalid).
 *     It is a STORAGE-derived column, computed where `sourceRecordRowId` is computed.
 *   - `canonical_subjects` has no `sourceRecordIds`/`identityBasis` columns; `subject_aliases`
 *     carries them, one row per basis — its four columns are exactly
 *     `{value, subject, sourceRecordId, kind}`.
 *   - `artifact_versions` has `cache_key`/`first_seen_at`/`last_verified_at` columns that the
 *     schema forbids as properties, and the schema requires a `packageRegistry` the DDL has
 *     no column for. Both directions are real; neither is a defect.
 *
 * THE R-4 BOUNDARY IS ENCODED IN THE OPTIONALITY, NOT IN A COMMENT. `immutableDigest` is
 * `required` AND nullable ⇒ R-3 must write an explicit `null`. `registryIntegrity` is
 * `{type: "string", minLength: 1}` — NOT nullable, NOT required ⇒ R-3 must OMIT the key
 * entirely; writing `null` there would fail the schema it was meant to satisfy. That
 * asymmetry is the whole reason this is spelled out: the plan said "leave both null", and
 * the schema says only one of them may be.
 */

/**
 * What justified a subject's identity, and which record supplied it.
 *
 * `repository-url` and `verified-publisher` appear here as EVIDENCE and are never grouping
 * keys — measured over the committed corpus, 9 of 19 entries have `repositoryUrl: null`
 * (`null === null` in a JS Map but not in SQL, so a group-by would fuse 9 unrelated
 * products into one subject), and the one apparent publisher collision,
 * `ai.agenticshelf/{graffeo,mcp,puroair}`, is a coffee roaster, an e-commerce catalog and
 * an air-purifier brand sharing one hosting platform. Recording evidence and keying on it
 * are different acts.
 */
export type IdentityBasisKind =
  | "registry-canonical-name"
  | "repository-url"
  | "package-identifier"
  | "verified-publisher"

export interface IdentityBasis {
  kind: IdentityBasisKind
  value: string
  sourceRecordId: string
}

/**
 * `CONFLICT` is TERMINAL, never a warning: silently merging two products would attach one
 * product's evidence to the other's page. `PROVISIONAL` means resolved-from-a-single-source
 * and is what every subject gets in this release (§8.1 seeds identity from the Official MCP
 * Registry canonical name and keeps broad multi-source merges off), so `RESOLVED` is
 * deliberately unreachable in R-3.
 */
export type IdentityStatus = "RESOLVED" | "PROVISIONAL" | "CONFLICT" | "TOMBSTONED"

export interface CanonicalSubjectV1 {
  schema: "calllint.canonical-subject.v1"
  subjectId: string
  /**
   * The AUTHORITATIVE key: the original registry name, never the lossy slug.
   * `registryCanonicalName` lowercases and maps `[^a-z0-9._-]+` → `-`, so the reverse-DNS
   * `/` boundary becomes indistinguishable from a literal `-`: `a.b/c` collides with `a.b-c`,
   * and case folding puts `A.B/C` on the same slug.
   *
   * MEASURED CORRECTION, kept rather than deleted because the rule it supports is right and
   * load-bearing. This said `a.b/c` collides with `a-b-c`, and `.` separators flatten. Neither
   * holds: `.` and `_` are INSIDE the preserved class `[^a-z0-9._-]` and survive, so only `/`
   * is rewritten — `a.b/c` → `a.b-c` while `a-b-c` → `a-b-c`, two distinct slugs. The
   * conclusion (the slug is lossy ⇒ never a key) is unaffected; a wrong witness is simply what
   * makes a true rule untestable. Same correction as `resolveIdentity.ts`'s docblock.
   *
   * The other half of that measurement DOES hold and is kept: 19/19 committed names contain a
   * `/`, so every one of them passes through the irreversible rewrite.
   */
  canonicalName: string
  /** Derived from `canonicalName` by the shipped slug function. May COLLIDE — see above. */
  canonicalSlug: string
  displayName: string
  aliases: string[]
  sourceRecordIds: string[]
  identityBasis: IdentityBasis[]
  identityStatus: IdentityStatus
  firstSeenAt: string
  lastSeenAt: string
}

/**
 * One `subject_aliases` row. `aliasType` mirrors `IdentityBasisKind` because the table is
 * where `identityBasis` is persisted; `sourceRecordId` is nullable in the DDL for an alias
 * no single record supplied (a derived slug, for instance).
 */
export interface SubjectAliasV1 {
  alias: string
  subjectId: string
  sourceRecordId: string | null
  aliasType: IdentityBasisKind
}

/**
 * `UNAVAILABLE` and `UNSUPPORTED` never upgrade to a verdict of SAFE. Resolving an artifact
 * NEVER executes it (INV-R3, the cardinal safety line).
 *
 * R-3 writes only `RESOLVED` (the registry declared a package we understand) and
 * `UNSUPPORTED`. `FETCHED` requires an adapter, and `UNAVAILABLE`/`REJECTED` require having
 * tried — all three are R-4's to write.
 */
export type ArtifactStatus = "RESOLVED" | "FETCHED" | "UNAVAILABLE" | "UNSUPPORTED" | "REJECTED"

export interface ArtifactVersionV1 {
  schema: "calllint.artifact-version.v1"
  artifactVersionId: string
  subjectId: string
  version: string | null
  packageType: string
  packageIdentifier: string
  /**
   * The registry HOST, which the snapshot does not declare — `packages[]` keys are exactly
   * `{registryType, identifier, version, transport}`. `null` until R-4's adapter resolves
   * it; `packageType` already carries `registryType`.
   */
  packageRegistry: string | null
  sourceLocator: string
  /**
   * `null` in R-3, and REQUIRED to be present as `null`. The registry snapshot declares no
   * digest anywhere (measured: 2 packages / 18 remotes over 19 entries, no digest field on
   * either), so a fabricated one would be worse than an honest absence.
   */
  immutableDigest: string | null
  /**
   * OPTIONAL and non-nullable in the schema, so R-3 omits it rather than nulling it. R-4
   * sets it when a registry supplies an integrity claim.
   */
  registryIntegrity?: string
  artifactStatus: ArtifactStatus
}

export type ConflictType =
  | "canonical-name-collision"
  | "slug-collision"
  | "repository-url-divergence"
  | "package-identifier-divergence"
  | "publisher-divergence"

/**
 * `OPEN` and `ACKNOWLEDGED` both keep the subject at `CONFLICT`; only `RESOLVED` carrying a
 * `resolution` may release it. `resolvedAt` and `resolution` move in LOCKSTEP with that — a
 * resolved conflict without a recorded resolution is indistinguishable from a dropped one.
 */
export type ConflictStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED"

export interface ConflictResolution {
  outcome: "MERGED" | "SPLIT" | "TOMBSTONED" | "DISMISSED"
  decidedBy: "human" | "policy"
  rationale: string
  winningSourceRecordId?: string | null
}

export interface IdentityConflictV1 {
  schema: "calllint.identity-conflict.v1"
  conflictId: string
  subjectKey: string
  conflictType: ConflictType
  /**
   * EVERY participating record. A conflict naming one record is not a conflict, which is
   * why the schema sets `minItems: 2` and why `assertConflictParticipants` exists: the
   * refusal has to carry the evidence a human needs to adjudicate it, or the fail-closed
   * path has thrown away its own output.
   */
  sourceRecordIds: string[]
  status: ConflictStatus
  createdAt: string
  resolvedAt?: string | null
  resolution?: ConflictResolution | null
}

export const CANONICAL_SUBJECT_SCHEMA = "calllint.canonical-subject.v1" as const
export const ARTIFACT_VERSION_SCHEMA = "calllint.artifact-version.v1" as const
export const IDENTITY_CONFLICT_SCHEMA = "calllint.identity-conflict.v1" as const

/**
 * The terminal identity states: a subject in one of these is NOT a candidate for
 * projection, and neither may be reached by inference. Frozen so a caller cannot widen the
 * set at runtime — the same arrangement `TERMINAL_CHECKPOINT_STATUSES` uses.
 */
export const TERMINAL_IDENTITY_STATUSES: readonly IdentityStatus[] = Object.freeze([
  "CONFLICT",
  "TOMBSTONED",
])

export function isTerminalIdentityStatus(status: IdentityStatus): boolean {
  return TERMINAL_IDENTITY_STATUSES.includes(status)
}

/**
 * A conflict is released only by an explicit `RESOLVED` **carrying** a resolution. Written
 * as one predicate rather than two comparisons at each call site so the lockstep rule has a
 * single definition: `status === "RESOLVED"` alone is exactly the mutation control #8
 * makes.
 */
export function releasesSubject(conflict: IdentityConflictV1): boolean {
  return conflict.status === "RESOLVED" && conflict.resolution != null
}

/**
 * `minItems: 2`, enforced at construction rather than only at validation. The resolver
 * builds conflicts from a group it has already proven has ≥2 members, so a single-member
 * conflict means the grouping logic broke — throwing names that, where a schema failure
 * downstream would name the document.
 */
export function assertConflictParticipants(ids: readonly string[], subjectKey: string): void {
  if (ids.length < 2) {
    throw new Error(
      `identity conflict for "${subjectKey}" names ${ids.length} source record(s); a conflict naming fewer than 2 is not a conflict`,
    )
  }
}
