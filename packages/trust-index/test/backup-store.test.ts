import { describe, it, expect } from "vitest"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { openBetterSqlite3, resolveIndexPaths } from "@calllint/adoption-index"
import {
  ARCHIVE_SUFFIX,
  BACKUP_STAGING_DIRNAME,
  archiveFileName,
  archivePath,
  backupStagingRoot,
  ensureStagingRoot,
  planRestore,
  pruneBackupStaging,
  refuseToArchive,
  restoreArchive,
  SQLITE_SIDECAR_SUFFIXES,
  UNREBUILDABLE_TABLES,
  verifyArchive,
  writeArchive,
} from "../src/backupStore.js"

/**
 * Import the restore bin exactly once, INTO A TRAP that an unguarded module body would spring.
 *
 * Two problems make the obvious version of this a guard that cannot observe its subject, and both
 * were found by bypassing `invokedAsScript` and watching the test stay green:
 *
 *  1. THE MODULE CACHE. An import runs the body at most once per process. Whichever test imported
 *     first would be the only one that could ever see a leak, so the assertion has to live with the
 *     import rather than in whichever test happens to run first.
 *  2. VITEST'S ARGV. `main()` reads `process.argv.slice(2)`, which under vitest is `["run", "<file>"]`
 *     — so an unguarded body refuses at `planRestore` ("no archive at …/run") and destroys nothing.
 *     A test importing under those conditions proves only that vitest's argv is not a valid restore
 *     invocation. So argv is replaced here with a call that would SUCCEED: a real, verifiable archive
 *     plus `--force`. `argv[1]` deliberately still points elsewhere, exactly as it does under vitest,
 *     which is the condition `invokedAsScript` must evaluate to false.
 *
 * The fixture is left in place for the guard test to inspect, and the verdict is captured at import
 * time because that is the only instant the body could have run.
 */
const TRAP_STORE_BYTES = "the live store — an unguarded import would have replaced these bytes"
const TRAP_ARCHIVE_ROWS = 2

type RestoreBinModule = typeof import("../src/restoreAdoptionIndex.js")
let cachedBin: { mod: RestoreBinModule; storeBytes: string; archivePresent: boolean } | null = null

const loadRestoreBinOnce = async () => {
  if (cachedBin !== null) return cachedBin

  const source = mkdtempSync(join(tmpdir(), "restore-trap-src-"))
  const trap = mkdtempSync(join(tmpdir(), "restore-trap-"))
  try {
    // A real archive, built by the production writer so it passes `verifyArchive` — every refusal in
    // `main()` has to be satisfied, or the guard test measures a refusal instead of the guard.
    const sourceDb = resolveIndexPaths(source).db
    mkdirSync(join(source, ".var", "calllint-adoption-index", "db"), { recursive: true })
    const db = await openBetterSqlite3(sourceDb)
    db.exec(UNREBUILDABLE_TABLES.map((t) => `CREATE TABLE ${t} (id TEXT PRIMARY KEY)`).join(";"))
    db.prepare("INSERT INTO source_records VALUES (?)").run("TRAP-A")
    db.prepare("INSERT INTO canonical_subjects VALUES (?)").run("TRAP-B")
    const built = archivePath(source, "2026-08-16T03:30:00Z")
    ensureStagingRoot(source)
    writeArchive({ db, target: built })
    db.close()

    const trapDb = resolveIndexPaths(trap).db
    mkdirSync(join(trap, ".var", "calllint-adoption-index", "db"), { recursive: true })
    writeFileSync(trapDb, TRAP_STORE_BYTES)
    const archive = join(ensureStagingRoot(trap), `adoption-index-2026-08-16${ARCHIVE_SUFFIX}`)
    copyFileSync(built, archive)

    const previousEnv = process.env.ADOPTION_INDEX_CWD
    const previousArgv = process.argv
    process.env.ADOPTION_INDEX_CWD = trap
    process.argv = [process.argv[0] ?? "node", join(source, "not-the-restore-bin.ts"), archive, "--force"]
    let mod: RestoreBinModule
    try {
      mod = await import("../src/restoreAdoptionIndex.js")
      // DRAIN BEFORE MEASURING. `main()` is async and its first `await` is the archive open, so the
      // `copyFileSync` that would destroy the trap store lands in a later macrotask — after the
      // import promise has already resolved. Reading the bytes immediately would therefore find them
      // intact whether the guard held or not, which is the same unobservable-subject failure this
      // helper exists to avoid. Several turns of the loop, so a chain of awaits cannot outrun it.
      for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0))
    } finally {
      process.argv = previousArgv
      if (previousEnv === undefined) delete process.env.ADOPTION_INDEX_CWD
      else process.env.ADOPTION_INDEX_CWD = previousEnv
    }

    cachedBin = { mod, storeBytes: readFileSync(trapDb, "utf8"), archivePresent: existsSync(archive) }
    return cachedBin
  } finally {
    rmSync(source, { recursive: true, force: true })
    rmSync(trap, { recursive: true, force: true })
  }
}

describe("archiveFileName", () => {
  it("is DATE-stamped, so one object per day is what the key itself says", () => {
    // The one-object-per-day contract is what makes an OSS lifecycle rule legible: "delete after N
    // days" is a sentence about this name. Two instants in the same UTC day must collapse to one key.
    expect(archiveFileName("2026-08-08T03:30:00Z")).toBe("adoption-index-2026-08-08.sqlite")
    expect(archiveFileName("2026-08-08T23:59:59.999Z")).toBe("adoption-index-2026-08-08.sqlite")
    expect(archiveFileName("2026-08-08T00:00:00Z")).toBe("adoption-index-2026-08-08.sqlite")
  })

  it("distinguishes adjacent days rather than collapsing everything to one key", () => {
    // Non-vacuity for the assertion above: a name that ignored `now` entirely would satisfy it.
    expect(archiveFileName("2026-08-07T03:30:00Z")).not.toBe(archiveFileName("2026-08-08T03:30:00Z"))
  })

  it("refuses a bad clock read instead of naming the archive after it", () => {
    // `new Date("nonsense").toISOString()` throws, but `String(new Date("nonsense"))` does not — so
    // an unvalidated implementation would produce `adoption-index-Invalid Date.sqlite` and upload it.
    for (const raw of ["nonsense", "", "2026-13-45", "yesterday"]) {
      expect(() => archiveFileName(raw)).toThrow(/ISO-8601/)
    }
  })

  it("ends in the suffix the sweep recognises", () => {
    // The two constants must agree or the sweep would leave every archive it created on disk.
    expect(archiveFileName("2026-08-08T03:30:00Z").endsWith(ARCHIVE_SUFFIX)).toBe(true)
  })
})

describe("backupStagingRoot", () => {
  it("is a SIBLING of the index root, not a ninth subdirectory of it", () => {
    // `INDEX_SUBDIRS` is pinned at exactly 8 by control #12, and that pin is right: it enumerates
    // the STORE's persistence, and an operational archive is not store persistence. Measured against
    // `resolveIndexPaths` rather than restated, so a future move of either would fail here.
    const cwd = join(tmpdir(), "backup-sibling-probe")
    const staging = backupStagingRoot(cwd)
    const paths = resolveIndexPaths(cwd)

    expect(staging.startsWith(paths.root)).toBe(false)
    expect(paths.dirs.filter((d) => d.startsWith(staging))).toEqual([])
  })

  it("stays inside `.var/`, the one ReadWritePaths entry that makes the write legal", () => {
    // `ProtectSystem=strict` on the host permits exactly two paths. An archive staged anywhere else
    // fails at deploy time on a host no CI of ours watches, so this is asserted here instead.
    expect(BACKUP_STAGING_DIRNAME.startsWith(".var/")).toBe(true)
    expect(archivePath("/opt/calllint", "2026-08-08T03:30:00Z")).toContain(".var")
  })
})

describe("refuseToArchive", () => {
  it("refuses when the database is absent — the mis-rooted-backup guard", () => {
    // `openBetterSqlite3` CREATES the file when it is absent, so without this guard a wrong
    // `WorkingDirectory=` would archive a 0-row database it had just created and upload it under
    // today's key — aging a real archive out of the lifecycle window while reading as healthy.
    const refusal = refuseToArchive({ dbPath: "/nowhere/adoption-index.sqlite", dbPresent: false })
    expect(refusal).not.toBeNull()
    expect(refusal).toContain("/nowhere/adoption-index.sqlite")
  })

  it("permits the archive when the database is present", () => {
    expect(refuseToArchive({ dbPath: "/opt/calllint/.var/x.sqlite", dbPresent: true })).toBeNull()
  })
})

/**
 * `writeArchive` against a REAL native store, not a fake.
 *
 * A stub `SqliteDatabase` would prove nothing about the one thing this module rests on: that
 * `VACUUM INTO` accepts a BOUND path parameter and produces a readable database. `schema-compatibility`
 * already opens a real store in tests, so this is an established shape rather than a new dependency.
 */
describe("writeArchive — real SQLite", () => {
  const withStore = async (fn: (ctx: { cwd: string; dbPath: string }) => Promise<void>) => {
    const cwd = mkdtempSync(join(tmpdir(), "backup-archive-"))
    try {
      const { db: dbPath } = resolveIndexPaths(cwd)
      mkdirSync(join(cwd, ".var", "calllint-adoption-index", "db"), { recursive: true })
      await fn({ cwd, dbPath })
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  }

  it("snapshots a WAL database into a readable archive, rows intact", async () => {
    await withStore(async ({ cwd, dbPath }) => {
      const db = await openBetterSqlite3(dbPath)
      db.exec("CREATE TABLE probe (subject TEXT PRIMARY KEY, first_seen_at TEXT NOT NULL)")
      db.prepare("INSERT INTO probe VALUES (?, ?)").run("acme/server", "2026-01-01T00:00:00Z")

      const target = archivePath(cwd, "2026-08-08T03:30:00Z")
      ensureStagingRoot(cwd)
      writeArchive({ db, target })
      db.close()

      expect(existsSync(target)).toBe(true)
      expect(statSync(target).size).toBeGreaterThan(0)

      // The readback is the assertion that matters. The store runs in WAL mode, so a THREE-FILE
      // copy would yield an archive missing whatever sat in `-wal` — and that only reveals itself
      // on restore. Reading the row back proves the snapshot is consistent, not merely non-empty.
      const restored = await openBetterSqlite3(target)
      try {
        expect(restored.prepare("SELECT first_seen_at FROM probe WHERE subject = ?").all("acme/server")).toEqual([
          { first_seen_at: "2026-01-01T00:00:00Z" },
        ])
      } finally {
        restored.close()
      }
    })
  })

  it("carries a row committed with no checkpoint — what a file copy would have lost", async () => {
    // Sharper than the test above, and the reason `VACUUM INTO` was chosen over `cp`. The insert is
    // committed but never checkpointed, so it lives in `-wal` at this instant. An implementation
    // that copied only `db/…sqlite` would produce a valid database missing exactly this row.
    await withStore(async ({ cwd, dbPath }) => {
      const db = await openBetterSqlite3(dbPath)
      db.exec("CREATE TABLE probe (k TEXT)")
      db.prepare("INSERT INTO probe VALUES (?)").run("in-wal")

      const target = archivePath(cwd, "2026-08-08T03:30:00Z")
      ensureStagingRoot(cwd)

      // The CONTRAST is the assertion. Taken at this same instant, with the writer still open: a
      // copy of `db/…sqlite` alone is what the rejected implementation would have shipped. Without
      // this line the test proves only that `VACUUM INTO` works, and the claim above — that a file
      // copy loses the row — would stay an unfalsifiable comment. Swapping `writeArchive` for a
      // `copyFileSync` must make this test red, and this is the line that makes it red.
      const naive = `${target}.naive-copy`
      copyFileSync(dbPath, naive)

      writeArchive({ db, target })
      db.close()

      // MEASURED, not assumed: the copy loses more than the row. `CREATE TABLE` is itself an
      // uncheckpointed transaction, so `probe` does not exist in the main db file at all — the copy
      // opens cleanly as an EMPTY database. That is the shape `verifyArchive`'s missing-table refusal
      // exists for, and it is why this archive would have read as "healthy, just a new deployment".
      const fromCopy = await openBetterSqlite3(naive)
      try {
        expect(() => fromCopy.prepare("SELECT k FROM probe").all()).toThrow(/no such table: probe/)
      } finally {
        fromCopy.close()
      }

      const restored = await openBetterSqlite3(target)
      try {
        expect(restored.prepare("SELECT k FROM probe").all()).toEqual([{ k: "in-wal" }])
      } finally {
        restored.close()
      }
    })
  })

  it("replaces the day's archive on a same-day re-run rather than failing on it", async () => {
    // SQLite's `VACUUM INTO` REFUSES an existing file ("output file already exists"), measured. That
    // refusal is what makes the removal in `writeArchive` deliberate rather than incidental: without
    // it a manual re-run would fail, and with a timestamped name it would instead leave two archives
    // for one day, both uploaded and both aged out independently.
    await withStore(async ({ cwd, dbPath }) => {
      const db = await openBetterSqlite3(dbPath)
      db.exec("CREATE TABLE probe (k TEXT)")
      db.prepare("INSERT INTO probe VALUES (?)").run("first")

      const target = archivePath(cwd, "2026-08-08T03:30:00Z")
      ensureStagingRoot(cwd)
      writeArchive({ db, target })

      db.prepare("INSERT INTO probe VALUES (?)").run("second")
      writeArchive({ db, target })
      db.close()

      const restored = await openBetterSqlite3(target)
      try {
        // Both rows present ⇒ the second call really re-snapshotted rather than leaving the first
        // archive in place, which is what a silently-swallowed refusal would look like.
        expect(restored.prepare("SELECT k FROM probe ORDER BY k").all()).toEqual([
          { k: "first" },
          { k: "second" },
        ])
      } finally {
        restored.close()
      }
    })
  })

  it("accepts a staging path containing an apostrophe", async () => {
    // The path goes through a BOUND parameter, not string interpolation. Interpolated into
    // `VACUUM INTO '…'` this path would be a syntax error, and worse, the destination would be a
    // function of unescaped text. A repo checked out under a directory with an apostrophe is
    // unusual, not impossible.
    await withStore(async ({ cwd, dbPath }) => {
      const db = await openBetterSqlite3(dbPath)
      db.exec("CREATE TABLE probe (k TEXT)")
      const staging = ensureStagingRoot(cwd)
      const target = join(staging, "o'quote-2026-08-08.sqlite")
      writeArchive({ db, target })
      db.close()
      expect(existsSync(target)).toBe(true)
    })
  })

  it("refuses a target that exists and is not a regular file", async () => {
    // The removal in `writeArchive` is narrow on purpose: only a regular file, only at the exact
    // path this module derives. A directory at that path is a misconfiguration, not something to
    // recursively delete.
    await withStore(async ({ cwd, dbPath }) => {
      const db = await openBetterSqlite3(dbPath)
      db.exec("CREATE TABLE probe (k TEXT)")
      const target = archivePath(cwd, "2026-08-08T03:30:00Z")
      mkdirSync(target, { recursive: true })
      expect(() => writeArchive({ db, target })).toThrow(/not a file/)
      db.close()
      expect(existsSync(target)).toBe(true)
    })
  })
})

describe("verifyArchive — the readback the upload depends on", () => {
  const SCHEMA = UNREBUILDABLE_TABLES.map(
    (t) => `CREATE TABLE ${t} (id TEXT PRIMARY KEY, first_seen_at TEXT NOT NULL)`,
  ).join(";")

  const withArchive = async (
    build: (db: Awaited<ReturnType<typeof openBetterSqlite3>>) => void,
    fn: (archive: Awaited<ReturnType<typeof openBetterSqlite3>>, target: string) => Promise<void>,
  ) => {
    const cwd = mkdtempSync(join(tmpdir(), "backup-verify-"))
    try {
      const { db: dbPath } = resolveIndexPaths(cwd)
      mkdirSync(join(cwd, ".var", "calllint-adoption-index", "db"), { recursive: true })
      const db = await openBetterSqlite3(dbPath)
      build(db)
      const target = archivePath(cwd, "2026-08-08T03:30:00Z")
      ensureStagingRoot(cwd)
      writeArchive({ db, target })
      db.close()
      const archive = await openBetterSqlite3(target)
      try {
        await fn(archive, target)
      } finally {
        archive.close()
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  }

  it("passes a sound archive and REPORTS the unrebuildable row counts", async () => {
    await withArchive(
      (db) => {
        db.exec(SCHEMA)
        db.prepare("INSERT INTO source_records VALUES (?, ?)").run("a", "2026-01-01T00:00:00Z")
        db.prepare("INSERT INTO source_records VALUES (?, ?)").run("b", "2026-01-02T00:00:00Z")
        db.prepare("INSERT INTO canonical_subjects VALUES (?, ?)").run("c", "2026-01-03T00:00:00Z")
      },
      async (archive) => {
        const r = verifyArchive({ db: archive })
        expect(r.rows).toEqual({ source_records: 2, canonical_subjects: 1, artifact_versions: 0 })
        expect(r.total).toBe(3)
      },
    )
  })

  it("passes an EMPTY archive — a new host's first backup is not a failure", async () => {
    // The counts are evidence, never a floor. A threshold here would refuse the first backup a
    // freshly deployed host takes, i.e. red on the system working as designed.
    await withArchive(
      (db) => db.exec(SCHEMA),
      async (archive) => {
        const r = verifyArchive({ db: archive })
        expect(r.total).toBe(0)
        expect(Object.keys(r.rows)).toEqual([...UNREBUILDABLE_TABLES])
      },
    )
  })

  it("REFUSES an archive that opens cleanly but lost an unrebuildable table", async () => {
    // The load-bearing case, and the one `integrity_check` alone cannot catch: this file is a
    // perfectly valid SQLite database. It is simply not a backup of the facts the archive exists
    // for — the shape a mis-rooted or half-migrated source produces.
    await withArchive(
      (db) => db.exec("CREATE TABLE source_records (id TEXT PRIMARY KEY, first_seen_at TEXT NOT NULL)"),
      async (archive) => {
        expect(archive.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }])
        expect(() => verifyArchive({ db: archive })).toThrow(/missing 2 unrebuildable table\(s\)/)
        expect(() => verifyArchive({ db: archive })).toThrow(/canonical_subjects, artifact_versions/)
      },
    )
  })

  it("names every missing table, so one run tells the operator the whole gap", async () => {
    await withArchive(
      (db) => db.exec("CREATE TABLE unrelated (k TEXT)"),
      async (archive) => {
        for (const t of UNREBUILDABLE_TABLES) {
          expect(() => verifyArchive({ db: archive })).toThrow(new RegExp(t))
        }
      },
    )
  })

  it("reports a damaged file through integrity_check rather than a row count", async () => {
    // Corrupts the archive's bytes after it was written, which is what a torn upload or a bad disk
    // yields. Asserting the integrity path fires FIRST matters: a count query on a damaged file
    // throws SQLite's own error, and that message would not tell an operator the file is corrupt.
    const cwd = mkdtempSync(join(tmpdir(), "backup-verify-bad-"))
    try {
      const { db: dbPath } = resolveIndexPaths(cwd)
      mkdirSync(join(cwd, ".var", "calllint-adoption-index", "db"), { recursive: true })
      const db = await openBetterSqlite3(dbPath)
      db.exec(SCHEMA)
      const target = archivePath(cwd, "2026-08-08T03:30:00Z")
      ensureStagingRoot(cwd)
      writeArchive({ db, target })
      db.close()

      const bytes = readFileSync(target)
      // Page 2 onward: leaves the 100-byte header intact so the file still OPENS as a database,
      // which is precisely the case a header-only check would wave through.
      bytes.fill(0x5a, 4096, Math.min(6144, bytes.length))
      writeFileSync(target, bytes)

      const archive = await openBetterSqlite3(target)
      try {
        // Pinned to THIS module's message, not to SQLite's. `/malformed/` would have accepted the
        // error `COUNT(*)` throws on a damaged file all by itself — i.e. the assertion would pass
        // with the integrity_check removed entirely, crediting a guard that was not running. The
        // prefix is what only `verifyArchive` can produce.
        expect(() => verifyArchive({ db: archive })).toThrow(/^backup: archive failed integrity_check —/)
      } finally {
        try {
          archive.close()
        } catch {
          // A corrupt handle can throw on close; the assertion above is the subject.
        }
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})

describe("pruneBackupStaging", () => {
  const withStaging = (fn: (ctx: { cwd: string; stagingRoot: string }) => void) => {
    const cwd = mkdtempSync(join(tmpdir(), "backup-sweep-"))
    try {
      fn({ cwd, stagingRoot: ensureStagingRoot(cwd) })
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  }

  it("control #127 — deletes every staged archive, leaving nothing behind", () => {
    // UNCONDITIONAL, not windowed. A staged archive exists only to be handed to object storage; the
    // copy that matters is the remote one. Keeping N days locally would mean N full SQLite copies on
    // the host, which is the growth the cleanup requirement exists to stop.
    withStaging(({ stagingRoot }) => {
      for (const day of ["2026-08-06", "2026-08-07", "2026-08-08"]) {
        writeFileSync(join(stagingRoot, `adoption-index-${day}${ARCHIVE_SUFFIX}`), "archive")
      }

      const result = pruneBackupStaging({ stagingRoot })

      expect(result).toEqual({ inspected: 3, deleted: 3, failed: 0, skipped: 0 })
      // Asserted on the DIRECTORY, not on the three names: a sweep that deleted only what it was
      // told about would satisfy a per-name check while leaving a fourth archive on disk.
      expect(readdirSync(stagingRoot)).toEqual([])
    })
  })

  it("deletes today's archive too — there is no in-flight file to spare", () => {
    // The deliberate difference from `pruneStaleStaging`, whose whole window exists because a
    // `work/…part` may be a write in progress. This sweep runs from `ExecStopPost=`, after the
    // upload step has already finished, so the freshest archive is exactly what should go.
    withStaging(({ cwd, stagingRoot }) => {
      const today = archivePath(cwd, "2026-08-08T03:30:00Z")
      writeFileSync(today, "archive")

      expect(pruneBackupStaging({ stagingRoot })).toEqual({
        inspected: 1,
        deleted: 1,
        failed: 0,
        skipped: 0,
      })
      expect(existsSync(today)).toBe(false)
    })
  })

  it("counts a non-archive entry as skipped and leaves it alone", () => {
    withStaging(({ stagingRoot }) => {
      const note = join(stagingRoot, "upload.log")
      writeFileSync(note, "last upload ok")
      writeFileSync(join(stagingRoot, `adoption-index-2026-08-08${ARCHIVE_SUFFIX}`), "archive")

      expect(pruneBackupStaging({ stagingRoot })).toEqual({
        inspected: 1,
        deleted: 1,
        failed: 0,
        skipped: 1,
      })
      expect(existsSync(note)).toBe(true)
    })
  })

  it("counts a directory named *.sqlite as skipped rather than trying to unlink it", () => {
    withStaging(({ stagingRoot }) => {
      mkdirSync(join(stagingRoot, `adoption-index-2026-08-08${ARCHIVE_SUFFIX}`), { recursive: true })

      expect(pruneBackupStaging({ stagingRoot })).toEqual({
        inspected: 0,
        deleted: 0,
        failed: 0,
        skipped: 1,
      })
    })
  })

  it("reports zero on an ABSENT staging directory instead of throwing", () => {
    // The deliberate asymmetry with `pruneStaleStaging`, where absence IS an error. `work/` is
    // created unconditionally by the ingest's step 1, so its absence can only mean a wrong root.
    // This directory is created by the backup unit's own first step, and the sweep runs from
    // `ExecStopPost=` — which fires even when that step failed before creating anything. Throwing
    // here would turn "the archive step already failed and said so" into a second, louder failure
    // naming the wrong cause. The mis-rooted guard lives in `refuseToArchive` instead.
    const cwd = mkdtempSync(join(tmpdir(), "backup-absent-"))
    try {
      const stagingRoot = backupStagingRoot(cwd)
      expect(existsSync(stagingRoot)).toBe(false)
      expect(pruneBackupStaging({ stagingRoot })).toEqual({
        inspected: 0,
        deleted: 0,
        failed: 0,
        skipped: 0,
      })
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it("reports zero on an empty staging directory", () => {
    withStaging(({ stagingRoot }) => {
      expect(pruneBackupStaging({ stagingRoot })).toEqual({
        inspected: 0,
        deleted: 0,
        failed: 0,
        skipped: 0,
      })
    })
  })
})

describe("planRestore — the refusal set that guards an irreversible replacement", () => {
  const base = { archive: "/staging/adoption-index-2026-08-16.sqlite", dbPath: "/store/adoption-index.sqlite" }

  it("refuses when the archive is absent, instead of creating one by opening it", () => {
    // Symmetric with `refuseToArchive`: `openBetterSqlite3` CREATES a missing file. Without this
    // check the bin would open the *archive* path, get an empty database, verify it (an empty
    // archive is legitimately valid — a new host's first backup), and copy 0 rows over a live store.
    const refusal = planRestore({ ...base, archivePresent: false, dbPresent: true, force: true })
    expect(refusal).not.toBeNull()
    expect(refusal).toContain(base.archive)
  })

  it("refuses an existing store WITHOUT --force — the asymmetry that makes this different from writeArchive", () => {
    // `writeArchive` deletes a same-day archive without asking because the store reproduces it.
    // Nothing reproduces a store from an archive that has been overwritten by one, so the default
    // here is refusal. Consent is a flag, not a shrug.
    const refusal = planRestore({ ...base, archivePresent: true, dbPresent: true, force: false })
    expect(refusal).not.toBeNull()
    expect(refusal).toContain(base.dbPath)
    // The literal, not the bin's export: this suite asserts the message an operator READS. The
    // separate `parseRestoreArgs` test pins the export to this same literal, which is what proves
    // the advice and the parser agree.
    expect(refusal).toContain("--force")
  })

  it("permits an existing store WITH --force", () => {
    expect(planRestore({ ...base, archivePresent: true, dbPresent: true, force: true })).toBeNull()
  })

  it("permits a first restore onto a host with no store, force or not", () => {
    // Disaster recovery onto a fresh host is the case this tool exists for. Requiring `--force`
    // there would gate the primary path behind a flag whose stated purpose is overwrite consent,
    // with nothing to overwrite.
    expect(planRestore({ ...base, archivePresent: true, dbPresent: false, force: false })).toBeNull()
    expect(planRestore({ ...base, archivePresent: true, dbPresent: false, force: true })).toBeNull()
  })

  it("refuses when the archive IS the store, however the two paths are spelled", () => {
    // `copyFileSync(x, x)` truncates on some platforms, and the sidecar removal that follows would
    // then delete the WAL of the only remaining copy. Compared after `resolve`, so a relative or
    // `.`-laden spelling of the same file cannot slip past a string comparison.
    expect(
      planRestore({ archive: base.dbPath, dbPath: base.dbPath, archivePresent: true, dbPresent: true, force: true }),
    ).toContain("same file")
    expect(
      planRestore({
        archive: "/store/./adoption-index.sqlite",
        dbPath: "/store/adoption-index.sqlite",
        archivePresent: true,
        dbPresent: true,
        force: true,
      }),
    ).toContain("same file")
  })

  it("checks absence BEFORE identity, so a bare typo is not reported as an aliasing bug", () => {
    // Ordering is the assertion. Both conditions hold here; the message an operator gets must name
    // the one they can act on.
    const refusal = planRestore({
      archive: base.dbPath,
      dbPath: base.dbPath,
      archivePresent: false,
      dbPresent: true,
      force: true,
    })
    expect(refusal).toContain("no archive at")
    expect(refusal).not.toContain("same file")
  })
})

describe("restoreArchive — real SQLite, and the sidecar removal that has no failure signal", () => {
  const withDirs = async (fn: (ctx: { src: string; dst: string; srcDb: string; dstDb: string }) => Promise<void>) => {
    const src = mkdtempSync(join(tmpdir(), "restore-src-"))
    const dst = mkdtempSync(join(tmpdir(), "restore-dst-"))
    try {
      const srcDb = resolveIndexPaths(src).db
      const dstDb = resolveIndexPaths(dst).db
      mkdirSync(join(src, ".var", "calllint-adoption-index", "db"), { recursive: true })
      mkdirSync(join(dst, ".var", "calllint-adoption-index", "db"), { recursive: true })
      await fn({ src, dst, srcDb, dstDb })
    } finally {
      rmSync(src, { recursive: true, force: true })
      rmSync(dst, { recursive: true, force: true })
    }
  }

  const SCHEMA = UNREBUILDABLE_TABLES.map(
    (t) => `CREATE TABLE ${t} (id TEXT PRIMARY KEY, first_seen_at TEXT NOT NULL)`,
  ).join(";")

  it("puts the archive's rows back and reports them through the same verifyArchive the backup runs", async () => {
    await withDirs(async ({ src, srcDb, dstDb }) => {
      const db = await openBetterSqlite3(srcDb)
      db.exec(SCHEMA)
      db.prepare("INSERT INTO source_records VALUES (?, ?)").run("KEEP-ME", "2026-01-01T00:00:00Z")
      const archive = archivePath(src, "2026-08-16T03:30:00Z")
      ensureStagingRoot(src)
      writeArchive({ db, target: archive })
      db.close()

      restoreArchive({ archive, dbPath: dstDb })

      const restored = await openBetterSqlite3(dstDb)
      try {
        expect(verifyArchive({ db: restored }).rows.source_records).toBe(1)
        expect(restored.prepare("SELECT id FROM source_records").all()).toEqual([{ id: "KEEP-ME" }])
      } finally {
        restored.close()
      }
    })
  })

  it("creates the db directory, so a restore onto a bare host is not a two-step procedure", async () => {
    // First-restore-after-total-loss is the primary path: nothing under `.var/` exists yet. An
    // implementation that assumed the directory would fail here with ENOENT at the worst moment.
    const src = mkdtempSync(join(tmpdir(), "restore-bare-src-"))
    const dst = mkdtempSync(join(tmpdir(), "restore-bare-dst-"))
    try {
      const srcDb = resolveIndexPaths(src).db
      mkdirSync(join(src, ".var", "calllint-adoption-index", "db"), { recursive: true })
      const db = await openBetterSqlite3(srcDb)
      db.exec(SCHEMA)
      const archive = archivePath(src, "2026-08-16T03:30:00Z")
      ensureStagingRoot(src)
      writeArchive({ db, target: archive })
      db.close()

      const dstDb = resolveIndexPaths(dst).db
      expect(existsSync(join(dst, ".var"))).toBe(false)
      restoreArchive({ archive, dbPath: dstDb })
      expect(existsSync(dstDb)).toBe(true)
    } finally {
      rmSync(src, { recursive: true, force: true })
      rmSync(dst, { recursive: true, force: true })
    }
  })

  /**
   * THE MEASUREMENT THIS WHOLE MODULE RESTS ON, run 2026-08-16 rather than inherited from the README.
   *
   * The README claimed SQLite "may reject or silently mix" a stale `-wal`. Measured, it does neither:
   * the restored database opens, reports `integrity_check` **ok**, and serves the OLD generation's
   * rows — the archive's own row is simply absent. This test constructs the case so the two
   * generations DISAGREE (the old one deleted the row the archive holds), because a probe where both
   * hold the same rows cannot tell "the sidecar won" from "the copy worked".
   *
   * The stale-sidecar branch is asserted DIRECTLY, not just via the fixed path: without it, deleting
   * the removal loop from `restoreArchive` would leave this file green.
   */
  it("a stale -wal serves the OLD generation and reports integrity_check ok — no failure signal at all", async () => {
    await withDirs(async ({ src, srcDb, dst, dstDb }) => {
      // Generation the archive captures: holds KEEP-ME.
      const gen1 = await openBetterSqlite3(srcDb)
      gen1.exec(SCHEMA)
      gen1.prepare("INSERT INTO source_records VALUES (?, ?)").run("KEEP-ME", "2026-01-01T00:00:00Z")
      const archive = archivePath(src, "2026-08-16T03:30:00Z")
      ensureStagingRoot(src)
      writeArchive({ db: gen1, target: archive })
      gen1.close()

      // Generation the operator is discarding: KEEP-ME deleted, LATER added. Its sidecars are
      // captured while the handle is open, which is what they look like beside a live store.
      const gen2 = await openBetterSqlite3(srcDb)
      gen2.prepare("DELETE FROM source_records WHERE id = ?").run("KEEP-ME")
      gen2.prepare("INSERT INTO source_records VALUES (?, ?)").run("LATER", "2026-02-02T00:00:00Z")
      const sidecars = SQLITE_SIDECAR_SUFFIXES.map((s) => ({ suffix: s, path: `${srcDb}${s}` }))
        .filter((s) => existsSync(s.path))
        .map((s) => ({ suffix: s.suffix, bytes: readFileSync(s.path) }))
      gen2.close()
      // Non-vacuity: if WAL mode were off, there would be no sidecar to go stale and this test
      // would silently assert nothing.
      expect(sidecars.map((s) => s.suffix)).toEqual([...SQLITE_SIDECAR_SUFFIXES])

      // THE WRONG RESTORE — a byte copy with the sidecars left in place, i.e. the README's step
      // omitted. Every check an operator would think to run says the store is healthy.
      copyFileSync(archive, dstDb)
      for (const s of sidecars) writeFileSync(`${dstDb}${s.suffix}`, s.bytes)
      const wrong = await openBetterSqlite3(dstDb)
      try {
        expect(wrong.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }])
        expect(verifyArchive({ db: wrong }).total).toBe(1)
        // Serves the generation that was supposed to be discarded, and NOT the archive's row.
        expect(wrong.prepare("SELECT id FROM source_records").all()).toEqual([{ id: "LATER" }])
      } finally {
        wrong.close()
      }

      // THE RESTORE THIS MODULE PERFORMS — same inputs, sidecars removed. Rebuilt from scratch so
      // the only difference between the two outcomes is the removal itself.
      rmSync(join(dst, ".var"), { recursive: true, force: true })
      mkdirSync(join(dst, ".var", "calllint-adoption-index", "db"), { recursive: true })
      copyFileSync(archive, dstDb)
      for (const s of sidecars) writeFileSync(`${dstDb}${s.suffix}`, s.bytes)
      const removed = restoreArchive({ archive, dbPath: dstDb })
      expect(removed).toEqual(SQLITE_SIDECAR_SUFFIXES.map((s) => `${dstDb}${s}`))

      const right = await openBetterSqlite3(dstDb)
      try {
        expect(right.prepare("SELECT id FROM source_records").all()).toEqual([{ id: "KEEP-ME" }])
      } finally {
        right.close()
      }
    })
  })

  it("reports zero removals when the replaced store was checkpointed, rather than claiming work it did not do", async () => {
    // "0 removed" and "2 removed" are different stories about the store that was replaced, and the
    // recovery log has to be able to tell them apart.
    await withDirs(async ({ src, srcDb, dstDb }) => {
      const db = await openBetterSqlite3(srcDb)
      db.exec(SCHEMA)
      const archive = archivePath(src, "2026-08-16T03:30:00Z")
      ensureStagingRoot(src)
      writeArchive({ db, target: archive })
      db.close()

      expect(restoreArchive({ archive, dbPath: dstDb })).toEqual([])
    })
  })

  it("removes only the enumerated sidecars, never an archive staged beside the store", async () => {
    // The reason `SQLITE_SIDECAR_SUFFIXES` is a list and not a `…sqlite-*` glob. A glob would also
    // match `adoption-index.sqlite-backup-2026-08-16`, and a restore that deletes the operator's
    // only remaining copy is worse than the failure it is preventing.
    await withDirs(async ({ src, srcDb, dst, dstDb }) => {
      const db = await openBetterSqlite3(srcDb)
      db.exec(SCHEMA)
      const archive = archivePath(src, "2026-08-16T03:30:00Z")
      ensureStagingRoot(src)
      writeArchive({ db, target: archive })
      db.close()

      const bystander = `${dstDb}-backup-2026-08-16`
      writeFileSync(bystander, "an operator's only other copy")
      const sibling = join(dst, ".var", "calllint-adoption-index", "db", "adoption-index-2026-08-15.sqlite")
      writeFileSync(sibling, "yesterday's archive")

      restoreArchive({ archive, dbPath: dstDb })

      expect(existsSync(bystander)).toBe(true)
      expect(readFileSync(bystander, "utf8")).toBe("an operator's only other copy")
      expect(existsSync(sibling)).toBe(true)
    })
  })
})

describe("parseRestoreArgs — the argv split, pure so its refusal branch is reachable", () => {
  it("returns a null archive when none was given, rather than treating the flag as a path", async () => {
    // Control #112: a bin that read `process.argv[2]` inline would fence this branch behind
    // `invokedAsScript`, where no test can reach it — and `--force` alone would then be resolved as
    // a relative filename.
    const { mod } = await loadRestoreBinOnce()
    expect(mod.parseRestoreArgs([])).toEqual({ archive: null, force: false })
    expect(mod.parseRestoreArgs([mod.FORCE_FLAG])).toEqual({ archive: null, force: true })
  })

  it("accepts the flag on either side of the archive", async () => {
    const { mod } = await loadRestoreBinOnce()
    expect(mod.parseRestoreArgs(["a.sqlite", mod.FORCE_FLAG])).toEqual({ archive: "a.sqlite", force: true })
    expect(mod.parseRestoreArgs([mod.FORCE_FLAG, "a.sqlite"])).toEqual({ archive: "a.sqlite", force: true })
    expect(mod.parseRestoreArgs(["a.sqlite"])).toEqual({ archive: "a.sqlite", force: false })
  })

  it("spells the flag exactly once, so the bin and the refusal message cannot disagree", async () => {
    // `planRestore`'s message tells the operator to re-run with this flag. If the two spellings
    // drifted, the advice would name a flag the parser ignores.
    const { mod } = await loadRestoreBinOnce()
    expect(mod.FORCE_FLAG).toBe("--force")
    expect(
      planRestore({ archive: "/a.sqlite", dbPath: "/b.sqlite", archivePresent: true, dbPresent: true, force: false }),
    ).toContain(mod.FORCE_FLAG)
  })
})

describe("restoreAdoptionIndex — the invoked-as-script guard", () => {
  it("importing the bin does NOT replace the store, even with a valid archive and --force in argv", async () => {
    // The highest-stakes instance of this guard in the package: `main()` REPLACES the store database.
    // The trap is set up in `loadRestoreBinOnce` and every condition for a successful restore is
    // satisfied at import time — a real archive that passes `verifyArchive`, `--force` present,
    // `ADOPTION_INDEX_CWD` pointing at a store that exists — so the ONLY thing standing between the
    // import and destroyed bytes is `invokedAsScript`. See that helper for why an earlier version of
    // this test passed with the guard bypassed.
    const { storeBytes, archivePresent } = await loadRestoreBinOnce()
    expect(storeBytes).toBe(TRAP_STORE_BYTES)
    // Non-vacuity: the archive must still have been there for the trap to have been armed at all. An
    // absent one would mean the import refused on `planRestore` and this test proved nothing.
    expect(archivePresent).toBe(true)
  })

  it("the trap's archive would really have restored — the guard test is not passing on a refusal", async () => {
    // Proves the trap is live rather than merely unsprung. The same archive shape and the same
    // `--force` argv, run through the library path the bin uses, DOES replace a store. So the bytes
    // surviving above is attributable to the guard and to nothing else.
    const source = mkdtempSync(join(tmpdir(), "restore-trap-live-src-"))
    const victim = mkdtempSync(join(tmpdir(), "restore-trap-live-"))
    try {
      const sourceDb = resolveIndexPaths(source).db
      mkdirSync(join(source, ".var", "calllint-adoption-index", "db"), { recursive: true })
      const db = await openBetterSqlite3(sourceDb)
      db.exec(UNREBUILDABLE_TABLES.map((t) => `CREATE TABLE ${t} (id TEXT PRIMARY KEY)`).join(";"))
      db.prepare("INSERT INTO source_records VALUES (?)").run("TRAP-A")
      db.prepare("INSERT INTO canonical_subjects VALUES (?)").run("TRAP-B")
      const archive = archivePath(source, "2026-08-16T03:30:00Z")
      ensureStagingRoot(source)
      writeArchive({ db, target: archive })
      db.close()

      const victimDb = resolveIndexPaths(victim).db
      mkdirSync(join(victim, ".var", "calllint-adoption-index", "db"), { recursive: true })
      writeFileSync(victimDb, TRAP_STORE_BYTES)

      const { mod } = await loadRestoreBinOnce()
      const parsed = mod.parseRestoreArgs([archive, "--force"])
      expect(parsed.force).toBe(true)
      expect(
        planRestore({
          archive,
          dbPath: victimDb,
          archivePresent: true,
          dbPresent: true,
          force: parsed.force,
        }),
      ).toBeNull()

      const opened = await openBetterSqlite3(archive)
      try {
        expect(verifyArchive({ db: opened }).total).toBe(TRAP_ARCHIVE_ROWS)
      } finally {
        opened.close()
      }

      restoreArchive({ archive, dbPath: victimDb })
      expect(readFileSync(victimDb, "utf8")).not.toBe(TRAP_STORE_BYTES)
    } finally {
      rmSync(source, { recursive: true, force: true })
      rmSync(victim, { recursive: true, force: true })
    }
  })
})

describe("backupAdoptionIndex — the invoked-as-script guard", () => {
  it("importing the bin neither archives nor sweeps, with a real store in reach", async () => {
    // `main()` opens a database, writes a file, and in `--prune-staging` mode DELETES files. An
    // unguarded module body would do all of that to whatever `ADOPTION_INDEX_CWD` pointed at the
    // moment anything imported this file. Vitest's entry point is not `backupAdoptionIndex.ts`, so
    // the guard must hold — and a real archive is staged so the sweep has something to take.
    const cwd = mkdtempSync(join(tmpdir(), "backup-guard-"))
    const stagingRoot = ensureStagingRoot(cwd)
    const staged = join(stagingRoot, `adoption-index-2000-01-01${ARCHIVE_SUFFIX}`)
    writeFileSync(staged, "archive")

    const previous = process.env.ADOPTION_INDEX_CWD
    process.env.ADOPTION_INDEX_CWD = cwd
    try {
      await import("../src/backupAdoptionIndex.js")
      // Named individually rather than through `.every()`: a collapsed assertion would print
      // "expected false to be true" and leave which half leaked unstated.
      expect(existsSync(staged)).toBe(true)
      expect(readdirSync(stagingRoot)).toEqual([`adoption-index-2000-01-01${ARCHIVE_SUFFIX}`])
    } finally {
      if (previous === undefined) delete process.env.ADOPTION_INDEX_CWD
      else process.env.ADOPTION_INDEX_CWD = previous
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
