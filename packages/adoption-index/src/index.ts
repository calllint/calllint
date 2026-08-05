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

// Evidence compilation (§16.1, ADR 0061) — R-5. Reads bytes ALREADY verified into the CAS and
// re-measures them; there is no `fetchImpl` anywhere in this group, which is what makes "offline"
// a property of the types rather than a claim in a comment.
export type { SurfaceExtraction } from "./artifacts/documentSurfaces.js"
export { extractDocumentSurfaces, SURFACE_SIZE_CAP } from "./artifacts/documentSurfaces.js"
export type { CasReadAccepted, CasReadRefused, CasReadResult } from "./artifacts/casRead.js"
export { readVerifiedBlob } from "./artifacts/casRead.js"
export type { TarEntryVisitor } from "./artifacts/tarInspect.js"
export type { EvidenceDigestInput } from "./domain/evidenceDigest.js"
export { evidenceDigest, observationDigest } from "./domain/evidenceDigest.js"
export type { EvidenceDocument, RecordedSurface } from "./domain/evidenceDocument.js"
export { EVIDENCE_DOCUMENT_SCHEMA, serializeEvidenceDocument } from "./domain/evidenceDocument.js"
export {
  EVIDENCE_COMPILATION_INPUT_STATUSES,
  isEvidenceCompilable,
} from "./domain/evidenceInputs.js"
export type {
  EvidenceRecordWrite,
  EvidenceWriteResult,
  StoredEvidenceRecord,
} from "./storage/store.js"
export type {
  CompileEvidenceInput,
  EvidenceCompilationOutcome,
  EvidenceCompilationRecord,
  EvidenceCompilationSummary,
} from "./operations/compileEvidence.js"
export {
  compileEvidence,
  describeEvidenceCompilation,
  DEFAULT_MAX_EVIDENCE_ARTIFACTS,
} from "./operations/compileEvidence.js"

// Compiler jobs and runs (§7.1, §10.2) — R-6. The QUEUE: whether a unit of compiler work is
// waiting, held, or finished. Not the seven INV-10 terminal states (those are a per-source-record
// CONCLUSION and land on `adoption_records`), and not any of the four other state vocabularies this
// package already exports — `jobStates.ts`'s docblock names each one it is not.
export type {
  CompilerJobState,
  CompilerJobType,
  CompilerJobV1,
  CompilerRunMetrics,
  CompilerRunState,
  CompilerRunType,
  CompilerRunV1,
} from "./domain/job.js"
export {
  COMPILER_JOB_SCHEMA,
  COMPILER_JOB_STATES,
  COMPILER_JOB_TYPES,
  COMPILER_RUN_METRIC_KEYS,
  COMPILER_RUN_SCHEMA,
  COMPILER_RUN_STATES,
  COMPILER_RUN_TYPES,
  assertDigestShape,
  assertLeaseCoherent,
  assertRunMetrics,
  compilerJobId,
  compilerRunId,
  emptyRunMetrics,
  parseRunMetrics,
  serializeRunMetrics,
  toCompilerJobDocument,
  toCompilerRunDocument,
} from "./domain/job.js"
export {
  COMPILER_JOB_TRANSITIONS,
  COMPILER_RUN_TRANSITIONS,
  LEASABLE_JOB_STATES,
  assertJobTransition,
  assertRunTransition,
  canTransitionJob,
  canTransitionRun,
  isLeasableJobState,
  isTerminalJobState,
  isTerminalRunState,
} from "./domain/jobStates.js"
export type {
  CompilerJobCompletion,
  CompilerJobEnqueue,
  CompilerJobEnqueueResult,
  CompilerJobLeaseRequest,
  CompilerJobRenewal,
  CompilerRunBegin,
  CompilerRunConclusion,
  StoredCompilerJob,
  StoredCompilerRun,
} from "./storage/store.js"
export { DEFAULT_JOB_PRIORITY } from "./storage/store.js"
export type {
  AttemptDisposition,
  AttemptOutcome,
  BeginRunInput,
  ConcludeRunInput,
  EnqueueJobsInput,
  EnqueueJobsResult,
  JobRequest,
  LeaseNextInput,
  ReclaimInput,
  RenewLeaseInput,
  ScheduleFn,
  SettleAttemptInput,
  WithCompilerRunInput,
} from "./operations/compilerQueue.js"
export {
  DEFAULT_BACKOFF_MS,
  DEFAULT_MAX_ATTEMPTS,
  MAX_BACKOFF_MS,
  beginCompilerRun,
  concludeCompilerRun,
  decideDisposition,
  enqueueJobs,
  gradeRun,
  leaseNextJob,
  reclaimExpiredLeases,
  renewLease,
  retryDelayMs,
  settleAttempt,
  withCompilerRun,
} from "./operations/compilerQueue.js"

// R-7 — adoption records (THE canonical system asset)
export type {
  AdoptionLifecycleStatus,
  AdoptionRecordDecision,
  AdoptionRecordDigests,
  AdoptionRecordEvidence,
  AdoptionRecordHostCompatibility,
  AdoptionRecordLifecycle,
  AdoptionRecordSource,
  AdoptionRecordSubject,
  AdoptionRecordArtifact,
  AdoptionRecordV1,
  AdoptionVerdict,
  HostInstallability,
  HostTier,
} from "./domain/adoptionRecord.js"
export {
  ADOPTION_LIFECYCLE_STATUSES,
  ADOPTION_RECORD_SCHEMA,
  adoptionRecordDigest,
  isAdoptionLifecycleStatus,
} from "./domain/adoptionRecord.js"
export type { AdoptionDigestName } from "./domain/adoptionDigestSet.js"
export {
  ADOPTION_DIGEST_CHAIN,
  NULLABLE_ADOPTION_DIGESTS,
  assertDigestChain,
} from "./domain/adoptionDigestSet.js"
export type {
  CompileAdoptionRecordInput,
  DecisionInputs,
  PresentationInputs,
} from "./operations/compileAdoptionRecord.js"
export {
  compileAdoptionRecord,
  compileAdoptionRecordWithDigest,
} from "./operations/compileAdoptionRecord.js"
export type {
  AdoptionRecordWrite,
  AdoptionRecordWriteResult,
  StoredAdoptionRecord,
} from "./storage/store.js"

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
