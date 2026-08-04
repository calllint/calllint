/**
 * @calllint/adoption-index — the Canonical Adoption Index store (Phase 2.3, ADR 0061).
 *
 * PRIVATE AND STRUCTURALLY UNREACHABLE from the published surface, by two independent
 * mechanisms, because either one alone is insufficient:
 *
 *   - `"private": true` stops PUBLISHING. It does not stop importing, and it does not
 *     even stop installing: the workspace globs `packages/*` and CI runs
 *     `pnpm install --frozen-lockfile`, so this package's native driver resolves on all
 *     three CI legs regardless.
 *   - The import-boundary scan stops REACHING. `calllint` and `calllint-mcp` ship as
 *     esbuild bundles with empty runtime dependencies; `better-sqlite3` is a `.node`
 *     binary and cannot be bundled. So no publishable package may name this one, and a
 *     gate asserts it rather than trusting it.
 *
 * The compiler NEVER executes a target, writes ZERO host configuration, and persists only
 * under `.var/calllint-adoption-index/` (INV-R3, INV-R7). The Trust Gateway remains the
 * one live-config writer.
 */

// Domain (§7.1)
export type {
  SourceRecordV1,
  SourcePackageRef,
  SourceRemoteRef,
  SourceType,
  SourceLifecycleStatus,
} from "./domain/sourceRecord.js"
export { SOURCE_RECORD_SCHEMA } from "./domain/sourceRecord.js"
export type { SourceCheckpoint, CheckpointStatus } from "./domain/checkpoint.js"
export type {
  CanonicalSubjectV1,
  SubjectAliasV1,
  ArtifactVersionV1,
  IdentityConflictV1,
  IdentityBasis,
  IdentityBasisKind,
  IdentityStatus,
  ArtifactStatus,
  ConflictType,
  ConflictStatus,
  ConflictResolution,
} from "./domain/subject.js"
export {
  CANONICAL_SUBJECT_SCHEMA,
  ARTIFACT_VERSION_SCHEMA,
  IDENTITY_CONFLICT_SCHEMA,
  TERMINAL_IDENTITY_STATUSES,
  isTerminalIdentityStatus,
  releasesSubject,
  assertConflictParticipants,
} from "./domain/subject.js"
export {
  ARTIFACT_TRANSITIONS,
  ARTIFACT_RESOLUTION_INPUT_STATUSES,
  isTerminalArtifactStatus,
  canTransitionArtifact,
  assertArtifactTransition,
} from "./domain/artifactTransitions.js"
export {
  TERMINAL_CHECKPOINT_STATUSES,
  isTerminalCheckpointStatus,
  assertUsableCheckpoint,
  emptyCheckpoint,
} from "./domain/checkpoint.js"

// Storage (§10.2, §10.3, §11.1)
export type { SqliteDatabase, SqliteDriver, SqliteStatement } from "./storage/driver.js"
export { openBetterSqlite3 } from "./storage/driver.js"
export type { IndexPaths } from "./storage/paths.js"
export {
  INDEX_ROOT_DIRNAME,
  INDEX_SUBDIRS,
  resolveIndexPaths,
  isInsideRoot,
  casBlobPath,
  casStagingPath,
} from "./storage/paths.js"
export type { Migration, AppliedMigration } from "./storage/migrate.js"
export { loadMigrations, applyMigrations, readAppliedMigrations } from "./storage/migrate.js"
export type {
  AdoptionIndexTx,
  OpenStoreOptions,
  PersistResult,
  PersistIdentityResult,
  ResolvedIdentityWrite,
  StoredSourceRecord,
  StoredSubject,
  StoredSubjectAlias,
  StoredIdentityConflict,
  StoredArtifactVersion,
  ArtifactResolutionWrite,
} from "./storage/store.js"
export { AdoptionIndexStore, sourceRecordRowId, subjectIdentityDigest, subjectSlugRow } from "./storage/store.js"

// Identity (§7.1, §8.1) — the pure resolver, written by R-3.
export type { ResolveIdentityOptions, ResolveIdentityResult } from "./identity/resolveIdentity.js"
export {
  resolveIdentity,
  canonicalSlug,
  claimedName,
  publisherHead,
  subjectId,
  artifactVersionId,
  conflictId,
  participantId,
  REGISTRY_SLUG_NAMESPACE,
  RESOLVABLE_PACKAGE_TYPES,
} from "./identity/resolveIdentity.js"

// Sources (§9.3, §9.4)
export type {
  SourceAdapter,
  SourceSyncContext,
  SyncOutcome,
  // Exported because `SyncSourceResult.truncationReason` is part of the public shape: a caller
  // that switches on it needs the union, and re-deriving the three string literals at each call
  // site is how a fourth exit gets missed.
  SyncTruncationReason,
} from "./sources/sourceAdapter.js"
export {
  OFFICIAL_REGISTRY_SOURCE_ID,
  DEFAULT_ENDPOINT,
  DEFAULT_MAX_PAGES,
  PAGE_SIZE,
  OVERLAP_WINDOW_MS,
  createOfficialRegistryAdapter,
  toSourceRecord,
  normalizeLifecycle,
  overlappedWatermark,
  highWaterMark,
} from "./sources/officialRegistry.js"

// Operations
export type { SyncSourceOptions, SyncSourceResult } from "./operations/syncSource.js"
export { syncSource, pickLater, assertMirrorComplete, MirrorIncompleteError } from "./operations/syncSource.js"
export type {
  ChangeReason,
  RebuildScope,
  SourceChangeInput,
  SourceChangeVerdict,
} from "./operations/detectSourceChange.js"
export { detectSourceChange, describeSourceChange } from "./operations/detectSourceChange.js"
export type { RefreshFromMirrorOptions, RefreshFromMirrorResult } from "./operations/refreshFromMirror.js"
export {
  refreshFromMirror,
  cohortDigest,
  DEFAULT_MIRROR_MAX_ENTRIES,
  DEFAULT_SOURCE_ID,
} from "./operations/refreshFromMirror.js"

// Artifacts (§10, ADR 0061 §2) — R-4. Registry metadata reads and artifact DOWNLOADS only;
// nothing here executes, extracts, or installs what it describes.
export type {
  ArtifactAdapter,
  ArtifactAdapterRegistry,
  ArtifactFetchContext,
  ArtifactMetadata,
  ArtifactMetadataFailure,
  ArtifactMetadataResult,
} from "./artifacts/artifactAdapter.js"
export { createAdapterRegistry } from "./artifacts/artifactAdapter.js"
export type {
  IntegrityAlgorithm,
  IntegrityClaim,
  IntegrityClaimParse,
  IntegrityClaimRejection,
  IntegrityVerification,
} from "./artifacts/integrityClaim.js"
export {
  SUPPORTED_INTEGRITY_ALGORITHMS,
  parseIntegrityClaim,
  verifyBytesAgainstClaim,
} from "./artifacts/integrityClaim.js"
export type { TarEntry, TarInspectCaps, TarInspection, TarRefusal } from "./artifacts/tarInspect.js"
export { inspectTarball, normalizeEntryPath, DEFAULT_TAR_CAPS } from "./artifacts/tarInspect.js"
export type { CasWriteAccepted, CasWriteRefused, CasWriteResult } from "./artifacts/cas.js"
export { verifyAndStore, existsAsFile } from "./artifacts/cas.js"
export type { ArtifactDownload } from "./artifacts/npmArtifactAdapter.js"
export { npmArtifactAdapter, downloadArtifact, NPM_REGISTRY } from "./artifacts/npmArtifactAdapter.js"
export type {
  ArtifactResolutionOutcome,
  ArtifactResolutionRecord,
  ArtifactResolutionSummary,
  ResolveArtifactsInput,
} from "./operations/resolveArtifacts.js"
export {
  resolveArtifacts,
  describeArtifactResolution,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_MAX_ARTIFACT_BYTES,
  DEFAULT_MAX_ARTIFACTS,
} from "./operations/resolveArtifacts.js"

// Projections
export type {
  ProjectedSnapshot,
  ProjectedEntry,
  ProjectedPackage,
  ProjectedRemote,
  ProjectSnapshotOptions,
} from "./projections/snapshotProjection.js"
export { projectSnapshot, serializeSnapshot, isLiveCohort } from "./projections/snapshotProjection.js"

/** Where the migrations live, relative to this package root (§10.2). */
export const MIGRATIONS_DIRNAME = "migrations"
