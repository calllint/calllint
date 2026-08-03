/**
 * driver — the ONE seam where a SQLite implementation enters this package.
 *
 * `better-sqlite3` is a NATIVE module (a `.node` binary), and that fact is what makes
 * this seam load-bearing rather than decorative:
 *
 *   - It cannot be bundled. `calllint` and `calllint-mcp` ship as esbuild bundles with
 *     EMPTY runtime dependencies, asserted by `scripts/package-smoke.mjs` and
 *     `scripts/mcp-pack-smoke.mjs`. Anything reachable from those bundles must be
 *     bundleable; a `.node` binary is not. So this package is `"private": true` AND
 *     structurally unreachable from the published surface — both, because privacy alone
 *     stops publishing while reachability is what the bundler follows.
 *   - The import is therefore DYNAMIC and lives in exactly one function. A static
 *     top-level `import "better-sqlite3"` would make the native module a load-time
 *     dependency of merely *importing* a type from this package.
 *
 * The interface below is the minimum surface the store uses. It is deliberately not a
 * generic SQL abstraction: §10.3 says "implement interfaces, do not spread raw SQL
 * through compilers", and the way to honour that is a narrow port plus repository
 * methods above it — not a query builder that invites raw SQL at every call site.
 */

/** A prepared statement, narrowed to the three shapes this package uses. */
export interface SqliteStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement
  exec(sql: string): void
  pragma(source: string): unknown
  close(): void
}

/** Opens a database file. Injected so tests need no native module. */
export type SqliteDriver = (filename: string) => SqliteDatabase

/**
 * The production driver: `better-sqlite3`, imported dynamically so the native binding
 * loads only when a real store is opened.
 *
 * WAL is set here rather than by the caller because it is a property of how this store
 * is used (§10.1: single-node, SQLite WAL), not a per-open choice. `foreign_keys` is ON
 * for the same reason — the canonical schema's relationships are only real if the engine
 * enforces them, and SQLite defaults them OFF per connection.
 */
export async function openBetterSqlite3(filename: string): Promise<SqliteDatabase> {
  // No cast. The shape comes from `better-sqlite3.d.ts` beside this file, so the compiler
  // checks the import against the port instead of being told to trust it — an `as unknown as`
  // here would accept the module whatever that declaration said, leaving the declaration
  // decorative and this call site unchecked.
  const { default: Database } = await import("better-sqlite3")
  const db = new Database(filename)
  db.pragma("journal_mode = WAL")
  db.pragma("foreign_keys = ON")
  return db
}
