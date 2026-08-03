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
import type { SourceRecordV1 } from "../domain/sourceRecord.js"

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

/** The write surface available inside a transaction. */
export interface AdoptionIndexTx {
  persistSourceRecords(records: SourceRecordV1[], seenAt: string): PersistResult
  advanceCheckpoint(next: SourceCheckpoint): void
  readCheckpoint(sourceId: string): SourceCheckpoint
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
    }
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
