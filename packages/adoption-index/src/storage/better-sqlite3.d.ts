/**
 * The `better-sqlite3` types this package needs — declared locally, and deliberately NOT
 * taken from `@types/better-sqlite3`.
 *
 * `driver.ts` exists to keep exactly one narrow port between this package and a SQLite
 * implementation (§10.3: "implement interfaces, do not spread raw SQL through compilers").
 * Installing the upstream types would defeat that at the type level: every call site would
 * then see the full `Database` API — `backup`, `function`, `aggregate`, `loadExtension`,
 * `serialize` — and could reach past `SqliteDatabase` without the compiler objecting. The
 * port would still exist, but nothing would hold anyone to it.
 *
 * So the declaration names only the constructor, and types it as the port's own interface.
 * That makes this file a CLAIM about upstream rather than a copy of it, which is the honest
 * trade: the claim is measured, not assumed. `packages/adoption-index/test/` opens real
 * file-backed databases through this exact constructor — `pragma("journal_mode")` reads
 * back `wal`, ten tables get created, migrations roll back — so a declaration that
 * disagreed with the shipped native module would fail those tests rather than pass quietly.
 * A types-only stub with no such tests behind it would be the unsafe version of this.
 *
 * If `@types/better-sqlite3` is ever added, this file collides with it and the build fails
 * loudly. That is the intended outcome: two sources for one shape is the thing to catch.
 */
declare module "better-sqlite3" {
  import type { SqliteDatabase } from "./driver.js"

  const Database: new (filename: string) => SqliteDatabase
  export default Database
}
