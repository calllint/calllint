/**
 * store — the AdoptionIndexStore: repositories over the driver port (§10.3).
 *
 * §10.3 says "implement interfaces, do not spread raw SQL through compilers". Every SQL
 * string in this package lives in this file or in a migration; a compiler batch (R-2…R-9)
 * calls a method. That is what keeps the canonical schema changeable in one place.
 *
 * THE ORDERING RULE, ENFORCED BY SHAPE. §9.4: "Never advance the checkpoint before all
 * fetched records are persisted." A comment cannot enforce that, so the API does:
 * `persistSourceRecords` and `advanceCheckpoint` are both only reachable through a
 * transaction handle (`AdoptionIndexTx`), and `syncSource` commits them together. A
 * caller cannot advance a checkpoint in one transaction and persist records in another
 * without writing a second transaction on purpose.
 *
 * NO WALL CLOCK. Every timestamp is an explicit parameter (INV-R6, §9.5). The store has
 * no `Date` import, and the test asserts that by reading these bytes.
 */
import { mkdirSync } from "node:fs"
import { hashJson } from "@calllint/fingerprint"
import type { Verdict } from "@calllint/types"
import type { SqliteDatabase, SqliteDriver } from "./driver.js"
import { applyMigrations, loadMigrations, readAppliedMigrations, type Migration } from "./migrate.js"
import { resolveIndexPaths, type IndexPaths } from "./paths.js"
import {
  assertUsableCheckpoint,
  emptyCheckpoint,
  isTerminalCheckpointStatus,
  type CheckpointStatus,
  type SourceCheckpoint,
} from "../domain/checkpoint.js"
import { assertArtifactTransition } from "../domain/artifactTransitions.js"
import { assertDigestChain } from "../domain/adoptionDigestSet.js"
import {
  adoptionRecordDigest,
  isAdoptionLifecycleStatus,
  ADOPTION_LIFECYCLE_STATUSES,
  ADOPTION_RECORD_SCHEMA,
  type AdoptionLifecycleStatus,
  type AdoptionRecordV1,
} from "../domain/adoptionRecord.js"
import { isEvidenceCompilable } from "../domain/evidenceInputs.js"
import {
  assertDigestShape,
  assertLeaseCoherent,
  assertRunMetrics,
  compilerJobId,
  compilerRunId,
  COMPILER_JOB_STATES,
  COMPILER_JOB_TYPES,
  COMPILER_RUN_STATES,
  COMPILER_RUN_TYPES,
  emptyRunMetrics,
  parseRunMetrics,
  serializeRunMetrics,
  type CompilerJobState,
  type CompilerJobType,
  type CompilerRunMetrics,
  type CompilerRunState,
  type CompilerRunType,
} from "../domain/job.js"
import { assertJobTransition, assertRunTransition, isLeasableJobState } from "../domain/jobStates.js"
import type { SourceRecordV1 } from "../domain/sourceRecord.js"
import type {
  ArtifactStatus,
  ArtifactVersionV1,
  CanonicalSubjectV1,
  ConflictResolution,
  ConflictStatus,
  ConflictType,
  IdentityBasisKind,
  IdentityConflictV1,
  IdentityStatus,
  SubjectAliasV1,
} from "../domain/subject.js"

/** A row of `source_records`, as stored. `payload_json` holds the SourceRecordV1. */
export interface StoredSourceRecord {
  sourceRecordId: string
  sourceId: string
  sourceType: string
  sourceNativeId: string
  payloadDigest: string
  payloadJson: string
  lifecycleStatus: string
  retrievedAt: string
  firstSeenAt: string
  lastSeenAt: string
}

export interface PersistResult {
  /** Records whose (source, nativeId, digest) triple was new. */
  inserted: number
  /** Records already present byte-for-byte; `last_seen_at` refreshed, nothing rewritten. */
  unchanged: number
}

/** What one `persistIdentity` call wrote, per table. */
export interface PersistIdentityResult {
  subjects: number
  aliases: number
  artifacts: number
  conflicts: number
}

/**
 * One artifact's resolution outcome, as R-4 records it.
 *
 * Exactly the four columns `CHANGELOG.md` names as R-4's write surface, plus the status. Nothing
 * about identity is in here: `subject_id`, `package_type`, `package_identifier`, `version` and
 * `source_locator` belong to R-3 and this write must not touch them, or the row's
 * `artifact_version_id` — derived from four of those — would stop being derivable from the row.
 */
export interface ArtifactResolutionWrite {
  artifactVersionId: string
  /** The status this artifact moves TO. Validated against the transition table before writing. */
  artifactStatus: ArtifactStatus
  /** `sha256:<hex>` of the verified bytes, or null when no bytes were accepted. */
  immutableDigest: string | null
  /** The registry's claim, verbatim as stated, or null when it stated none. */
  registryIntegrity: string | null
  /** The CAS key of the stored blob (equal to `immutableDigest`), or null. */
  cacheKey: string | null
  /**
   * When this artifact was last VERIFIED — set only on `FETCHED`.
   *
   * Deliberately not "when we last tried". A failed attempt must not refresh it, because a
   * freshness calculator reading this column asks "how stale is what we hold", and a run of
   * 404s would otherwise report a stale blob as freshly verified. `UNAVAILABLE`/`REJECTED`
   * therefore pass null and the previous value is preserved (see `updateArtifactResolution`).
   */
  lastVerifiedAt: string | null
}

/**
 * One compiled evidence row, as R-5 records it.
 *
 * `evidenceDigest` is supplied by the caller rather than derived here, because it is a function of
 * the compilation INPUTS (`domain/evidenceDigest.ts`) and the store holds none of them — deriving
 * it in here would mean passing the four inputs plus the row, and the row's own columns are not
 * all inputs (`createdAt` deliberately is not).
 */
export interface EvidenceRecordWrite {
  /** `sha256:<hex>` over the four inputs. The PRIMARY KEY, so this decides idempotence. */
  evidenceDigest: string
  /** The artifact whose verified bytes were observed. Must already exist. */
  artifactVersionId: string
  /** The engine version whose detectors produced the findings. */
  engineVersion: string
  /** `hashJson(policy)` — the policy the findings were graded under. */
  policyDigest: string
  /** One of the four verdicts, carried verbatim. R-5 writes `UNKNOWN`; see `compileEvidence`. */
  verdict: Verdict
  /** The serialized evidence document. */
  evidenceJson: string
  /** When this observation was FIRST compiled. Never advanced by a re-run. */
  createdAt: string
}

/** Whether a `recordEvidence` call created a row or hit the existing key. */
export interface EvidenceWriteResult {
  evidenceDigest: string
  /** False when the row was already present — the idempotent path. */
  inserted: boolean
}

/** One evidence row as stored. */
export interface StoredEvidenceRecord {
  evidenceDigest: string
  artifactVersionId: string
  engineVersion: string
  policyDigest: string
  verdict: Verdict
  evidenceJson: string
  createdAt: string
}

/**
 * One job to enqueue. R-6's write surface.
 *
 * The identity triple is `(jobType, subjectKey, inputDigest)`; `jobId` is derived from it by
 * `compilerJobId` and is not accepted here, so a caller cannot supply a key that disagrees with the
 * row's own contents. `priority` and `availableAt` are the two properties a re-enqueue is allowed to
 * move — see `enqueueJob`.
 */
export interface CompilerJobEnqueue {
  jobType: CompilerJobType
  subjectKey: string
  inputDigest: string
  /** Lower runs first. Defaults to the DDL's 100 when omitted. */
  priority?: number
  /** Injected ISO-8601: when this job becomes leasable. The caller's backoff (INV-R6). */
  availableAt: string
  /** Injected ISO-8601 for `created_at` on a new row, and `updated_at` on either path. */
  now: string
}

/** Whether an `enqueueJob` call created a row, or moved an existing one's schedule. */
export interface CompilerJobEnqueueResult {
  jobId: string
  /** False when the identity triple was already queued — the idempotent path. */
  inserted: boolean
}

/** What a worker needs in order to claim one job. */
export interface CompilerJobLeaseRequest {
  /** Who is claiming. Recorded verbatim in `lease_owner`. */
  owner: string
  /** Injected ISO-8601 "now": rows with `available_at <= now` are eligible. */
  now: string
  /** Injected ISO-8601: when this claim lapses. Must be after `now`. */
  leaseExpiresAt: string
  /** Restrict the claim to one stage. Omitted ⇒ any type. */
  jobType?: CompilerJobType
}

/** A holder extending its own claim on a row it already leased. */
export interface CompilerJobRenewal {
  jobId: string
  /** Must equal the row's `lease_owner`. Named in the UPDATE's `WHERE`, not compared afterwards. */
  owner: string
  /** Injected ISO-8601 "now", for `updated_at` and the expiry sanity check. */
  now: string
  /** The new expiry. Must be after `now`. */
  leaseExpiresAt: string
}

/** How one job's work ended, as the holder reports it. */
export interface CompilerJobCompletion {
  jobId: string
  /**
   * The state to move to. `PENDING` releases the row for another attempt; the three terminal
   * states conclude it. Validated against `COMPILER_JOB_TRANSITIONS`.
   */
  state: CompilerJobState
  /** Injected ISO-8601 for `updated_at`. */
  now: string
  /** When releasing to `PENDING`: when the next attempt may start. Required for that path. */
  availableAt?: string
  lastErrorCode?: string | null
  /** `sha256:<hex>` into the CAS. The error bytes are content-addressed, never inlined. */
  lastErrorDigest?: string | null
}

/** One `compiler_runs` row to open. */
export interface CompilerRunBegin {
  runType: CompilerRunType
  inputManifestDigest: string
  /** Injected ISO-8601. Part of `runId`, so a replay with the same stamp is the same run. */
  startedAt: string
}

/** How one compiler pass ended. */
export interface CompilerRunConclusion {
  runId: string
  /** One of the three terminal run states. `RUNNING` is refused by the transition table. */
  state: CompilerRunState
  /** `null` for a crashed run — never an all-zero digest. See `job.ts`'s docblock. */
  outputManifestDigest: string | null
  /** Injected ISO-8601. */
  completedAt: string
  metrics: CompilerRunMetrics
}

/** The write surface available inside a transaction. */
export interface AdoptionIndexTx {
  persistSourceRecords(records: SourceRecordV1[], seenAt: string): PersistResult
  advanceCheckpoint(next: SourceCheckpoint): void
  readCheckpoint(sourceId: string): SourceCheckpoint
  persistIdentity(identity: ResolvedIdentityWrite): PersistIdentityResult
  updateArtifactResolution(write: ArtifactResolutionWrite): void
  recordEvidence(write: EvidenceRecordWrite): EvidenceWriteResult
  enqueueJob(job: CompilerJobEnqueue): CompilerJobEnqueueResult
  leaseJob(request: CompilerJobLeaseRequest): StoredCompilerJob | null
  renewLease(renewal: CompilerJobRenewal): boolean
  completeJob(completion: CompilerJobCompletion): void
  reclaimExpiredLeases(now: string): number
  /**
   * `beginCompilerRun`, not `beginRun`: `AdoptionIndexStore.beginRun` already exists and marks one
   * SOURCE's sync as started (`source_checkpoints`). Two different facts — a source's sync position
   * versus a whole compiler pass — and the near-collision is exactly the kind of thing that makes a
   * later reader treat two layers as one. `jobStates.ts`'s docblock names the same hazard for
   * `CheckpointStatus` versus `CompilerRunState`.
   */
  beginCompilerRun(run: CompilerRunBegin): string
  concludeCompilerRun(conclusion: CompilerRunConclusion): void
  /** R-7's write surface, and `adoption_records`' only writer. */
  upsertAdoptionRecord(write: AdoptionRecordWrite): AdoptionRecordWriteResult
}

/**
 * One `adoption_records` row to write.
 *
 * The record itself is passed whole rather than as columns: five of the nine columns are projections
 * OF the record (`decision_digest`, `lifecycle_status`, `semantic_contract_digest`,
 * `presentation_digest`, `selected_artifact_version_id`), so accepting them separately would let a
 * caller write a row whose columns disagree with the `record_json` beside them. They are derived here
 * instead, from the one object, and a negative control that passes a contradicting column has nowhere
 * to put it.
 *
 * `adoptionRecordDigest` is NOT accepted for the same reason `enqueueJob` does not accept `jobId`: it
 * is a function of the record, so a supplied value could disagree with its own contents.
 */
export interface AdoptionRecordWrite {
  record: AdoptionRecordV1
  /** Injected ISO-8601 (§9.5). Never a wall-clock read inside the store. */
  updatedAt: string
}

/** What one `upsertAdoptionRecord` did. `inserted` false ⇒ the subject's row was updated. */
export interface AdoptionRecordWriteResult {
  subjectId: string
  adoptionRecordDigest: string
  inserted: boolean
}

/**
 * The identity collections one transaction writes. Structurally identical to
 * `ResolveIdentityResult`, declared here as its own type so `store.ts` does not import from
 * `identity/` — the store is the persistence port and the resolver is a caller of it, not
 * the reverse.
 */
export interface ResolvedIdentityWrite {
  subjects: readonly CanonicalSubjectV1[]
  aliases: readonly SubjectAliasV1[]
  artifacts: readonly ArtifactVersionV1[]
  conflicts: readonly IdentityConflictV1[]
}

export interface OpenStoreOptions {
  /** Working directory the `.var/` root is resolved beneath (INV-R7). */
  cwd: string
  /** Directory holding `NNN-slug.sql`. Defaults to this package's `migrations/`. */
  migrationsDir: string
  /** Injected driver. Production passes `openBetterSqlite3`'s result. */
  db: SqliteDatabase
  /** ISO-8601 stamp recorded for any migration applied on this open (§9.5). */
  now: string
}

export class AdoptionIndexStore {
  readonly paths: IndexPaths
  readonly appliedMigrations: readonly Migration[]
  private readonly db: SqliteDatabase

  private constructor(db: SqliteDatabase, paths: IndexPaths, applied: Migration[]) {
    this.db = db
    this.paths = paths
    this.appliedMigrations = applied
  }

  /**
   * Open the store, applying any pending migration. Self-migrating on open is the
   * §10.2 contract: there is no separate migrate step to forget, and a store opened by
   * any batch is always at the current schema.
   */
  static open(opts: OpenStoreOptions): AdoptionIndexStore {
    const paths = resolveIndexPaths(opts.cwd)
    for (const dir of paths.dirs) mkdirSync(dir, { recursive: true })
    const applied = applyMigrations(opts.db, loadMigrations(opts.migrationsDir), opts.now)
    return new AdoptionIndexStore(opts.db, paths, applied)
  }

  /** The migration ids recorded in-database, ascending. */
  schemaVersion(): number[] {
    return readAppliedMigrations(this.db).map((m) => m.id)
  }

  /** Table names present in the store, sorted. Used by the canonical-DDL assertion. */
  tableNames(): string[] {
    const rows = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[]
    return rows.map((r) => r.name)
  }

  /**
   * Run `fn` inside a transaction (§10.3's `AdoptionIndexStore.transaction`). Commits on
   * resolve, rolls back on throw. `fn` is the only place the write methods exist.
   */
  transaction<T>(fn: (tx: AdoptionIndexTx) => T): T {
    this.db.exec("BEGIN")
    try {
      const out = fn(this.tx())
      this.db.exec("COMMIT")
      return out
    } catch (err) {
      this.db.exec("ROLLBACK")
      throw err
    }
  }

  private tx(): AdoptionIndexTx {
    return {
      persistSourceRecords: (records, seenAt) => this.persistSourceRecords(records, seenAt),
      advanceCheckpoint: (next) => this.writeCheckpoint(next),
      readCheckpoint: (sourceId) => this.readCheckpoint(sourceId),
      persistIdentity: (identity) => this.persistIdentity(identity),
      updateArtifactResolution: (write) => this.updateArtifactResolution(write),
      recordEvidence: (write) => this.recordEvidence(write),
      enqueueJob: (job) => this.enqueueJob(job),
      leaseJob: (request) => this.leaseJob(request),
      renewLease: (renewal) => this.renewLease(renewal),
      completeJob: (completion) => this.completeJob(completion),
      reclaimExpiredLeases: (now) => this.reclaimExpiredLeases(now),
      beginCompilerRun: (run) => this.beginCompilerRun(run),
      concludeCompilerRun: (conclusion) => this.concludeCompilerRun(conclusion),
      upsertAdoptionRecord: (write) => this.upsertAdoptionRecord(write),
    }
  }

  /**
   * Write one adoption record. R-7's write surface, and `adoption_records`' ONLY writer.
   *
   * ONE SUBJECT, EXACTLY ONE ROW. `subject_id` is the PRIMARY KEY — the opposite of
   * `source_records`, which is append-only and keyed by a payload digest. A record is a CONCLUSION
   * about a subject, and a subject has one current conclusion, so a re-compile must overwrite rather
   * than accumulate. Hence `ON CONFLICT(subject_id) DO UPDATE`, and neither shorter spelling:
   *
   *   - `INSERT OR REPLACE` deletes and re-inserts, so it cannot preserve anything about the previous
   *     row. Harmless-looking here because every column is rewritten — except that a DELETE fires
   *     `ON DELETE` behaviour on any future child table and silently changes what a re-compile means.
   *     Control (a) measures it against the row's identity.
   *   - `INSERT OR IGNORE` drops the update entirely, which is the worst of the three: a subject whose
   *     verdict moved from SAFE to BLOCK would keep serving the old conclusion, and the caller would
   *     see a successful write. That is the stale-verdict failure arriving as a cache hit — the same
   *     shape R-5 named for `evidence_records` and rejected for the opposite reason (its key is a
   *     timeless digest; this one is a mutable subject).
   *
   * EVERY COLUMN IS REWRITTEN, deliberately, unlike `enqueueJob`'s narrowed update. There is no second
   * writer to clobber: this method is the only one, and the whole row is one indivisible conclusion —
   * a row with a new `record_json` and a stale `decision_digest` beside it is not a partial update,
   * it is a corrupt record. `updated_at` moves on every write because that is what the column means.
   *
   * THE ENUM IS ASSERTED HERE, on the value being written. `lifecycle_status` is a bare
   * `TEXT NOT NULL` with no CHECK constraint in `001-canonical-adoption-graph.sql`, and TypeScript is
   * erased before SQLite sees the string, so a misspelled status would otherwise be accepted silently.
   * Same conclusion R-6 reached for `compiler_jobs.state`. Control (b) writes a misspelling.
   */
  private upsertAdoptionRecord(write: AdoptionRecordWrite): AdoptionRecordWriteResult {
    const { record } = write
    const subjectId = record.subject.subjectId

    if (record.schema !== ADOPTION_RECORD_SCHEMA) {
      throw new Error(
        `adoption record for "${subjectId}": schema must be ${ADOPTION_RECORD_SCHEMA}, got ${JSON.stringify(record.schema)}`,
      )
    }
    if (subjectId.length === 0) throw new Error("an adoption record must name a subject; found an empty subjectId")

    // The enum closure the DDL does not carry.
    if (!isAdoptionLifecycleStatus(record.lifecycle.status)) {
      throw new Error(
        `adoption record for "${subjectId}": lifecycle_status ${JSON.stringify(record.lifecycle.status)} is not one of ${ADOPTION_LIFECYCLE_STATUSES.join("|")} — the column is TEXT with no CHECK constraint, so this is the only thing standing between a typo and a stored row`,
      )
    }

    // The chain is re-checked at the boundary rather than trusted from `compileAdoptionRecord`, for
    // the R-4 reason: a guard that lives in one caller is a guard the next caller bypasses.
    assertDigestChain(record.digests)
    assertDigestShape(record.digests.decisionDigest, "decisionDigest", subjectId)

    const digest = adoptionRecordDigest(record)
    // `changes` is 1 on both branches of an upsert, so existence is read on the key before the write.
    const seenBefore =
      this.db.prepare("SELECT 1 FROM adoption_records WHERE subject_id = ?").get(subjectId) !== undefined

    this.db
      .prepare(
        `INSERT INTO adoption_records (
           subject_id, selected_artifact_version_id, adoption_record_digest, decision_digest,
           semantic_contract_digest, presentation_digest, lifecycle_status, record_json, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(subject_id) DO UPDATE SET
           selected_artifact_version_id = excluded.selected_artifact_version_id,
           adoption_record_digest = excluded.adoption_record_digest,
           decision_digest = excluded.decision_digest,
           semantic_contract_digest = excluded.semantic_contract_digest,
           presentation_digest = excluded.presentation_digest,
           lifecycle_status = excluded.lifecycle_status,
           record_json = excluded.record_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        subjectId,
        record.selectedArtifact?.artifactVersionId ?? null,
        digest,
        record.digests.decisionDigest,
        record.digests.semanticContractDigest,
        record.digests.presentationDigest,
        record.lifecycle.status,
        JSON.stringify(record),
        write.updatedAt,
      )

    return { subjectId, adoptionRecordDigest: digest, inserted: !seenBefore }
  }

  /**
   * Adoption records, by subject id, with `record_json` parsed.
   *
   * Every row's `lifecycle_status` is validated on the way OUT as well as in, for the reason
   * `listCompilerJobs` validates its state: the column has no CHECK constraint, so a row written by
   * some future path that skipped the write-path assertion would otherwise be handed to callers as an
   * `AdoptionLifecycleStatus` the type system believes in.
   */
  listAdoptionRecords(): StoredAdoptionRecord[] {
    const rows = this.db
      .prepare(
        `SELECT subject_id AS subjectId,
                selected_artifact_version_id AS selectedArtifactVersionId,
                adoption_record_digest AS adoptionRecordDigest,
                decision_digest AS decisionDigest,
                semantic_contract_digest AS semanticContractDigest,
                presentation_digest AS presentationDigest,
                lifecycle_status AS lifecycleStatus,
                record_json AS recordJson,
                updated_at AS updatedAt
         FROM adoption_records ORDER BY subject_id`,
      )
      .all() as StoredAdoptionRecord[]
    for (const r of rows) {
      if (!isAdoptionLifecycleStatus(r.lifecycleStatus)) {
        throw new Error(
          `adoption record "${r.subjectId}" carries lifecycle_status ${JSON.stringify(r.lifecycleStatus)}, which is not one of ${ADOPTION_LIFECYCLE_STATUSES.join("|")}`,
        )
      }
    }
    return rows
  }

  /** One record's payload, parsed. `null` when the subject has no record. */
  readAdoptionRecord(subjectId: string): AdoptionRecordV1 | null {
    const row = this.db
      .prepare("SELECT record_json AS recordJson FROM adoption_records WHERE subject_id = ?")
      .get(subjectId) as { recordJson: string } | undefined
    if (row === undefined) return null
    return JSON.parse(row.recordJson) as AdoptionRecordV1
  }

  /**
   * Enqueue one unit of compiler work. R-6's write surface, and `compiler_jobs`' only writer.
   *
   * IDEMPOTENT BY IDENTITY, NOT BY ATTEMPT — the schema's own words. `job_id` is `hashJson` over
   * `(jobType, subjectKey, inputDigest)`, which is also the DDL's UNIQUE triple, so the PRIMARY KEY
   * and the UNIQUE constraint are the same constraint and one upsert satisfies both. A rolling
   * compiler that re-reads a source every hour therefore updates one row instead of accumulating one
   * job per read.
   *
   * `ON CONFLICT ... DO UPDATE`, and NEITHER of the two shorter spellings would do:
   *
   *   - `INSERT OR REPLACE` deletes the row and re-inserts it, moving `created_at` forward on every
   *     enqueue. That column means "when this work was first queued"; a value that advances on every
   *     no-op makes a stuck job indistinguishable from a fresh one. Control #76 measures it. This is
   *     the same reason `recordEvidence` refuses `OR REPLACE`.
   *   - `INSERT OR IGNORE` silently discards the update, which is wrong here in a way it is NOT
   *     wrong for `evidence_records`. An evidence row is keyed by a digest of its inputs and is
   *     timeless — a duplicate carries no new information. A queue row is MUTABLE: a re-enqueue is
   *     how a caller raises priority or reschedules a backoff, and dropping that leaves the job
   *     waiting on the old schedule while the caller believes it moved. Control #77 measures it.
   *
   * THE UPDATE IS NARROWED TO THE SCHEDULE, and that is the R-4 lesson applied rather than
   * re-learned. `persistIdentity` clobbered `artifact_status` because its upsert assigned a column a
   * different writer owned. So this one assigns `priority`, `available_at` and `updated_at` and
   * nothing else: `state`, `attempt_count` and the lease columns belong to `leaseJob` /
   * `completeJob` / `reclaimExpiredLeases`, and re-enqueueing must not resurrect a terminal job or
   * reset an attempt counter. Control #75 widens it to `state = excluded.state` and observes a
   * `DEAD_LETTER` job return to `PENDING` without ever consulting the transition table.
   *
   * A re-enqueue of a TERMINAL row is therefore a schedule update on a row that will never be
   * leased again — deliberately not an error. The caller cannot know the row's state without a read
   * it has no reason to perform, and the fail-closed reading is that a terminal job stays terminal,
   * not that the enqueue throws. `enqueueJobs` reports the distinction (`inserted`) so a caller that
   * cares can see it.
   */
  private enqueueJob(job: CompilerJobEnqueue): CompilerJobEnqueueResult {
    assertJobType(job.jobType)
    assertDigestShape(job.inputDigest, "inputDigest", `${job.jobType}/${job.subjectKey}`)
    if (job.subjectKey.length === 0) throw new Error(`job "${job.jobType}" has an empty subjectKey`)
    const priority = job.priority ?? DEFAULT_JOB_PRIORITY
    if (!Number.isInteger(priority) || priority < 0) {
      throw new Error(`job "${job.jobType}/${job.subjectKey}": priority must be a non-negative integer`)
    }

    const jobId = compilerJobId(job.jobType, job.subjectKey, job.inputDigest)
    // The classification probe, for the same reason `persistSourceRecords` has one: `changes` is 1
    // on both branches of an upsert, so existence is read on the key before the write.
    const seenBefore =
      this.db.prepare("SELECT 1 FROM compiler_jobs WHERE job_id = ?").get(jobId) !== undefined

    // A NEW row is PENDING with zero attempts and no lease. `assertJobState` runs on the value
    // written rather than on a literal, so the enum stays closed on the write path — the DDL has no
    // CHECK constraint on `state`, and TypeScript is erased at runtime.
    assertJobState("PENDING", jobId)
    assertLeaseCoherent("PENDING", null, null, jobId)

    this.db
      .prepare(
        `INSERT INTO compiler_jobs (
           job_id, job_type, subject_key, input_digest, state, priority, attempt_count,
           available_at, lease_owner, lease_expires_at, last_error_code, last_error_digest,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'PENDING', ?, 0, ?, NULL, NULL, NULL, NULL, ?, ?)
         ON CONFLICT(job_id) DO UPDATE SET
           priority = excluded.priority,
           available_at = excluded.available_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        jobId,
        job.jobType,
        job.subjectKey,
        job.inputDigest,
        priority,
        job.availableAt,
        job.now,
        job.now,
      )

    return { jobId, inserted: !seenBefore }
  }

  /**
   * Claim one job for `owner` until `leaseExpiresAt`, or return null when none is available.
   *
   * SINGLE OWNERSHIP COMES FROM ONE CONDITIONAL UPDATE, never from a read followed by a write. Two
   * workers that both `SELECT` the highest-priority `PENDING` row see the same row and both claim
   * it; the guard has to be the UPDATE's own `WHERE`, whose evaluation and write are atomic within
   * the statement. `changes === 0` is how a loser learns it lost — that is why the driver port
   * exposes `changes` at all. Control #70 replaces this with select-then-update and observes two
   * owners on one row.
   *
   * The row is picked by a scalar subquery in the same statement rather than by a prior read, so
   * there is no window between choosing and claiming. Ordering is `(priority, available_at, job_id)`:
   * priority first because that is what it means, `available_at` next so the longest-waiting eligible
   * job goes first, and `job_id` last because two rows can tie on both and SQLite would otherwise be
   * free to return either — a queue whose hand-out order is unspecified is not reproducible.
   *
   * ELIGIBILITY IS TWO CONDITIONS, and both are load-bearing. `state = 'PENDING'` (from
   * `LEASABLE_JOB_STATES`, asserted below so the whitelist and the SQL cannot disagree) excludes
   * both a row someone else holds and a terminal row the schema forbids re-running. `available_at
   * <= :now` excludes a row scheduled for later — a state test alone hands out work whose backoff
   * has not elapsed. `now` is INJECTED: no `CURRENT_TIMESTAMP`, no `Date` in this file (INV-R6,
   * §9.5). Control #71 drops the availability test; control #72 uses SQLite's clock.
   *
   * `attempt_count` increments HERE, when the work is handed out, not when it finishes. A worker
   * that dies mid-job never reports anything, so a counter incremented on completion would let a
   * crash-looping job retry forever — which is precisely the "burns a rate limit and reports
   * nothing" failure `DEAD_LETTER` exists to stop. Counting hand-outs makes the exhaustion test
   * `attemptCount >= max` decidable from the row alone.
   */
  private leaseJob(request: CompilerJobLeaseRequest): StoredCompilerJob | null {
    if (request.owner.length === 0) throw new Error("a lease owner must be named; found an empty string")
    if (request.leaseExpiresAt <= request.now) {
      // ISO-8601 UTC stamps compare correctly as strings, which is why the store never parses one.
      // An expiry at or before `now` is a lease that is already expired: the row would be reclaimed
      // by the next sweep while its holder believed it held the claim.
      throw new Error(
        `lease for "${request.owner}" expires at ${request.leaseExpiresAt}, which is not after now (${request.now})`,
      )
    }
    if (request.jobType !== undefined) assertJobType(request.jobType)

    // The whitelist decides which states the SQL admits, rather than the SQL deciding for itself.
    // One member today; the assertion is what makes a widened set a deliberate act.
    const leasable = COMPILER_JOB_STATES.filter((s) => isLeasableJobState(s))
    if (leasable.length !== 1 || leasable[0] !== "PENDING") {
      throw new Error(`LEASABLE_JOB_STATES changed to [${leasable.join(", ")}]; leaseJob's SQL admits only PENDING`)
    }

    const typeFilter = request.jobType === undefined ? "" : " AND job_type = :jobType"
    const params: Record<string, string> = {
      owner: request.owner,
      now: request.now,
      leaseExpiresAt: request.leaseExpiresAt,
    }
    if (request.jobType !== undefined) params.jobType = request.jobType

    const info = this.db
      .prepare(
        `UPDATE compiler_jobs
            SET state = 'LEASED',
                lease_owner = :owner,
                lease_expires_at = :leaseExpiresAt,
                attempt_count = attempt_count + 1,
                updated_at = :now
          WHERE job_id = (
            SELECT job_id FROM compiler_jobs
             WHERE state = 'PENDING' AND available_at <= :now${typeFilter}
             ORDER BY priority, available_at, job_id
             LIMIT 1
          )`,
      )
      .run(params)

    if (info.changes === 0) return null
    const claimed = this.listCompilerJobs().find((j) => j.leaseOwner === request.owner && j.state === "LEASED")
    if (claimed === undefined) {
      throw new Error(`lease for "${request.owner}" reported ${info.changes} row(s) changed but no LEASED row is held`)
    }
    // The read-back is not decoration: it asserts the row the UPDATE produced satisfies the same
    // coherence rule every other write path checks, so a future edit to the SQL cannot half-set a
    // lease without a named failure.
    assertLeaseCoherent(claimed.state, claimed.leaseOwner, claimed.leaseExpiresAt, claimed.jobId)
    return claimed
  }

  /**
   * Extend an existing claim. True when this owner still held the row; false otherwise.
   *
   * THE OWNER IS IN THE `WHERE`, not compared after a read. A renewal that read the row, checked the
   * owner, then wrote would let the expiry sweep reclaim the row between the two — and the write
   * would then hand the lease back to a worker that no longer holds it, producing two holders from
   * a check that looked correct. One conditional UPDATE makes the ownership test and the write the
   * same operation, the same argument as `leaseJob`'s.
   *
   * `state = 'LEASED'` is in the `WHERE` as well, so a renewal cannot revive a row that was
   * completed or reclaimed while the holder was working. That is the `LEASED -> LEASED` edge of
   * `COMPILER_JOB_TRANSITIONS`, enforced by the statement rather than asserted beside it.
   *
   * `attempt_count` is NOT incremented. A renewal is the same attempt continuing; counting it would
   * let a long-running job exhaust its budget by being slow rather than by failing.
   *
   * Returning a BOOLEAN rather than throwing, unlike the other write paths. Losing a lease is not a
   * logic defect — it is the expected outcome of taking longer than the expiry — and the caller's
   * correct response is to stop working, not to crash. `completeJob` still refuses the transition if
   * such a caller writes anyway, so the fail-closed property does not rest on this return value.
   */
  private renewLease(renewal: CompilerJobRenewal): boolean {
    if (renewal.owner.length === 0) throw new Error("a lease owner must be named; found an empty string")
    if (renewal.leaseExpiresAt <= renewal.now) {
      throw new Error(
        `renewal for "${renewal.owner}" expires at ${renewal.leaseExpiresAt}, which is not after now (${renewal.now})`,
      )
    }
    const info = this.db
      .prepare(
        `UPDATE compiler_jobs
            SET lease_expires_at = ?, updated_at = ?
          WHERE job_id = ? AND state = 'LEASED' AND lease_owner = ?`,
      )
      .run(renewal.leaseExpiresAt, renewal.now, renewal.jobId, renewal.owner)
    return info.changes === 1
  }

  /**
   * Record how one job's work ended: released for another attempt, or concluded.
   *
   * The transition is validated INSIDE the transaction against `COMPILER_JOB_TRANSITIONS`, by
   * reading the current state first. That read is what makes `FAILED`/`DEAD_LETTER` terminal as a
   * property of the STORE rather than a claim about a caller's control flow — the R-4 lesson: a
   * guard that lives in one caller is a guard the next caller bypasses. Control #78 widens the table
   * and observes a `DEAD_LETTER` job resurrect.
   *
   * THE LEASE IS ALWAYS CLEARED, on both paths, because every state reachable from `LEASED` is a
   * state in which no one holds the row. `assertLeaseCoherent` then re-checks that against the state
   * being written, so the two cannot disagree.
   *
   * A release to `PENDING` REQUIRES `availableAt`. Retrying immediately is what turns a failing job
   * into a hot loop against someone else's rate limit, and the backoff is the caller's to compute
   * (INV-R6) — so the absence of a schedule is an error here rather than a default of "now", which
   * would be a clock read this file must not perform.
   */
  private completeJob(completion: CompilerJobCompletion): void {
    const current = this.db
      .prepare("SELECT state FROM compiler_jobs WHERE job_id = ?")
      .all(completion.jobId) as { state: string }[]
    const row = current[0]
    if (row === undefined) throw new Error(`job "${completion.jobId}" has no row to complete`)

    // The STORED value is validated, not just the incoming one: a row written by some future path
    // that skipped these assertions would otherwise be read into the transition table as a state
    // the table has no key for, yielding `undefined.includes` instead of a named failure.
    assertJobState(row.state, completion.jobId)
    assertJobState(completion.state, completion.jobId)
    assertJobTransition(row.state as CompilerJobState, completion.state, completion.jobId)
    assertLeaseCoherent(completion.state, null, null, completion.jobId)

    if (completion.state === "PENDING" && completion.availableAt === undefined) {
      throw new Error(
        `job "${completion.jobId}": releasing to PENDING requires an availableAt — the retry schedule is the caller's to compute (INV-R6)`,
      )
    }
    if (completion.lastErrorDigest != null) {
      assertDigestShape(completion.lastErrorDigest, "lastErrorDigest", completion.jobId)
    }

    this.db
      .prepare(
        `UPDATE compiler_jobs
            SET state = ?,
                lease_owner = NULL,
                lease_expires_at = NULL,
                available_at = COALESCE(?, available_at),
                last_error_code = ?,
                last_error_digest = ?,
                updated_at = ?
          WHERE job_id = ?`,
      )
      .run(
        completion.state,
        completion.availableAt ?? null,
        completion.lastErrorCode ?? null,
        completion.lastErrorDigest ?? null,
        completion.now,
        completion.jobId,
      )
  }

  /**
   * Release every lease that expired at or before `now`, returning how many rows were reclaimed.
   *
   * A lease is a claim WITH AN EXPIRY, so a worker that dies leaves a row another worker may
   * reclaim rather than a permanently-held one (the schema's words). This is the sweep that makes
   * that true, and it is one conditional UPDATE for the same reason `leaseJob` is: a read followed
   * by a write lets two sweepers reclaim the same row, and `changes` is how many were actually
   * released.
   *
   * `lease_expires_at <= :now` with an INJECTED `now`. Not `CURRENT_TIMESTAMP`, not `Date.now()` —
   * both would put a clock inside the compile path, and a test asserts this file has no `Date`
   * import by reading these bytes. Control #72 substitutes SQLite's clock and control #73 makes the
   * comparison strict-greater so a lease expiring exactly at `now` is never reclaimed.
   *
   * The row returns to `PENDING` and `available_at` is left ALONE. The reclaimed job was already
   * eligible when it was leased, so its schedule has passed; advancing it would be a delay nobody
   * asked for, and moving it backwards would be a clock read. `attempt_count` is not touched either:
   * `leaseJob` counted the hand-out, so the crashed attempt is already counted, which is what stops
   * a crash-looping job from evading `DEAD_LETTER`.
   */
  private reclaimExpiredLeases(now: string): number {
    const info = this.db
      .prepare(
        `UPDATE compiler_jobs
            SET state = 'PENDING',
                lease_owner = NULL,
                lease_expires_at = NULL,
                updated_at = ?
          WHERE state = 'LEASED' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`,
      )
      .run(now, now)
    return info.changes
  }

  /**
   * Open one `compiler_runs` row and return its `runId`.
   *
   * `output_manifest_digest` is NULL and `completed_at` is NULL while the run is `RUNNING`, which is
   * the honest record: a run that has not finished has produced no output manifest. The schema
   * requires the property to be PRESENT and permits it to be null precisely so this state is
   * representable without "an empty-string or all-zero digest" — its description says so.
   *
   * `metrics` starts at six zeros rather than being omitted, because `metrics_json` is NOT NULL and
   * a crashed run must still read back as a valid document. `assertRunMetrics` runs on the way in
   * even for the zero object, so the closed-set rule has exactly one definition.
   *
   * Named `beginCompilerRun` and not `beginRun`: the latter already exists on this class for a
   * SOURCE's sync checkpoint, and the two are different facts.
   */
  private beginCompilerRun(run: CompilerRunBegin): string {
    assertRunType(run.runType)
    const runId = compilerRunId(run.runType, run.inputManifestDigest, run.startedAt)
    assertDigestShape(run.inputManifestDigest, "inputManifestDigest", runId)
    assertRunState("RUNNING", runId)

    const metrics = emptyRunMetrics()
    assertRunMetrics(metrics, runId)

    this.db
      .prepare(
        `INSERT INTO compiler_runs (
           run_id, run_type, input_manifest_digest, output_manifest_digest,
           state, started_at, completed_at, metrics_json
         ) VALUES (?, ?, ?, NULL, 'RUNNING', ?, NULL, ?)`,
      )
      .run(runId, run.runType, run.inputManifestDigest, run.startedAt, serializeRunMetrics(metrics))

    return runId
  }

  /**
   * Conclude one compiler pass: its terminal state, its output manifest, and its counters.
   *
   * The transition is validated against `COMPILER_RUN_TRANSITIONS` after reading the stored state,
   * so a concluded run cannot be re-graded. That matters more here than for a job: the run record is
   * the reproducibility record — "two runs over the same input manifest must produce the same output
   * manifest" is only checkable if a run's stored output cannot be rewritten after the fact.
   *
   * A `FAILED` run writes `outputManifestDigest: null`. A CRASHED RUN MUST NOT SUBSTITUTE A DIGEST:
   * `sha256:000…0` is a well-formed digest, so `assertDigestShape` cannot refuse it — the refusal has
   * to be that a non-`SUCCEEDED`/`PARTIAL` run has no output at all. Control #87 supplies the
   * all-zero digest on a `FAILED` run and observes the named failure.
   *
   * Conversely a `SUCCEEDED` or `PARTIAL` run MUST carry one. A concluded run with no output
   * manifest is indistinguishable from a crashed one, and `PARTIAL` is a real conclusion — it
   * compiled 24 of 25 subjects and emitted a manifest for the 24.
   */
  private concludeCompilerRun(conclusion: CompilerRunConclusion): void {
    const current = this.db
      .prepare("SELECT state FROM compiler_runs WHERE run_id = ?")
      .all(conclusion.runId) as { state: string }[]
    const row = current[0]
    if (row === undefined) throw new Error(`run "${conclusion.runId}" has no row to conclude`)

    assertRunState(row.state, conclusion.runId)
    assertRunState(conclusion.state, conclusion.runId)
    assertRunTransition(row.state as CompilerRunState, conclusion.state, conclusion.runId)
    assertRunMetrics(conclusion.metrics, conclusion.runId)

    const producedOutput = conclusion.state === "SUCCEEDED" || conclusion.state === "PARTIAL"
    if (producedOutput) {
      if (conclusion.outputManifestDigest === null) {
        throw new Error(
          `run "${conclusion.runId}": a ${conclusion.state} run must carry an outputManifestDigest — without one it is indistinguishable from a crashed run`,
        )
      }
      assertDigestShape(conclusion.outputManifestDigest, "outputManifestDigest", conclusion.runId)
    } else if (conclusion.outputManifestDigest !== null) {
      throw new Error(
        `run "${conclusion.runId}": a ${conclusion.state} run produced no output, so outputManifestDigest must be null, not ${JSON.stringify(conclusion.outputManifestDigest)}`,
      )
    }

    this.db
      .prepare(
        `UPDATE compiler_runs
            SET state = ?, output_manifest_digest = ?, completed_at = ?, metrics_json = ?
          WHERE run_id = ?`,
      )
      .run(
        conclusion.state,
        conclusion.outputManifestDigest,
        conclusion.completedAt,
        serializeRunMetrics(conclusion.metrics),
        conclusion.runId,
      )
  }

  /**
   * Queue rows, ordered by the hand-out order `leaseJob` uses.
   *
   * `(priority, available_at, job_id)` rather than by primary key, so a reader sees the queue as the
   * leaser does. `job_id` is a digest, so ordering by it alone would look arbitrary and hide the
   * scheduling.
   */
  listCompilerJobs(): StoredCompilerJob[] {
    const rows = this.db
      .prepare(
        `SELECT job_id AS jobId, job_type AS jobType, subject_key AS subjectKey,
                input_digest AS inputDigest, state, priority, attempt_count AS attemptCount,
                available_at AS availableAt, lease_owner AS leaseOwner,
                lease_expires_at AS leaseExpiresAt, last_error_code AS lastErrorCode,
                last_error_digest AS lastErrorDigest, created_at AS createdAt, updated_at AS updatedAt
         FROM compiler_jobs ORDER BY priority, available_at, job_id`,
      )
      .all() as StoredCompilerJob[]
    // Every row is validated on the way out, for the reason `parseRunMetrics` is: these are TEXT
    // columns with no CHECK constraint, so a value the union does not contain would otherwise be
    // handed to callers as a `CompilerJobState` the type system believes in.
    for (const r of rows) {
      assertJobState(r.state, r.jobId)
      assertJobType(r.jobType)
    }
    return rows
  }

  /** Run rows, newest start first, with `metrics_json` parsed and validated. */
  listCompilerRuns(): StoredCompilerRun[] {
    const rows = this.db
      .prepare(
        `SELECT run_id AS runId, run_type AS runType, input_manifest_digest AS inputManifestDigest,
                output_manifest_digest AS outputManifestDigest, state, started_at AS startedAt,
                completed_at AS completedAt, metrics_json AS metricsJson
         FROM compiler_runs ORDER BY started_at DESC, run_id`,
      )
      .all() as (Omit<StoredCompilerRun, "metrics"> & { metricsJson: string })[]
    return rows.map((r) => {
      assertRunState(r.state, r.runId)
      assertRunType(r.runType)
      return {
        runId: r.runId,
        runType: r.runType,
        inputManifestDigest: r.inputManifestDigest,
        outputManifestDigest: r.outputManifestDigest,
        state: r.state,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
        metrics: parseRunMetrics(r.metricsJson, r.runId),
      }
    })
  }

  /**
   * Record one compiled evidence row. R-5's write surface, and the table's ONLY writer.
   *
   * IDEMPOTENT BY PRIMARY KEY, not by a pre-read. `evidence_digest` is a function of the inputs
   * alone (`domain/evidenceDigest.ts`), so the same bytes graded under the same policy by the same
   * engine produce the same key — and `INSERT OR IGNORE` therefore makes a second run a no-op
   * rather than a duplicate or an overwrite. Returning whether the row was new is what lets the
   * caller tell a freshly compiled row apart from one already held, without a second query.
   *
   * `OR IGNORE` and not `OR REPLACE`, and the difference is load-bearing: `REPLACE` would delete
   * and re-insert, moving `created_at` forward on every run. That column means "when this
   * observation was first compiled", and a freshness calculator reading a value that advances on
   * every no-op run would report stale evidence as fresh — the same defect
   * `updateArtifactResolution` avoids by only setting `last_verified_at` on `FETCHED`.
   *
   * The artifact row is read first so a foreign key to a non-existent artifact throws here rather
   * than at COMMIT: `evidence_records.artifact_version_id` is `NOT NULL` but the schema declares no
   * FK, so nothing else would catch an id the identity layer never wrote.
   *
   * THE `FETCHED` GATE IS RE-CHECKED HERE, and this is the R-4 lesson applied before it is
   * repeated rather than after. `updateArtifactResolution`'s transition check was a property of the
   * store, so `persistIdentity` — a second writer of the same column — bypassed it and control #25
   * could not see the defect, because #25 measures one writer. The same read is what makes "only
   * verified bytes are observed" a property of this table instead of a claim about
   * `compileEvidence`'s control flow: a future second caller inherits the refusal for free, and a
   * caller that skips `isEvidenceCompilable` cannot write a row anyway. Both sides use the same
   * whitelist (`domain/evidenceInputs.ts`), so they cannot drift apart into disagreement.
   */
  private recordEvidence(write: EvidenceRecordWrite): EvidenceWriteResult {
    const artifact = this.db
      .prepare("SELECT artifact_status AS artifactStatus FROM artifact_versions WHERE artifact_version_id = ?")
      .all(write.artifactVersionId) as { artifactStatus: ArtifactStatus }[]
    const row = artifact[0]
    if (row === undefined) {
      throw new Error(`evidence for artifact "${write.artifactVersionId}" has no artifact row`)
    }
    if (!isEvidenceCompilable(row.artifactStatus)) {
      throw new Error(
        `evidence for artifact "${write.artifactVersionId}" requires status FETCHED, found ${row.artifactStatus}`,
      )
    }

    const info = this.db
      .prepare(
        `INSERT OR IGNORE INTO evidence_records
           (evidence_digest, artifact_version_id, engine_version, policy_digest, verdict,
            evidence_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        write.evidenceDigest,
        write.artifactVersionId,
        write.engineVersion,
        write.policyDigest,
        write.verdict,
        write.evidenceJson,
        write.createdAt,
      )

    return { evidenceDigest: write.evidenceDigest, inserted: info.changes === 1 }
  }

  /** Evidence rows, ordered by their primary key. */
  listEvidenceRecords(): StoredEvidenceRecord[] {
    return this.db
      .prepare(
        `SELECT evidence_digest AS evidenceDigest, artifact_version_id AS artifactVersionId,
                engine_version AS engineVersion, policy_digest AS policyDigest, verdict,
                evidence_json AS evidenceJson, created_at AS createdAt
         FROM evidence_records ORDER BY evidence_digest`,
      )
      .all() as StoredEvidenceRecord[]
  }

  /**
   * Record one artifact's resolution outcome: R-4's four columns and the status.
   *
   * Reachable only through `transaction`, like every other write. The transaction here is per
   * ARTIFACT rather than per cohort, because artifact resolution is a network loop: one slow or
   * failing artifact must not roll back the outcomes already established for the others.
   *
   * The status transition is validated INSIDE the transaction, against
   * `domain/artifactTransitions.ts`, by reading the current row first. That read is the reason
   * `REJECTED` can be terminal at all — without it, "refuse to move away from REJECTED" would be
   * a claim about the caller's control flow rather than a property of the store, and a second
   * caller (or a re-run) could quietly heal a digest mismatch. Control #25 widens the table and
   * observes exactly that.
   *
   * `last_verified_at` uses `COALESCE(?, last_verified_at)` so a null from a failed attempt
   * PRESERVES the previous verification time instead of erasing it. The other three columns are
   * overwritten unconditionally: they describe the bytes we currently hold, and on a rejection we
   * hold none, so nulling them is the accurate record.
   */
  private updateArtifactResolution(write: ArtifactResolutionWrite): void {
    const current = this.db
      .prepare("SELECT artifact_status AS artifactStatus FROM artifact_versions WHERE artifact_version_id = ?")
      .all(write.artifactVersionId) as { artifactStatus: ArtifactStatus }[]
    const row = current[0]
    if (row === undefined) {
      // Throwing rather than inserting: an artifact row is R-3's to create, and an id that does
      // not exist means the resolver was handed something the identity layer never wrote.
      throw new Error(`artifact "${write.artifactVersionId}" has no row to update`)
    }
    assertArtifactTransition(row.artifactStatus, write.artifactStatus, write.artifactVersionId)

    this.db
      .prepare(
        `UPDATE artifact_versions
            SET artifact_status = ?,
                immutable_digest = ?,
                registry_integrity = ?,
                cache_key = ?,
                last_verified_at = COALESCE(?, last_verified_at)
          WHERE artifact_version_id = ?`,
      )
      .run(
        write.artifactStatus,
        write.immutableDigest,
        write.registryIntegrity,
        write.cacheKey,
        write.lastVerifiedAt,
        write.artifactVersionId,
      )
  }

  /**
   * Persist one resolved identity cohort: subjects, their aliases, their artifacts, and any
   * conflict that refused a merge.
   *
   * Reachable only through `transaction`, like every other write, and for a sharper reason
   * here than for source records: a conflict row and the `CONFLICT` status on the subjects it
   * names are ONE fact recorded in two tables. Committing the subjects without the conflict
   * would publish an unresolved identity as merely provisional; committing the conflict
   * without the subjects would leave a row pointing at nothing.
   *
   * All four writes are upserts on the canonical primary keys, so replaying the same cohort
   * is idempotent — every id is `hashJson`-derived, so the same input yields the same keys.
   *
   * That idempotence is exactly why the artifact upsert may NOT assign `artifact_status`
   * unconditionally. `artifactVersionId` hashes `{subjectId, packageType, packageIdentifier,
   * version}`, and `resolveIdentity` derives the status from `packageType` alone — so on
   * conflict `excluded.artifact_status` is always the same value this row was created with.
   * Assigning it is therefore a no-op for a row R-3 still owns, and a CLOBBER for one R-4 has
   * since moved to `FETCHED`/`UNAVAILABLE`/`REJECTED`: every replay would reset the row to
   * `RESOLVED` without ever consulting `assertArtifactTransition`, un-rejecting a digest
   * mismatch and making a cache hit unobservable. The `CASE` narrows the write to the two
   * statuses the identity layer owns, which keeps `updateArtifactResolution`'s guard the only
   * path out of them. Control #32 removes the `CASE` and observes a `REJECTED` artifact heal.
   */
  private persistIdentity(identity: ResolvedIdentityWrite): PersistIdentityResult {
    const subject = this.db.prepare(
      `INSERT INTO canonical_subjects (
         subject_id, canonical_name, canonical_slug, display_name,
         identity_status, identity_digest, first_seen_at, last_seen_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(subject_id) DO UPDATE SET
         canonical_slug = excluded.canonical_slug,
         display_name = excluded.display_name,
         identity_status = excluded.identity_status,
         identity_digest = excluded.identity_digest,
         last_seen_at = excluded.last_seen_at`,
    )
    for (const s of identity.subjects) {
      subject.run(
        s.subjectId,
        s.canonicalName,
        // NOT `s.canonicalSlug` — see `subjectSlugRow`. A `CONFLICT` subject stores NULL, so
        // two subjects that flattened to one slug can BOTH be recorded (SQLite treats NULLs as
        // distinct under UNIQUE) instead of the second one rolling back the whole cohort.
        subjectSlugRow(s),
        s.displayName,
        s.identityStatus,
        subjectIdentityDigest(s),
        s.firstSeenAt,
        s.lastSeenAt,
      )
    }

    const alias = this.db.prepare(
      `INSERT INTO subject_aliases (alias, subject_id, source_record_id, alias_type)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(alias, subject_id) DO UPDATE SET
         source_record_id = excluded.source_record_id,
         alias_type = excluded.alias_type`,
    )
    for (const a of identity.aliases) alias.run(a.alias, a.subjectId, a.sourceRecordId, a.aliasType)

    const artifact = this.db.prepare(
      `INSERT INTO artifact_versions (
         artifact_version_id, subject_id, package_type, package_identifier, version,
         source_locator, immutable_digest, registry_integrity, artifact_status,
         cache_key, first_seen_at, last_verified_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(artifact_version_id) DO UPDATE SET
         source_locator = excluded.source_locator,
         artifact_status = CASE
           WHEN artifact_versions.artifact_status IN ('RESOLVED', 'UNSUPPORTED')
             THEN excluded.artifact_status
           ELSE artifact_versions.artifact_status
         END`,
    )
    for (const a of identity.artifacts) {
      artifact.run(
        a.artifactVersionId,
        a.subjectId,
        a.packageType,
        a.packageIdentifier,
        a.version,
        a.sourceLocator,
        // R-3 writes these three as NULL and R-4 fills them. `registryIntegrity` is absent
        // from the document rather than null (its schema forbids null), so `?? null` is the
        // translation from an omitted property to an empty column — not a fabricated value.
        a.immutableDigest,
        a.registryIntegrity ?? null,
        a.artifactStatus,
        null,
        // `first_seen_at` is NOT NULL in the DDL and absent from the artifact SCHEMA, so it
        // is taken from the subject this artifact belongs to. The resolver only ever emits an
        // artifact alongside its subject, so the lookup cannot miss; the throw makes that an
        // assertion instead of a silent `""`.
        subjectFirstSeen(identity, a.subjectId),
        null,
      )
    }

    const conflict = this.db.prepare(
      `INSERT INTO identity_conflicts (
         conflict_id, subject_key, conflict_type, source_record_ids_json,
         status, created_at, resolved_at, resolution_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(conflict_id) DO UPDATE SET
         status = excluded.status,
         resolved_at = excluded.resolved_at,
         resolution_json = excluded.resolution_json`,
    )
    for (const c of identity.conflicts) {
      conflict.run(
        c.conflictId,
        c.subjectKey,
        c.conflictType,
        JSON.stringify(c.sourceRecordIds),
        c.status,
        c.createdAt,
        c.resolvedAt ?? null,
        c.resolution == null ? null : JSON.stringify(c.resolution),
      )
    }

    return {
      subjects: identity.subjects.length,
      aliases: identity.aliases.length,
      artifacts: identity.artifacts.length,
      conflicts: identity.conflicts.length,
    }
  }

  /** Subjects for a cohort, ordered by canonical name for a stable read. */
  listSubjects(): StoredSubject[] {
    return this.db
      .prepare(
        `SELECT subject_id AS subjectId, canonical_name AS canonicalName, canonical_slug AS canonicalSlug,
                display_name AS displayName, identity_status AS identityStatus,
                identity_digest AS identityDigest, first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt
         FROM canonical_subjects ORDER BY canonical_name`,
      )
      .all() as StoredSubject[]
  }

  /**
   * Every recorded conflict, newest key first by id for stability.
   *
   * `sourceRecordIds` is parsed back from JSON here rather than at the call site, because a
   * conflict whose participants stayed a string would be trivially mis-read as one
   * participant — `minItems: 2` is the invariant, and a caller counting characters would not
   * see it.
   */
  listIdentityConflicts(): StoredIdentityConflict[] {
    const rows = this.db
      .prepare(
        `SELECT conflict_id AS conflictId, subject_key AS subjectKey, conflict_type AS conflictType,
                source_record_ids_json AS sourceRecordIdsJson, status, created_at AS createdAt,
                resolved_at AS resolvedAt, resolution_json AS resolutionJson
         FROM identity_conflicts ORDER BY conflict_id`,
      )
      .all() as (Omit<StoredIdentityConflict, "sourceRecordIds" | "resolution"> & {
      sourceRecordIdsJson: string
      resolutionJson: string | null
    })[]
    return rows.map((r) => ({
      conflictId: r.conflictId,
      subjectKey: r.subjectKey,
      conflictType: r.conflictType,
      sourceRecordIds: JSON.parse(r.sourceRecordIdsJson) as string[],
      status: r.status,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
      resolution: r.resolutionJson == null ? null : (JSON.parse(r.resolutionJson) as ConflictResolution),
    }))
  }

  /**
   * Alias rows for a subject, or all of them. Ordered by `(alias, subject_id)` — the primary
   * key, so the read order is the storage order.
   */
  listSubjectAliases(subjectId?: string): StoredSubjectAlias[] {
    const where = subjectId === undefined ? "" : " WHERE subject_id = ?"
    const stmt = this.db.prepare(
      `SELECT alias, subject_id AS subjectId, source_record_id AS sourceRecordId, alias_type AS aliasType
       FROM subject_aliases${where} ORDER BY alias, subject_id`,
    )
    return (subjectId === undefined ? stmt.all() : stmt.all(subjectId)) as StoredSubjectAlias[]
  }

  /**
   * How many alias ROWS exist. Distinct from `PersistIdentityResult.aliases`, which counts
   * DOCUMENT entries, and the gap between them is the whole reason this method exists:
   * `subject_aliases`' PRIMARY KEY is `(alias, subject_id)`, so a document carrying one pair
   * twice is folded to one row SILENTLY. Without a row count, that over-report is invisible —
   * a persist→read-back comparison would fail on a difference that is not a difference, or
   * worse, pass while the store held less than the caller was told it wrote.
   */
  countSubjectAliases(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM subject_aliases").all() as { n: number }[]
    return row[0]!.n
  }

  /** Artifact identity rows. R-4's columns are read here too, and are null until it runs. */
  listArtifactVersions(): StoredArtifactVersion[] {
    return this.db
      .prepare(
        `SELECT artifact_version_id AS artifactVersionId, subject_id AS subjectId,
                package_type AS packageType, package_identifier AS packageIdentifier, version,
                source_locator AS sourceLocator, immutable_digest AS immutableDigest,
                registry_integrity AS registryIntegrity, artifact_status AS artifactStatus,
                cache_key AS cacheKey, first_seen_at AS firstSeenAt, last_verified_at AS lastVerifiedAt
         FROM artifact_versions ORDER BY artifact_version_id`,
      )
      .all() as StoredArtifactVersion[]
  }

  /**
   * Persist a batch of source records.
   *
   * The UNIQUE key is `(source_id, source_native_id, payload_digest)` — the canonical
   * schema's own idempotency key. An identical observation seen again is NOT a new row:
   * it refreshes `last_seen_at` and nothing else, so `first_seen_at` keeps meaning
   * "when we first saw these exact bytes". That is what makes R-2's digest change
   * detector possible: a changed payload produces a NEW row with a new digest, and the
   * old row stays as history rather than being overwritten.
   *
   * `source_record_id` is derived from the triple, not from a counter or a uuid, so the
   * same observation replayed on a fresh store yields the same id. A random id would
   * make the mirror non-reproducible and every downstream digest unstable.
   */
  private persistSourceRecords(records: SourceRecordV1[], seenAt: string): PersistResult {
    const insert = this.db.prepare(
      `INSERT INTO source_records (
         source_record_id, source_id, source_type, source_native_id, payload_digest,
         payload_json, lifecycle_status, retrieved_at, first_seen_at, last_seen_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_id, source_native_id, payload_digest) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    )
    // The classification probe. `changes` cannot distinguish the two branches of an
    // upsert (it is 1 either way), so existence is read on the UNIQUE triple before the
    // write. Indexed lookup, not a table scan.
    const exists = this.db.prepare(
      "SELECT 1 FROM source_records WHERE source_id = ? AND source_native_id = ? AND payload_digest = ?",
    )

    let inserted = 0
    let unchanged = 0
    for (const record of records) {
      const nativeId = record.source.sourceRecordId
      const seenBefore =
        exists.get(record.source.sourceId, nativeId, record.source.payloadDigest) !== undefined
      insert.run(
        sourceRecordRowId(record),
        record.source.sourceId,
        record.source.sourceType,
        nativeId,
        record.source.payloadDigest,
        JSON.stringify(record),
        record.lifecycle.status,
        record.source.retrievedAt,
        seenAt,
        seenAt,
      )
      if (seenBefore) unchanged += 1
      else inserted += 1
    }
    return { inserted, unchanged }
  }

  /** All stored records for a source, ordered by native id for a stable projection. */
  listSourceRecords(sourceId: string): StoredSourceRecord[] {
    return this.db
      .prepare(
        `SELECT source_record_id AS sourceRecordId, source_id AS sourceId, source_type AS sourceType,
                source_native_id AS sourceNativeId, payload_digest AS payloadDigest,
                payload_json AS payloadJson, lifecycle_status AS lifecycleStatus,
                retrieved_at AS retrievedAt, first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt
         FROM source_records WHERE source_id = ? ORDER BY source_native_id, payload_digest`,
      )
      .all(sourceId) as StoredSourceRecord[]
  }

  /** Parse stored payloads back into domain records, in stable order. */
  listSourceRecordPayloads(sourceId: string): SourceRecordV1[] {
    return this.listSourceRecords(sourceId).map((r) => JSON.parse(r.payloadJson) as SourceRecordV1)
  }

  /**
   * The CURRENT observation of each subject: one row per `source_native_id`.
   *
   * `listSourceRecords` deliberately returns history — a changed payload adds a row and
   * keeps the old one, which is what makes R-2's change detector possible. That makes it
   * the wrong read for a PROJECTION: after any upstream version bump the same server
   * appears twice, and a projection over it would emit the server twice. The defect is
   * invisible to a fixture where every record is a first observation, so the fix is a
   * distinct read rather than a filter at the call site.
   *
   * The discriminator has to come from the ROW, because the payload cannot supply one:
   * two observations of one subject are two different payloads with no ordering between
   * them, and the primary key is a digest of the triple, not a counter — there is no
   * ordinal column to sort on.
   *
   * `last_seen_at DESC` is the right discriminator, and `first_seen_at` is not. Consider
   * an upstream revert: bytes A are seen at T1, bytes B at T2, then A again at T3. A's
   * `last_seen_at` moves to T3 while B's stays T2, so `last_seen_at` picks A — which is
   * what the source actually serves now. `first_seen_at` would keep B forever, reporting
   * a payload upstream has withdrawn. "Most recently observed" IS "current".
   *
   * The `payload_digest` tiebreak is arbitrary in direction but not optional. Two rows
   * can share a `last_seen_at` only when one run yielded the same native id twice with
   * different bytes; without a fixed second key SQLite could return either, and a
   * projection that depends on the choice would stop being reproducible.
   */
  listLatestSourceRecords(sourceId: string): StoredSourceRecord[] {
    return this.db
      .prepare(
        `SELECT sourceRecordId, sourceId, sourceType, sourceNativeId, payloadDigest, payloadJson,
                lifecycleStatus, retrievedAt, firstSeenAt, lastSeenAt
         FROM (
           SELECT source_record_id AS sourceRecordId, source_id AS sourceId, source_type AS sourceType,
                  source_native_id AS sourceNativeId, payload_digest AS payloadDigest,
                  payload_json AS payloadJson, lifecycle_status AS lifecycleStatus,
                  retrieved_at AS retrievedAt, first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt,
                  ROW_NUMBER() OVER (
                    PARTITION BY source_native_id
                    ORDER BY last_seen_at DESC, payload_digest DESC
                  ) AS rn
           FROM source_records
           WHERE source_id = ?
         )
         WHERE rn = 1
         ORDER BY sourceNativeId`,
      )
      .all(sourceId) as StoredSourceRecord[]
  }

  /** Parse the current observation of each subject back into domain records. */
  listLatestSourceRecordPayloads(sourceId: string): SourceRecordV1[] {
    return this.listLatestSourceRecords(sourceId).map((r) => JSON.parse(r.payloadJson) as SourceRecordV1)
  }

  readCheckpoint(sourceId: string): SourceCheckpoint {
    const row = this.db
      .prepare(
        `SELECT source_id AS sourceId, cursor, updated_since AS updatedSince, snapshot_digest AS snapshotDigest,
                last_started_at AS lastStartedAt, last_completed_at AS lastCompletedAt,
                status, last_error_code AS lastErrorCode
         FROM source_checkpoints WHERE source_id = ?`,
      )
      .get(sourceId) as SourceCheckpoint | undefined
    return row ?? emptyCheckpoint(sourceId)
  }

  private writeCheckpoint(next: SourceCheckpoint): void {
    this.db
      .prepare(
        `INSERT INTO source_checkpoints (
           source_id, cursor, updated_since, snapshot_digest,
           last_started_at, last_completed_at, status, last_error_code
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_id) DO UPDATE SET
           cursor = excluded.cursor,
           updated_since = excluded.updated_since,
           snapshot_digest = excluded.snapshot_digest,
           last_started_at = excluded.last_started_at,
           last_completed_at = excluded.last_completed_at,
           status = excluded.status,
           last_error_code = excluded.last_error_code`,
      )
      .run(
        next.sourceId,
        next.cursor,
        next.updatedSince,
        next.snapshotDigest,
        next.lastStartedAt,
        next.lastCompletedAt,
        next.status,
        next.lastErrorCode,
      )
  }

  /**
   * Mark a run as started. Written OUTSIDE the record transaction and before any fetch,
   * so a crash mid-run leaves `RUNNING` on disk — which `assertUsableCheckpoint` then
   * refuses to resume from. A crashed run that looked `IDLE` would resume from a cursor
   * whose records may never have been persisted, which is exactly the silent gap §9.4
   * forbids.
   */
  beginRun(sourceId: string, startedAt: string): SourceCheckpoint {
    const current = this.readCheckpoint(sourceId)
    assertUsableCheckpoint(current)
    const next: SourceCheckpoint = { ...current, status: "RUNNING", lastStartedAt: startedAt, lastErrorCode: null }
    this.writeCheckpoint(next)
    return current
  }

  /** Record a failed run. Terminal for the run; the next run retries from `cursor`. */
  failRun(sourceId: string, errorCode: string): void {
    const current = this.readCheckpoint(sourceId)
    this.writeCheckpoint({ ...current, status: "FAILED", lastErrorCode: errorCode })
  }

  /** True when every source that has a checkpoint reached a terminal run state (INV-R5). */
  allRunsTerminal(): boolean {
    const rows = this.db.prepare("SELECT status FROM source_checkpoints").all() as { status: CheckpointStatus }[]
    return rows.every((r) => isTerminalCheckpointStatus(r.status))
  }

  close(): void {
    this.db.close()
  }
}

/**
 * The stable row id for one observation: a digest over the canonical UNIQUE triple.
 *
 * Derived rather than random so replaying the same source bytes on a fresh store
 * reproduces the same ids — the mirror is a projection of its inputs, and a projection
 * with random keys cannot be byte-compared.
 */
export function sourceRecordRowId(record: SourceRecordV1): string {
  return hashJson({
    sourceId: record.source.sourceId,
    sourceNativeId: record.source.sourceRecordId,
    payloadDigest: record.source.payloadDigest,
  })
}

/**
 * `canonical_subjects.canonical_slug` — the ONE place the document's always-present slug
 * becomes a nullable row, and the only translation between the two shapes.
 *
 * A function rather than an inline ternary at the writer because this is the whole of
 * migration 002's semantics, and it needs to be nameable by a test. `store.ts` is where every
 * other document/storage divergence is resolved (`subjectIdentityDigest` is a column with no
 * property; this is a property with a nullable column), so it belongs here.
 *
 * THE RULE: an ADDRESS IS A PROPERTY OF A CONCLUDED IDENTITY. `CONFLICT` is terminal and
 * carries zero artifacts, so nothing may ever be served at that subject's slug — and a row
 * holding an address nothing can serve is a claim the identity layer explicitly refused to
 * make. `NULL` is how the column says "no address was concluded", which is precisely what
 * `identity_status = 'CONFLICT'` already means.
 *
 * KEYED ON `CONFLICT`, NOT ON "did this slug actually collide", and deliberately so:
 *
 *   - It is a function of the DOCUMENT alone, so no collision set has to be threaded from
 *     `resolveIdentity` into the write and the two can never disagree about who lost a slug.
 *   - It is uniform across conflict CLASSES. A `canonical-name-collision` (two records, one
 *     name) yields one subject and therefore one uncontested slug, so nulling it is not
 *     strictly required — but the subject is still terminal with zero artifacts, so the
 *     address is still unserveable, and a per-class exception would be a second rule to keep
 *     in sync with a `ConflictType` union that later batches extend.
 *   - It fails CLOSED under extension. A future conflict class that happens to produce
 *     colliding slugs is handled by this rule as written; a narrower one would crash the
 *     cohort exactly the way this migration exists to stop.
 *
 * WHY `UNIQUE` STILL DOES REAL WORK AFTER THIS. Two `PROVISIONAL` subjects cannot share a
 * slug: `resolveIdentity` computes slug ownership across ALL claimed names before building any
 * subject, and marks EVERY participant of a shared slug `CONFLICT`. So each surviving non-NULL
 * slug is held by exactly one subject, and `UNIQUE` refuses a second — which is the invariant
 * that was worth enforcing. Only the `NOT NULL` half, the half that crashed the fail-closed
 * path, is gone.
 *
 * `subject_aliases` is NOT affected and must not be: its PK is `(alias, subject_id)`, so both
 * contesting subjects legitimately record the shared slug string as an alias. An alias RECORDS
 * a claim (many-to-many, evidence); `canonical_slug` ASSIGNS an address (one-to-one, a
 * conclusion). Conflating them is what made a collision look unstorable.
 */
export function subjectSlugRow(subject: CanonicalSubjectV1): string | null {
  return subject.identityStatus === "CONFLICT" ? null : subject.canonicalSlug
}

/**
 * `canonical_subjects.identity_digest` — a STORAGE-derived column.
 *
 * It is `NOT NULL` in the canonical DDL and absent from `calllint.canonical-subject.v1`'s
 * properties (which are `additionalProperties: false`), so it cannot live on the document and
 * has to be computed where the row is written. Same arrangement as `sourceRecordRowId`.
 *
 * The timestamps are DELIBERATELY EXCLUDED. `firstSeenAt`/`lastSeenAt` move on every run
 * that observes the subject again, so including them would make the digest change when
 * nothing about the identity did — which is the exact defect R-2 measured in its own change
 * key (`last_seen_at` and `fetchedAt` move every run and never skip). What this digest
 * answers is "did the CONCLUSION change", so it covers the conclusion and its evidence.
 *
 * It covers the DOCUMENT's `canonicalSlug`, never `subjectSlugRow`'s nullable projection, and
 * that asymmetry is deliberate: the derived slug is part of what identity CONCLUDED about a
 * subject even when the conclusion was a refusal. Digesting the row instead would collapse
 * every `CONFLICT` subject's slug to one absent value, so a collision moving from one pair of
 * names to another would leave the digest — the "did the conclusion change" key — unmoved.
 */
export function subjectIdentityDigest(subject: CanonicalSubjectV1): string {
  return hashJson({
    canonicalName: subject.canonicalName,
    canonicalSlug: subject.canonicalSlug,
    displayName: subject.displayName,
    identityStatus: subject.identityStatus,
    aliases: subject.aliases,
    sourceRecordIds: subject.sourceRecordIds,
    identityBasis: subject.identityBasis,
  })
}

/**
 * The `first_seen_at` for an artifact, taken from the subject that owns it. Throws rather
 * than defaulting: an artifact without its subject in the same write is a resolver defect,
 * and a `NOT NULL` column filled with a placeholder would hide it.
 */
function subjectFirstSeen(identity: ResolvedIdentityWrite, subjectId: string): string {
  const owner = identity.subjects.find((s) => s.subjectId === subjectId)
  if (owner === undefined) {
    throw new Error(`artifact names subject "${subjectId}", which is not in the same identity write`)
  }
  return owner.firstSeenAt
}

/**
 * A row of `adoption_records`, as stored.
 *
 * `recordJson` is left as a string rather than parsed here so a caller that only needs the indexed
 * columns (a freshness sweep, a digest comparison) does not pay to parse every payload. Use
 * `readAdoptionRecord` for the parsed form.
 */
export interface StoredAdoptionRecord {
  subjectId: string
  selectedArtifactVersionId: string | null
  adoptionRecordDigest: string
  decisionDigest: string
  semanticContractDigest: string | null
  presentationDigest: string | null
  lifecycleStatus: AdoptionLifecycleStatus
  recordJson: string
  updatedAt: string
}

/** A row of `canonical_subjects`, as stored — including the derived digest column. */
export interface StoredSubject {
  subjectId: string
  canonicalName: string
  /**
   * `null` for a `CONFLICT` subject — see `subjectSlugRow`. Typed nullable rather than
   * `string` so a reader that addresses a subject by slug has to handle the refusal at compile
   * time; `canonicalName` is the authoritative key and is never null.
   */
  canonicalSlug: string | null
  displayName: string
  identityStatus: IdentityStatus
  identityDigest: string
  firstSeenAt: string
  lastSeenAt: string
}

/** A row of `subject_aliases`. `sourceRecordId` is null for an alias no record supplied. */
export interface StoredSubjectAlias {
  alias: string
  subjectId: string
  sourceRecordId: string | null
  aliasType: IdentityBasisKind
}

/** A row of `identity_conflicts`, with its two JSON columns already parsed. */
export interface StoredIdentityConflict {
  conflictId: string
  subjectKey: string
  conflictType: ConflictType
  sourceRecordIds: string[]
  status: ConflictStatus
  createdAt: string
  resolvedAt: string | null
  resolution: ConflictResolution | null
}

/**
 * `compiler_jobs.priority`'s default, transcribed from `migrations/001:117` (`DEFAULT 100`).
 *
 * Named here rather than left to SQLite's own default, because this writer always supplies the
 * column explicitly — an upsert that omitted it would reset priority to the DDL default on every
 * re-enqueue, which is the opposite of what a re-enqueue is for.
 */
export const DEFAULT_JOB_PRIORITY = 100

/**
 * Throw unless `state` is one of the five declared job states.
 *
 * ON THE WRITE PATH, not only in the type checker, and the reason is measured: `migrations/001`
 * declares `state TEXT NOT NULL` with NO `CHECK` constraint, so SQLite accepts `"SUCCEEEDED"`
 * without complaint, and TypeScript's union is erased before any row is written. The enum's closure
 * exists in two places that cannot enforce it at runtime (a JSON schema nothing validates rows
 * against, and a type) — so it is asserted here, where rows are actually written. Control #80 writes
 * a misspelling and control #81 removes this function's call sites.
 */
function assertJobState(state: string, jobId: string): asserts state is CompilerJobState {
  if (!COMPILER_JOB_STATES.includes(state as CompilerJobState)) {
    throw new Error(
      `job "${jobId}": state must be one of [${COMPILER_JOB_STATES.join(", ")}], found ${JSON.stringify(state)}`,
    )
  }
}

/** Throw unless `jobType` is one of the seven declared stages. Same argument as `assertJobState`. */
function assertJobType(jobType: string): asserts jobType is CompilerJobType {
  if (!COMPILER_JOB_TYPES.includes(jobType as CompilerJobType)) {
    throw new Error(
      `jobType must be one of [${COMPILER_JOB_TYPES.join(", ")}], found ${JSON.stringify(jobType)}`,
    )
  }
}

/** Throw unless `state` is one of the four declared run states. */
function assertRunState(state: string, runId: string): asserts state is CompilerRunState {
  if (!COMPILER_RUN_STATES.includes(state as CompilerRunState)) {
    throw new Error(
      `run "${runId}": state must be one of [${COMPILER_RUN_STATES.join(", ")}], found ${JSON.stringify(state)}`,
    )
  }
}

/** Throw unless `runType` is one of the four declared run kinds. */
function assertRunType(runType: string): asserts runType is CompilerRunType {
  if (!COMPILER_RUN_TYPES.includes(runType as CompilerRunType)) {
    throw new Error(
      `runType must be one of [${COMPILER_RUN_TYPES.join(", ")}], found ${JSON.stringify(runType)}`,
    )
  }
}

/**
 * A row of `compiler_jobs`, as stored.
 *
 * Column-for-property with `calllint.compiler-job.v1` minus its `schema` property, which is a
 * document-only field — there is no `schema` column. `state` and `jobType` are the narrow unions
 * rather than `string`, which is only sound because `listCompilerJobs` validates every row it
 * returns; the DDL itself would permit any text.
 */
export interface StoredCompilerJob {
  jobId: string
  jobType: CompilerJobType
  subjectKey: string
  inputDigest: string
  state: CompilerJobState
  priority: number
  attemptCount: number
  availableAt: string
  leaseOwner: string | null
  leaseExpiresAt: string | null
  lastErrorCode: string | null
  lastErrorDigest: string | null
  createdAt: string
  updatedAt: string
}

/** A row of `compiler_runs`, with `metrics_json` parsed back into the closed counter object. */
export interface StoredCompilerRun {
  runId: string
  runType: CompilerRunType
  inputManifestDigest: string
  outputManifestDigest: string | null
  state: CompilerRunState
  startedAt: string
  completedAt: string | null
  metrics: CompilerRunMetrics
}

/** A row of `artifact_versions`. The four R-4 columns are read and are null until it runs. */
export interface StoredArtifactVersion {
  artifactVersionId: string
  subjectId: string
  packageType: string
  packageIdentifier: string
  version: string | null
  sourceLocator: string
  immutableDigest: string | null
  registryIntegrity: string | null
  artifactStatus: ArtifactStatus
  cacheKey: string | null
  firstSeenAt: string
  lastVerifiedAt: string | null
}
