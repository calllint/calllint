/**
 * restore:adoption-index — the entry point that puts an archive back, closing the gap
 * `deploy/adoption-index/README.md` recorded as "there is no restore entry point" (that section is
 * now the "Restoring" procedure, which this bin is the subject of).
 *
 * WHY THIS EXISTS AS CODE RATHER THAN AS THE RUNBOOK IT REPLACES. The README carried the procedure
 * as four manual commands and named the sidecar removal as "the step a first-time restorer is most
 * likely to miss, and the one whose omission produces the least legible failure". Measured
 * 2026-08-16, that omission is worse than the README claimed: it produces NO failure. A stale
 * uncheckpointed `-wal` beside a restored database opens cleanly, reports `integrity_check` **ok**,
 * and serves the OLD generation's rows — the restore silently accomplishes nothing while every
 * check an operator would think to run says the store is healthy. A step with no failure signal
 * cannot be delegated to human memory, so it is a line of code here instead.
 *
 * THE ORDER IS LOAD-BEARING: VERIFY, THEN REPLACE. In a real recovery the archive is the only copy
 * left, and `restoreArchive` overwrites the store. Verifying afterwards would mean discovering a bad
 * archive at the moment both generations are gone. So the archive is opened and checked with the
 * SAME `verifyArchive` the backup path runs before uploading — one definition of "this file is a
 * restorable database", used on both ends of the round trip.
 *
 * WHAT THIS BIN DELIBERATELY DOES NOT DO:
 *   - it does not download. Fetching from object storage needs the credential the backup unit reads
 *     from a root-only file, and a restore is a human-initiated recovery, not a timer's job. The
 *     operator brings the file; this replaces the store with it.
 *   - it does not stop the systemd timers. Stopping units needs root and this runs as `calllint`.
 *     The README's procedure still owns that step, and this bin's own refusal is what protects an
 *     operator who forgets: a running ingest holds the store, and `--force` is required to overwrite
 *     one that exists at all.
 *   - it never deletes the archive. The archive outlives the restore, by design.
 *
 * Usage:  pnpm restore:adoption-index <archive.sqlite>            verify + refuse if a store exists
 *         pnpm restore:adoption-index <archive.sqlite> --force    verify + replace the store
 *   env:  ADOPTION_INDEX_CWD  (directory holding `.var/`, default `process.cwd()`)
 */

import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { openBetterSqlite3, resolveIndexPaths } from "@calllint/adoption-index"
import { planRestore, restoreArchive, verifyArchive } from "./backupStore.js"

/** The overwrite consent flag. Spelled once, here, so the bin and its tests cannot disagree. */
export const FORCE_FLAG = "--force"

function resolveCwd(env: Record<string, string | undefined>): string {
  return (env.ADOPTION_INDEX_CWD ?? "").trim() || process.cwd()
}

/**
 * Split argv into the archive path and the force flag.
 *
 * Exported and pure so the "no archive given" branch is testable. A bin that read `process.argv[2]`
 * inline would fence that branch behind `invokedAsScript`, which is the shape control #112 exists to
 * prevent.
 */
export function parseRestoreArgs(argv: readonly string[]): { archive: string | null; force: boolean } {
  const force = argv.includes(FORCE_FLAG)
  const positional = argv.filter((a) => a !== FORCE_FLAG)
  return { archive: positional[0] ?? null, force }
}

async function main(): Promise<void> {
  const { archive, force } = parseRestoreArgs(process.argv.slice(2))
  if (archive === null) {
    throw new Error(
      `restore: no archive given. Usage: pnpm restore:adoption-index <archive.sqlite> [${FORCE_FLAG}]`,
    )
  }

  const cwd = resolveCwd(process.env)
  const paths = resolveIndexPaths(cwd)
  const archiveAbs = resolve(cwd, archive)

  // Existence is checked BEFORE any open, for the same reason the archive path checks it:
  // `openBetterSqlite3` CREATES a missing file, so a check made afterwards would find a database it
  // had just created and "restore" an empty store over a real one.
  const refusal = planRestore({
    archive: archiveAbs,
    dbPath: paths.db,
    archivePresent: existsSync(archiveAbs),
    dbPresent: existsSync(paths.db),
    force,
  })
  if (refusal !== null) throw new Error(refusal)

  // VERIFY FIRST — see the module docblock. The same check the backup runs before uploading, so a
  // file that would not survive a restore is rejected on both ends of the round trip.
  const check = await openBetterSqlite3(archiveAbs)
  let verified
  try {
    verified = verifyArchive({ db: check })
  } finally {
    check.close()
  }

  const removed = restoreArchive({ archive: archiveAbs, dbPath: paths.db })

  console.log(`restore:adoption-index — restored ${paths.db}`)
  console.log(`  from    ${archiveAbs}`)
  console.log(`  verified integrity_check ok — ${verified.total} unrebuildable row(s) readable`)
  for (const [table, n] of Object.entries(verified.rows)) console.log(`    ${table} ${n}`)
  // Reported by name and count, because "0 removed" and "2 removed" are different stories about the
  // store that was replaced, and an operator reading a recovery log needs to know which happened.
  console.log(`  removed ${removed.length} stale WAL sidecar(s)${removed.length > 0 ? `: ${removed.join(", ")}` : ""}`)
  if (removed.length === 0) {
    console.log(`  (none present — the replaced store was checkpointed, or there was no store)`)
  }
}

// Run ONLY when executed as a script, never on import — the same guard `backupAdoptionIndex.ts:122`
// carries, and here it matters more than anywhere else in this package: `main()` OVERWRITES the
// store database. An unguarded module body would do that to a developer's real store the moment
// anything imported this file.
const invokedAsScript =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (invokedAsScript) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
