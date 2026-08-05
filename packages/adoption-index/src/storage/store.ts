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
import { isEvidenceCompilable } from "../domain/evidenceInputs.js"
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

/** The write surface available inside a transaction. */
export interface AdoptionIndexTx {
  persistSourceRecords(records: SourceRecordV1[], seenAt: string): PersistResult
  advanceCheckpoint(next: SourceCheckpoint): void
  readCheckpoint(sourceId: string): SourceCheckpoint
  persistIdentity(identity: ResolvedIdentityWrite): PersistIdentityResult
  updateArtifactResolution(write: ArtifactResolutionWrite): void
  recordEvidence(write: EvidenceRecordWrite): EvidenceWriteResult
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
    }
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
