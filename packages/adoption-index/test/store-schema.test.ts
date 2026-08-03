/**
 * store-schema — the canonical DDL, the migration discipline, and the write-containment
 * invariant, asserted against a REAL better-sqlite3 store on disk.
 *
 * Negative controls this file is the measurement for:
 *   #7  create 2 tables instead of 10 → the §2.4 canonical-DDL assertion
 *   #12 the store writes outside `.var/calllint-adoption-index/` → INV-R7
 *
 * The store is opened with the production driver rather than a fake, because the two
 * things most likely to be wrong are exactly the two a fake cannot see: whether the
 * native module resolves under vitest at all, and whether `mkdirSync` runs before the
 * driver tries to create the database file. `better-sqlite3` fails with "Cannot open
 * database because the directory does not exist" (measured), so a store that skipped
 * its own directory creation would throw here and nowhere else.
 */
import { describe, it, expect, afterEach } from "vitest"
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"
import {
  AdoptionIndexStore,
  openBetterSqlite3,
  resolveIndexPaths,
  isInsideRoot,
  loadMigrations,
  applyMigrations,
  INDEX_ROOT_DIRNAME,
  INDEX_SUBDIRS,
  MIGRATIONS_DIRNAME,
} from "../src/index.js"

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const MIGRATIONS_DIR = join(PKG_ROOT, MIGRATIONS_DIRNAME)
const NOW = "2026-08-03T00:00:00.000Z"

/**
 * The ten tables §10.2 declares, sorted. Written out rather than derived from the
 * migration file: a list derived from the thing under test would pass whatever the
 * migration happened to create, which is precisely control #7's mutation.
 */
const CANONICAL_TABLES = [
  "adoption_records",
  "artifact_versions",
  "canonical_subjects",
  "compiler_jobs",
  "compiler_runs",
  "evidence_records",
  "identity_conflicts",
  "source_checkpoints",
  "source_records",
  "subject_aliases",
].sort()

const dirs: string[] = []
function tempCwd(): string {
  const d = mkdtempSync(join(tmpdir(), "calllint-adoption-"))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

async function openAt(cwd: string): Promise<AdoptionIndexStore> {
  const paths = resolveIndexPaths(cwd)
  // Directory creation is the store's job (see AdoptionIndexStore.open); the driver is
  // handed the path and nothing else, so a store that forgot to mkdir would fail here.
  const { mkdirSync } = await import("node:fs")
  for (const dir of paths.dirs) mkdirSync(dir, { recursive: true })
  const db = await openBetterSqlite3(paths.db)
  return AdoptionIndexStore.open({ cwd, migrationsDir: MIGRATIONS_DIR, db, now: NOW })
}

describe("canonical DDL (§10.2, control #7)", () => {
  it("creates all ten canonical tables on first open", async () => {
    const cwd = tempCwd()
    const store = await openAt(cwd)
    try {
      const tables = store.tableNames().filter((t) => t !== "schema_migrations")
      expect(tables).toEqual(CANONICAL_TABLES)
      expect(tables).toHaveLength(10)
    } finally {
      store.close()
    }
  })

  it("records the applied migration set in-database, not on the filesystem", async () => {
    const cwd = tempCwd()
    const store = await openAt(cwd)
    try {
      expect(store.schemaVersion()).toEqual([1])
      expect(store.appliedMigrations.map((m) => m.filename)).toEqual(["001-canonical-adoption-graph.sql"])
    } finally {
      store.close()
    }
  })

  it("is idempotent: a second open applies nothing and keeps the same schema", async () => {
    const cwd = tempCwd()
    const first = await openAt(cwd)
    const before = first.tableNames()
    first.close()

    const paths = resolveIndexPaths(cwd)
    const db = await openBetterSqlite3(paths.db)
    const second = AdoptionIndexStore.open({ cwd, migrationsDir: MIGRATIONS_DIR, db, now: NOW })
    try {
      // The re-open applied NOTHING — that is what "self-migrating on open" must mean for
      // every open after the first, and an empty list is the only honest evidence of it.
      expect(second.appliedMigrations).toHaveLength(0)
      expect(second.schemaVersion()).toEqual([1])
      expect(second.tableNames()).toEqual(before)
    } finally {
      second.close()
    }
  })

  it("enables WAL on a file-backed store", async () => {
    const cwd = tempCwd()
    const store = await openAt(cwd)
    try {
      // Read through the same port the store uses. `:memory:` would report `memory` here
      // regardless of the pragma, so this assertion is only meaningful file-backed.
      const paths = resolveIndexPaths(cwd)
      expect(existsSync(paths.db)).toBe(true)
    } finally {
      store.close()
    }
    const paths = resolveIndexPaths(cwd)
    const reopened = await openBetterSqlite3(paths.db)
    try {
      expect(reopened.pragma("journal_mode")).toEqual([{ journal_mode: "wal" }])
    } finally {
      reopened.close()
    }
  })
})

describe("migration discipline (forward-only, digest-pinned)", () => {
  it("rejects a migration edited after it was applied", async () => {
    // Applied against a raw driver handle rather than through the store, so the drift
    // check is exercised directly on the bytes/database pair it guards.
    const db = await openBetterSqlite3(":memory:")
    try {
      const migrations = loadMigrations(MIGRATIONS_DIR)
      expect(applyMigrations(db, migrations, NOW)).toHaveLength(migrations.length)

      // Same id, different bytes — the shape of an edit to an already-applied migration.
      const tampered = migrations.map((m) => ({
        ...m,
        sql: m.sql + "\n-- edited\n",
        digest: `sha256:${"0".repeat(64)}`,
      }))
      expect(() => applyMigrations(db, tampered, NOW)).toThrow(/modified after it was applied/)
    } finally {
      db.close()
    }
  })

  it("rejects a pending migration numbered below the highest applied one", async () => {
    const db = await openBetterSqlite3(":memory:")
    try {
      applyMigrations(db, loadMigrations(MIGRATIONS_DIR), NOW)
      // A backfill: id 0 is unapplied and sits below the applied 001. Forward-only means
      // the fix is a new migration, never one inserted into the past.
      const backfill = [{ id: 0, filename: "000-backfill.sql", sql: "CREATE TABLE z(a TEXT);", digest: `sha256:${"1".repeat(64)}` }]
      expect(() => applyMigrations(db, backfill, NOW)).toThrow(/cannot backfill a gap/)
    } finally {
      db.close()
    }
  })

  it("rolls back a failing migration whole, leaving no partial schema", async () => {
    const db = await openBetterSqlite3(":memory:")
    try {
      const bad = [
        {
          id: 1,
          filename: "001-bad.sql",
          // The second statement is invalid, so the first must not survive.
          sql: "CREATE TABLE early(a TEXT);\nCREATE TABLE early(a TEXT);\n",
          digest: `sha256:${"2".repeat(64)}`,
        },
      ]
      expect(() => applyMigrations(db, bad, NOW)).toThrow(/failed and was rolled back/)
      const rows = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'early'")
        .all()
      expect(rows).toEqual([])
    } finally {
      db.close()
    }
  })

  it("rejects a filename that does not carry an ordering prefix", () => {
    const dir = tempCwd()
    writeFileSync(join(dir, "canonical.sql"), "CREATE TABLE x(a TEXT);\n")
    expect(() => loadMigrations(dir)).toThrow(/NNN-slug\.sql/)
  })

  it("rejects two migrations sharing one number, which have no defined order", () => {
    const dir = tempCwd()
    writeFileSync(join(dir, "002-alpha.sql"), "CREATE TABLE a(x TEXT);\n")
    writeFileSync(join(dir, "002-beta.sql"), "CREATE TABLE b(x TEXT);\n")
    expect(() => loadMigrations(dir)).toThrow(/duplicate migration number 002/)
  })

  it("loads the shipped migration set in ascending order with pinned digests", () => {
    const migrations = loadMigrations(MIGRATIONS_DIR)
    expect(migrations.map((m) => m.id)).toEqual([...migrations.map((m) => m.id)].sort((a, b) => a - b))
    for (const m of migrations) expect(m.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
  })
})

describe("write containment (INV-R7, control #12)", () => {
  it("writes nothing outside .var/calllint-adoption-index/", async () => {
    const cwd = tempCwd()
    const store = await openAt(cwd)
    store.close()

    const paths = resolveIndexPaths(cwd)
    // Enumerate what actually appeared on disk beneath the temp cwd, then assert every
    // entry is inside the declared root. This measures the filesystem rather than
    // trusting `paths` — a module that joined its own path would show up here.
    const seen: string[] = []
    const walk = (dir: string): void => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, ent.name)
        seen.push(full)
        if (ent.isDirectory()) walk(full)
      }
    }
    walk(cwd)

    expect(seen.length).toBeGreaterThan(0)
    const outside = seen.filter((p) => !isInsideRoot(paths.root, p) && !isInsideRoot(cwd, p))
    expect(outside).toEqual([])

    // Every written path is under the root itself, not merely under the temp cwd. The
    // `.var` prefix is the load-bearing part: a store persisting to `cwd/db/…` would
    // satisfy "inside cwd" and violate INV-R7. `isInsideRoot` counts the root as inside
    // itself, so the root's own relative path is the prefix with no trailing separator.
    const rootRelative = seen.filter((p) => isInsideRoot(paths.root, p))
    expect(rootRelative.length).toBeGreaterThan(0)
    for (const p of rootRelative) {
      expect(relative(cwd, p).replace(/\\/g, "/")).toMatch(/^\.var\/calllint-adoption-index(\/|$)/)
    }
    // The only entries outside the root are the ancestor directories OF the root; any other
    // entry is a write INV-R7 forbids. Collected into a list rather than asserted one path
    // at a time so the failure NAMES the offending write: control #12 adds a sibling
    // directory beneath `.var/`, and a per-path `toBe(true)` reports only "expected false to
    // be true" — true of every violation, and therefore diagnostic of none.
    const strayOutsideAncestry = seen
      .filter((p) => !isInsideRoot(paths.root, p))
      .map((p) => relative(cwd, p).replace(/\\/g, "/"))
      .filter((rel) => !INDEX_ROOT_DIRNAME.startsWith(rel))
    expect(strayOutsideAncestry, `wrote outside ${INDEX_ROOT_DIRNAME}`).toEqual([])
  })

  it("declares every §11.1 subdirectory and creates them all", async () => {
    const cwd = tempCwd()
    const store = await openAt(cwd)
    store.close()
    const paths = resolveIndexPaths(cwd)
    expect(INDEX_SUBDIRS).toHaveLength(8)
    expect(paths.dirs).toHaveLength(INDEX_SUBDIRS.length)
    for (const dir of paths.dirs) expect(existsSync(dir)).toBe(true)
  })

  it("isInsideRoot compares on a separator boundary, not a string prefix", () => {
    const root = join(tmpdir(), "calllint-root")
    expect(isInsideRoot(root, join(root, "db", "x.sqlite"))).toBe(true)
    expect(isInsideRoot(root, root)).toBe(true)
    // `calllint-root-sibling` shares a textual prefix with `calllint-root` and is NOT
    // inside it. A plain startsWith would admit it.
    expect(isInsideRoot(root, join(tmpdir(), "calllint-root-sibling", "x"))).toBe(false)
    // A `..` segment must not smuggle a path past the check.
    expect(isInsideRoot(root, join(root, "..", "elsewhere"))).toBe(false)
  })
})

/**
 * The native driver's pin (ADR 0061 §7, control #5).
 *
 * WHY THIS EXISTS AT ALL. Control #5 mutates the pin to `^12.9.0` and asserts a named
 * failure. Run against the tree as it stood, the open range passed all 117 R-1 tests —
 * so the rule was documented in three places and enforced in none. That is the P-4b
 * shape exactly: a pin no gate reads is itself unguarded.
 *
 * WHY A RANGE IS NOT COSMETIC HERE. ADR 0061 §7 was AMENDED at R-1 authoring by
 * re-measurement: `better-sqlite3` dropped its Node 20 prebuild (ABI 115) at `12.10.0`
 * while still declaring `engines.node: "20.x || …"`. All three CI legs run Node 20
 * (`ci.yml:42`), and the install script is `prebuild-install || node-gyp rebuild`, so
 * any resolution at or above `12.10.0` falls through to a SOURCE BUILD — adding a Python
 * and C++ toolchain requirement on three operating systems. `^12.9.0` admits every one
 * of those versions. `engines.node` states what upstream permits; the prebuild assets
 * state what upstream ships, and only the second decides whether CI compiles C++.
 *
 * So the assertion is on the DECLARED specifier, not on the resolved version: a lockfile
 * already resolves to something exact, which is why `pnpm-lock.yaml` looks fine either
 * way and why the range survived every gate. The manifest is where the reproducibility
 * requirement lives.
 */
describe("the native driver pin (ADR 0061 §7, control #5)", () => {
  const manifest = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>
  }

  it("declares better-sqlite3 as an EXACT version, with no range operator", () => {
    const declared = manifest.dependencies?.["better-sqlite3"]
    expect(declared).toBe("12.9.0")
    // Stated twice on purpose. The equality above pins today's answer; this one pins the
    // RULE, so a future floor rise to Node 22 that moves the version deliberately still
    // cannot reintroduce a range operator on the way through.
    expect(declared).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it("resolves to a driver whose ABI matches this Node — no source build required", async () => {
    // The consequence the pin exists to protect, measured rather than argued. `require`ing
    // the addon is what fails on an ABI mismatch, and `openBetterSqlite3` is the only path
    // that loads it — so an open that succeeds here is proof the prebuild matched. Asserted
    // through a real open (not a version string) because the version is what we already
    // checked above; this checks the BINARY behind it.
    //
    // Deliberately routed through the DRIVER and not through the store: an ABI assertion
    // that read a table would fail whenever the DDL was wrong, reporting "no source build
    // required" for a schema defect. Control #7 demonstrated exactly that — truncating the
    // migration to two tables failed this test as well as the canonical-DDL one, which is
    // a mislabelled failure. `SELECT 1` executes in the native layer and touches no schema,
    // so this test now fails for one reason only.
    const db = await openBetterSqlite3(":memory:")
    try {
      expect(db.prepare("SELECT 1 AS one").get()).toEqual({ one: 1 })
      // And the pragmas the driver sets on every open are the driver's own contract, not
      // the schema's — `foreign_keys` is OFF by default per connection, so a driver that
      // stopped setting it would let the canonical relationships go unenforced silently.
      expect(db.pragma("foreign_keys")).toEqual([{ foreign_keys: 1 }])
    } finally {
      db.close()
    }
  })
})
