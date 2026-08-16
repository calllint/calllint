/**
 * Daily backup of the adoption-index store — the other half of the ADR 0061 §8.4 pair.
 *
 * §8.4 asked for retention and backup TOGETHER; §8.5 shipped retention alone and said so. This
 * module is the backup, and §8.6 records the three decisions it needed (destination, window,
 * credential) that §8.5 had no measured basis for.
 *
 * WHAT IS BACKED UP, AND WHY IT IS ONLY THE DATABASE. The store is the only thing under `.var/`
 * holding facts that cannot be rebuilt: `first_seen_at` on three tables is the timestamp of an
 * observation nobody can observe twice. CAS blobs are content-addressed downloads — losing one
 * costs a re-fetch, not a fact — so they are DELIBERATELY out of scope rather than overlooked.
 * Backing them up would also mean shipping the growth surface `prune:cas` exists to bound off the
 * host and into object storage, where the retention window is someone else's console setting.
 *
 * `VACUUM INTO`, NOT A FILE COPY. The store runs in WAL mode (`driver.ts:56`), so `db/…sqlite` on
 * disk is not a complete database on its own: committed transactions live in `-wal` until a
 * checkpoint. Copying the three files while a writer runs yields a torn archive that only reveals
 * itself when someone restores it. `VACUUM INTO` asks SQLite for a consistent snapshot through the
 * existing `SqliteDatabase` port, which is also why this needed no widening of `driver.ts`.
 *
 * WHERE THE ARCHIVE LANDS, and why it is a SIBLING of the index root rather than a ninth
 * subdirectory of it. `INDEX_SUBDIRS` is pinned at exactly 8 entries by control #12
 * (`store-schema.test.ts:410`), and that pin is right: it enumerates the STORE's persistence, and
 * an operational archive is not store persistence — nothing in `adoption-index` reads or writes it.
 * So the archive lives at `.var/calllint-adoption-backup/`, which keeps INV-R7's audited set
 * untouched while staying inside `/opt/calllint/.var` — the one `ReadWritePaths` entry that makes a
 * write here legal under `ProtectSystem=strict`. An archive staged anywhere else fails on the host,
 * where no CI of ours is watching.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import type { SqliteDatabase } from "@calllint/adoption-index"

/**
 * The staging root, relative to the same working directory `resolveIndexPaths` takes.
 *
 * It deliberately does NOT reuse `INDEX_ROOT_DIRNAME`: see the module docblock on why the archive
 * is a sibling of the store rather than a subdirectory of it.
 */
export const BACKUP_STAGING_DIRNAME = ".var/calllint-adoption-backup"

/** The one owner of the staging layout, for the same reason `paths.ts` owns the store's. */
export function backupStagingRoot(cwd: string): string {
  return resolve(cwd, BACKUP_STAGING_DIRNAME)
}

/** The suffix the sweep recognises. Anything else in the staging dir is left alone. */
export const ARCHIVE_SUFFIX = ".sqlite"

export interface PruneBackupStagingResult {
  inspected: number
  deleted: number
  failed: number
  /** Entries that are not `*.sqlite` files, left untouched and reported. */
  skipped: number
}

/**
 * The archive's file name for a given instant — DATE-stamped, not timestamped.
 *
 * One object per day is what makes an object-storage lifecycle rule legible: "delete after N days"
 * is a sentence about this name. A full timestamp would let a manual re-run leave two archives for
 * the same day, both uploaded and both aged out independently, so "how many days of history do we
 * hold" would stop being answerable from the key alone.
 *
 * `now` is validated rather than trusted. `new Date("nonsense").toISOString()` throws, but
 * `String(new Date("nonsense"))` does not — and a caller that built the name from a bad clock read
 * would otherwise produce `adoption-index-Invalid.sqlite` and upload it happily.
 */
export function archiveFileName(now: string): string {
  const parsed = new Date(now)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`backup: expected an ISO-8601 instant, received ${JSON.stringify(now)}`)
  }
  const day = parsed.toISOString().slice(0, "YYYY-MM-DD".length)
  return `adoption-index-${day}${ARCHIVE_SUFFIX}`
}

/** The absolute path this run's archive is written to. */
export function archivePath(cwd: string, now: string): string {
  return join(backupStagingRoot(cwd), archiveFileName(now))
}

export interface RefuseToArchiveInput {
  /** Absolute path of the store's database file, from `resolveIndexPaths`. */
  dbPath: string
  /**
   * Whether that file exists. Passed IN rather than read here, for two reasons: the predicate
   * stays pure and therefore reachable from a test (control #112 — a refusal written inline in a
   * bin is fenced behind `invokedAsScript` and nothing can call it), and the caller is forced to
   * do the check BEFORE it opens the database. That ordering is load-bearing: `openBetterSqlite3`
   * CREATES the file when it is absent, so a check made after the open would find a 0-row database
   * it had just created itself and archive that instead of refusing.
   */
  dbPresent: boolean
}

/**
 * The mis-rooted-backup guard, and the reason `pruneBackupStaging` does not need one.
 *
 * An absent database means `ADOPTION_INDEX_CWD` or `WorkingDirectory=` points somewhere the store
 * has never run — the §8.5 decoy-root shape. Uploading a freshly-created empty database under
 * today's date would be worse than failing: it would age out a real archive from the object store's
 * lifecycle window and read as a healthy backup the whole time.
 */
export function refuseToArchive(input: RefuseToArchiveInput): string | null {
  const { dbPath, dbPresent } = input
  if (!dbPresent) {
    return (
      `backup: refusing to archive — no database at ${dbPath}. ` +
      `An absent store means the working directory is wrong, not that there is nothing to back up.`
    )
  }
  return null
}

export interface WriteArchiveInput {
  /** An OPEN database. The caller owns opening and closing it. */
  db: SqliteDatabase
  /** Absolute path of the archive to create. Must not already exist — see below. */
  target: string
}

/**
 * Snapshot an open database into `target` via `VACUUM INTO`.
 *
 * `VACUUM INTO` REFUSES AN EXISTING FILE, by SQLite's design, and that refusal is load-bearing: it
 * makes "overwrite the day's archive" an explicit act rather than a silent one. So a pre-existing
 * archive is removed here, deliberately and narrowly — only a regular file, only at the exact path
 * this module derives. A same-day re-run therefore REPLACES the day's archive, which is the
 * behaviour `archiveFileName`'s one-object-per-day contract requires.
 *
 * The path goes through a bound parameter rather than string interpolation. A path interpolated into
 * `VACUUM INTO '…'` would break on an apostrophe and, worse, would make the archive destination a
 * function of unescaped text.
 */
export function writeArchive(input: WriteArchiveInput): void {
  const { db, target } = input
  if (existsSync(target)) {
    if (!statSync(target).isFile()) {
      throw new Error(`backup: archive path exists and is not a file: ${target}`)
    }
    rmSync(target, { force: true })
  }
  db.prepare("VACUUM INTO ?").run(target)
}

/**
 * The three tables whose rows cannot be rebuilt from any source: `first_seen_at` is the timestamp of
 * an observation nobody can observe twice (`deploy/adoption-index/README.md`, "Only the database is
 * archived"). An archive that opens cleanly but lost one of these is a backup of the rebuildable
 * half, which is the failure this verification exists to make visible.
 */
export const UNREBUILDABLE_TABLES = ["source_records", "canonical_subjects", "artifact_versions"] as const

export interface VerifyArchiveResult {
  /** Row count per table in `UNREBUILDABLE_TABLES`, in that order. */
  rows: Record<string, number>
  /** Total across those tables — the one number a log line can carry. */
  total: number
}

/**
 * Read a freshly written archive back and prove it is restorable BEFORE anything uploads it.
 *
 * The store runs in WAL mode, so a torn archive is a real outcome, and the README already names when
 * it surfaces: "only reveals itself when someone tries to restore it." Uploading bytes nobody has
 * opened defers that discovery to the day the original is gone. `writeArchive`'s tests read the
 * archive back for exactly this reason; this lifts that readback out of the tests and onto the
 * production path, where the archive being verified is the one that gets shipped.
 *
 * Three checks, in ascending order of what they can catch:
 *
 * 1. `PRAGMA integrity_check` — the engine's own verdict. Anything other than the single row `ok`
 *    means the file is damaged, and SQLite reports the specific damage, so the message carries it.
 * 2. every `UNREBUILDABLE_TABLES` table is PRESENT. A syntactically valid database missing a table
 *    passes `integrity_check` happily; that is the shape a mis-rooted or half-migrated source
 *    produces.
 * 3. row counts, REPORTED and not asserted against a threshold. A fresh deployment legitimately has
 *    zero rows, so a floor here would refuse the first backup of a new host — a guard whose failing
 *    mode is the system working as designed. The count is evidence for a human and for the drill
 *    journal, not a gate.
 *
 * PURE with respect to the filesystem: the caller owns opening and closing `db`, so this can run
 * against a temp archive in a test or the real staged one in the bin.
 */
export function verifyArchive(input: { db: SqliteDatabase }): VerifyArchiveResult {
  const { db } = input

  // `integrity_check` reports damage two different ways, and only one of them is a return value.
  // Structural damage (a torn page) makes the PRAGMA itself THROW `database disk image is malformed`
  // — so a bare `verdict !== "ok"` branch would never run for the most likely corruption, i.e. a
  // check with no failing mode for the case it exists to catch. Both paths are funnelled into one
  // message here so the operator gets this module's diagnosis either way.
  let verdict: string
  try {
    const integrity = db.pragma("integrity_check") as unknown
    verdict = Array.isArray(integrity)
      ? integrity.map((r) => (r !== null && typeof r === "object" ? Object.values(r as object)[0] : r)).join("; ")
      : String(integrity)
  } catch (err) {
    throw new Error(`backup: archive failed integrity_check — ${err instanceof Error ? err.message : String(err)}`)
  }
  if (verdict !== "ok") {
    throw new Error(`backup: archive failed integrity_check — ${verdict}`)
  }

  const present = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name),
  )
  const missing = UNREBUILDABLE_TABLES.filter((t) => !present.has(t))
  if (missing.length > 0) {
    throw new Error(
      `backup: archive is missing ${missing.length} unrebuildable table(s): ${missing.join(", ")} — ` +
        `it opens cleanly but does not hold the facts the archive exists for`,
    )
  }

  const rows: Record<string, number> = {}
  let total = 0
  for (const t of UNREBUILDABLE_TABLES) {
    // The table name is from the frozen constant above, never from input — no interpolated identifier
    // can reach this string. SQLite does not accept a bound parameter in a FROM clause.
    const [row] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).all() as { n: number }[]
    const n = row?.n ?? 0
    rows[t] = n
    total += n
  }

  return { rows, total }
}

/**
 * The WAL sidecars SQLite keeps beside a database file, enumerated rather than globbed.
 *
 * These are the files a restore MUST remove, and the reason is measured rather than inherited from
 * folklore — see `planRestore`. Enumerated because a glob (`…sqlite-*`) would also match the
 * archive an operator staged next to the store, and a restore that deletes an archive is the one
 * failure mode worse than the one it is preventing.
 */
export const SQLITE_SIDECAR_SUFFIXES = ["-wal", "-shm"] as const

export interface PlanRestoreInput {
  /** Absolute path of the archive to restore FROM. */
  archive: string
  /** Absolute path of the store database to restore TO, from `resolveIndexPaths`. */
  dbPath: string
  /** Whether `archive` exists. Passed in for the same purity reason as `refuseToArchive`. */
  archivePresent: boolean
  /** Whether `dbPath` already exists — a restore over a live store needs explicit consent. */
  dbPresent: boolean
  /** The operator's explicit consent to overwrite an existing store. */
  force: boolean
}

/**
 * The restore refusal set — pure, so every branch is reachable from a test rather than fenced
 * behind `invokedAsScript` (control #112, the same reason `refuseToArchive` takes its booleans).
 *
 * THE `force` GATE IS THE POINT OF THIS FUNCTION. A restore is the only operation in this module
 * that destroys data the system is still using: it replaces the live store with an older
 * generation. `writeArchive` may delete a same-day archive because that archive is reproducible
 * from the store; nothing reproduces a store from an archive that has been overwritten by one. So
 * an existing database is a refusal by default and an overwrite is an explicit act.
 */
export function planRestore(input: PlanRestoreInput): string | null {
  const { archive, dbPath, archivePresent, dbPresent, force } = input
  if (!archivePresent) {
    return (
      `restore: refusing — no archive at ${archive}. ` +
      `Download it from object storage first; a restore cannot invent the generation it replaces.`
    )
  }
  if (resolve(archive) === resolve(dbPath)) {
    return `restore: refusing — the archive and the store are the same file (${archive})`
  }
  if (dbPresent && !force) {
    return (
      `restore: refusing — a store already exists at ${dbPath}. ` +
      `Restoring replaces it with the archive's generation, and nothing rebuilds the current one. ` +
      `Re-run with --force once you have confirmed that is what you want.`
    )
  }
  return null
}

export interface RestoreResult {
  /** Row counts the restored store holds, from `verifyArchive` — reported, never gated. */
  rows: Record<string, number>
  total: number
  /** Sidecar files removed beside the restored database, by absolute path. */
  removedSidecars: string[]
}

/**
 * Copy a VERIFIED archive over the store database and remove the previous generation's WAL
 * sidecars. The caller verifies the archive first; this function performs the replacement.
 *
 * WHY THE SIDECARS MUST GO, MEASURED 2026-08-16 AND WORSE THAN THE DOCUMENTED CLAIM. The README
 * said a stale `-wal` beside a restored database "is a *different* database, and SQLite may reject
 * or silently mix them." Run, it does not reject and it does not mix: with an uncheckpointed `-wal`
 * from the OLD generation left in place, SQLite opens the file, reports `integrity_check` **ok**,
 * and serves the OLD generation's rows — the restore silently does nothing at all while every
 * check an operator would think to run says the store is healthy. The archive's rows are simply not
 * there. That is why this is a step in code and not a line in a runbook: it has no failure signal
 * of its own, so a human cannot be asked to remember it.
 *
 * `copyFileSync`, not `VACUUM INTO`: the source is a quiescent archive nobody is writing to, so
 * there is no torn-snapshot risk in this direction, and a byte copy keeps the restored store
 * bit-identical to the archive an operator verified.
 */
export function restoreArchive(input: { archive: string; dbPath: string }): string[] {
  const { archive, dbPath } = input
  mkdirSync(dirname(dbPath), { recursive: true })
  copyFileSync(archive, dbPath)

  const removed: string[] = []
  for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
    const sidecar = `${dbPath}${suffix}`
    if (existsSync(sidecar)) {
      rmSync(sidecar, { force: true })
      removed.push(sidecar)
    }
  }
  return removed
}

/** Create the staging directory. Separate from the write so the bin can report which step failed. */
export function ensureStagingRoot(cwd: string): string {
  const root = backupStagingRoot(cwd)
  mkdirSync(root, { recursive: true })
  return root
}

/**
 * Delete every staged archive — the local half of the user-requested cleanup.
 *
 * WHY THIS IS UNCONDITIONAL AND NOT WINDOWED. `pruneOldBlobs` and `pruneStaleStaging` both take a
 * window because their inputs may still be wanted. A staged archive never is: it exists only to be
 * handed to object storage, and the copy that matters is the remote one. Keeping local archives on
 * a window would mean N SQLite copies on a disk whose growth is the thing this batch was asked to
 * bound — one full copy of the store per day, which is the largest single file the host would grow.
 *
 * AN ABSENT STAGING DIRECTORY IS NOT AN ERROR HERE, and that is a deliberate difference from
 * `pruneStaleStaging`, where it is. The asymmetry has a measured basis rather than being a lapse:
 *
 *   - `work/` is created unconditionally by step 1 of the ingest unit (`refreshSnapshot.ts:278`), so
 *     its absence can only mean the root is wrong — the §8.5 decoy-root failure.
 *   - This directory is created by the backup unit's own first step. The sweep runs from
 *     `ExecStopPost=`, which fires even when that step failed before creating anything. Throwing
 *     there would convert "the archive step already failed and said so" into a second, louder
 *     failure that names the wrong cause.
 *
 * The guard against a mis-rooted backup is therefore in the ARCHIVE step, which refuses to run when
 * the database is absent, rather than here.
 */
export function pruneBackupStaging(input: { stagingRoot: string }): PruneBackupStagingResult {
  const { stagingRoot } = input
  let inspected = 0
  let deleted = 0
  let failed = 0
  let skipped = 0

  if (!existsSync(stagingRoot)) return { inspected, deleted, failed, skipped }

  let entries: string[]
  try {
    entries = readdirSync(stagingRoot)
  } catch (err) {
    console.error(`Failed to read backup staging directory ${stagingRoot}:`, err)
    throw err
  }

  for (const name of entries) {
    const entryPath = join(stagingRoot, name)
    if (!name.endsWith(ARCHIVE_SUFFIX)) {
      skipped++
      continue
    }
    try {
      if (!statSync(entryPath).isFile()) {
        skipped++
        continue
      }
      inspected++
      try {
        rmSync(entryPath, { force: true })
        deleted++
      } catch (err) {
        console.error(`Failed to delete staged archive ${entryPath}:`, err)
        failed++
      }
    } catch (err) {
      console.error(`Failed to stat staged archive ${entryPath}:`, err)
      failed++
    }
  }

  return { inspected, deleted, failed, skipped }
}
