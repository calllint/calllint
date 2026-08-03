/**
 * migrate — numbered, forward-only migrations applied inside ONE transaction, with the
 * applied set recorded in-database.
 *
 * Three decisions worth stating, because each one is a failure mode this avoids:
 *
 * 1. **The whole migration runs in a transaction.** SQLite executes DDL
 *    transactionally, so a migration that fails on its eighth statement rolls back the
 *    first seven. Without this, a half-applied migration leaves a store that is
 *    neither the old nor the new schema, and the next open would try to re-apply
 *    statements whose tables already exist — failing with a confusing
 *    "table already exists" rather than the real error.
 *
 * 2. **The applied set lives in the database, not on the filesystem.** A marker file
 *    can be deleted or copied independently of the db; a row cannot. `schema_migrations`
 *    is the only table this module owns, and it is created outside the numbered
 *    sequence because it must exist before the first migration can be recorded.
 *
 * 3. **Each migration's bytes are digest-pinned on application.** If a migration file
 *    is edited after it has been applied somewhere, the digest recorded in the db no
 *    longer matches the file, and `applyMigrations` FAILS rather than silently running
 *    a different schema than the one the store was built from. Forward-only means the
 *    fix is a new migration, never an edit to an applied one — and this turns that
 *    convention from a rule people remember into one the code enforces.
 */
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { sha256 } from "@calllint/fingerprint"
import type { SqliteDatabase } from "./driver.js"

/** Filenames must be `NNN-slug.sql` — the numeric prefix fixes the order. */
const MIGRATION_FILENAME = /^(\d{3})-[a-z0-9-]+\.sql$/

export interface Migration {
  /** The numeric prefix, e.g. 1 for `001-…`. */
  id: number
  filename: string
  sql: string
  /** `sha256:…` over the file's bytes, pinned in `schema_migrations` on apply. */
  digest: string
}

const MIGRATIONS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY,
  filename TEXT NOT NULL,
  digest TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`

/**
 * Read and order the migration set from disk.
 *
 * Rejects a duplicate numeric prefix outright: `002-a.sql` and `002-b.sql` have no
 * defined order between them, so "apply in order" would silently depend on readdir.
 */
export function loadMigrations(migrationsDir: string): Migration[] {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()

  const out: Migration[] = []
  const seen = new Map<number, string>()
  for (const filename of files) {
    const m = MIGRATION_FILENAME.exec(filename)
    if (!m) {
      throw new Error(`migration filename must match NNN-slug.sql, found: ${filename}`)
    }
    const id = Number(m[1])
    const prior = seen.get(id)
    if (prior !== undefined) {
      throw new Error(`duplicate migration number ${m[1]}: ${prior} and ${filename} have no defined order`)
    }
    seen.set(id, filename)
    const sql = readFileSync(join(migrationsDir, filename), "utf8")
    out.push({ id, filename, sql, digest: sha256(sql) })
  }
  return out.sort((a, b) => a.id - b.id)
}

export interface AppliedMigration {
  id: number
  filename: string
  digest: string
  appliedAt: string
}

export function readAppliedMigrations(db: SqliteDatabase): AppliedMigration[] {
  db.exec(MIGRATIONS_TABLE_DDL)
  return db
    .prepare("SELECT id, filename, digest, applied_at AS appliedAt FROM schema_migrations ORDER BY id")
    .all() as AppliedMigration[]
}

/**
 * Apply every pending migration, in order, each in its own transaction.
 *
 * `appliedAt` is an injected ISO-8601 string, not a `new Date()` read: the store must
 * hold no wall-clock reads on any path a reproducible compile can reach (INV-R6, §9.5).
 * Recording the timestamp is provenance, and provenance is an explicit input here as it
 * is everywhere else in this package.
 *
 * Returns the migrations it applied, so a caller can log or assert on them. An empty
 * array means the store was already current — which is the normal case for every open
 * after the first.
 */
export function applyMigrations(db: SqliteDatabase, migrations: Migration[], appliedAt: string): Migration[] {
  const applied = readAppliedMigrations(db)
  const byId = new Map(applied.map((a) => [a.id, a]))

  // Drift check BEFORE applying anything: an edited applied migration means the store
  // on disk was built from bytes that no longer exist, and no amount of forward
  // migration can reconcile that. Fail loudly instead of compounding it.
  for (const m of migrations) {
    const prior = byId.get(m.id)
    if (prior && prior.digest !== m.digest) {
      throw new Error(
        `migration ${m.filename} was modified after it was applied ` +
          `(recorded ${prior.digest}, file ${m.digest}). Migrations are forward-only: ` +
          "add a new migration instead of editing an applied one, or delete the store and recompile.",
      )
    }
  }

  // A gap means a migration was applied out of order or one was deleted; either way the
  // store's schema is not the schema this file set describes.
  const pending = migrations.filter((m) => !byId.has(m.id))
  const highestApplied = applied.length > 0 ? Math.max(...applied.map((a) => a.id)) : 0
  for (const m of pending) {
    if (m.id < highestApplied) {
      throw new Error(
        `migration ${m.filename} is unapplied but numbered below the highest applied migration ` +
          `(${highestApplied}); forward-only migrations cannot backfill a gap`,
      )
    }
  }

  const record = db.prepare(
    "INSERT INTO schema_migrations (id, filename, digest, applied_at) VALUES (?, ?, ?, ?)",
  )
  for (const m of pending) {
    db.exec("BEGIN")
    try {
      db.exec(m.sql)
      record.run(m.id, m.filename, m.digest, appliedAt)
      db.exec("COMMIT")
    } catch (err) {
      db.exec("ROLLBACK")
      throw new Error(`migration ${m.filename} failed and was rolled back: ${(err as Error).message}`)
    }
  }
  return pending
}
