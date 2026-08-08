/**
 * backup:adoption-index — the daily archive ADR 0061 §8.4 asked for, closing §8.5's named gap.
 *
 * §8.4 required retention and backup TOGETHER. §8.5 shipped retention alone and said so, because
 * the three decisions a backup needs — destination, window, credential — had no measured basis at
 * the time. §8.6 records them; this bin is their executable half. The library it calls is
 * `backupStore.ts`, whose docblock carries the two content decisions (database only, `VACUUM INTO`
 * rather than a file copy).
 *
 * WHY THIS IS ITS OWN UNIT AND NOT A FOURTH `ExecStart` on the worker. `Type=oneshot` runs
 * `ExecStart` lines sequentially and ABORTS the rest when one fails. A backup appended to the
 * worker would therefore be skipped exactly when the ingest failed — the moment a backup matters
 * most. The converse is as bad: a credential problem here would fail the whole ingest unit and
 * poison `prune:cas … failed 0`, which `deploy/README.md:58` already documents as the worker's
 * success criterion. The README's own precedent settles it: committing from the host "is a separate
 * decision with its own credentials question — not something to bolt onto `ExecStart`" (:100-102).
 *
 * WHAT THIS BIN DOES NOT DO: it does not upload. The archive is staged locally and the upload is
 * `ExecStartPost=`'s job in the unit, so a credential failure is attributable to a distinct step
 * rather than folded into "backup failed". It also never deletes anything remote — that is
 * irreversible and belongs to an object-storage lifecycle rule, recorded by key name and day count
 * in `deploy/adoption-index/README.md`.
 *
 * THE STAGING SWEEP IS A SEPARATE ENTRY POINT (`--prune-staging`), invoked from `ExecStopPost=` so
 * it runs whether the archive and the upload succeeded or not. A staged SQLite copy left behind is
 * one full copy of the store per day on the host — the largest single growth surface here, and
 * precisely what the cleanup requirement exists to stop.
 *
 * Usage:  pnpm backup:adoption-index                  archive the store into the staging dir
 *         pnpm backup:adoption-index --prune-staging  delete every staged archive
 *   env:  ADOPTION_INDEX_CWD  (directory holding `.var/`, default `process.cwd()`)
 */

import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { openBetterSqlite3, resolveIndexPaths } from "@calllint/adoption-index"
import {
  archivePath,
  backupStagingRoot,
  ensureStagingRoot,
  pruneBackupStaging,
  refuseToArchive,
  writeArchive,
} from "./backupStore.js"

/** The sweep's flag. A separate mode rather than a separate bin: one unit, one module to install. */
export const PRUNE_STAGING_FLAG = "--prune-staging"

function resolveCwd(env: Record<string, string | undefined>): string {
  return (env.ADOPTION_INDEX_CWD ?? "").trim() || process.cwd()
}

async function archive(cwd: string, now: string): Promise<void> {
  const paths = resolveIndexPaths(cwd)

  // Checked BEFORE the open, deliberately: `openBetterSqlite3` creates the file when it is absent,
  // so a check made afterwards would find a database it had just created and archive that.
  const refusal = refuseToArchive({ dbPath: paths.db, dbPresent: existsSync(paths.db) })
  if (refusal !== null) throw new Error(refusal)

  const stagingRoot = ensureStagingRoot(cwd)
  const target = archivePath(cwd, now)

  const db = await openBetterSqlite3(paths.db)
  try {
    writeArchive({ db, target })
  } finally {
    // Closed in `finally` because `VACUUM INTO` holds a read transaction: a leaked handle on the
    // worker would keep the WAL from checkpointing until the process exited.
    db.close()
  }

  console.log(`backup:adoption-index — archived ${paths.db}`)
  console.log(`  staging ${stagingRoot}`)
  console.log(`  archive ${target}`)
}

function prune(cwd: string): void {
  const stagingRoot = backupStagingRoot(cwd)
  const result = pruneBackupStaging({ stagingRoot })

  console.log(`backup:adoption-index — staging sweep ${stagingRoot}`)
  console.log(`  inspected ${result.inspected}`)
  console.log(`  deleted   ${result.deleted}`)
  console.log(`  failed    ${result.failed}`)
  console.log(`  skipped   ${result.skipped}`)

  // Same failure semantics as `prune:cas`: a delete that failed is a policy that did not apply, and
  // it must reach the exit code so systemd records a failure instead of a quiet log line.
  if (result.failed > 0) process.exitCode = 1
}

async function main(): Promise<void> {
  const cwd = resolveCwd(process.env)
  if (process.argv.slice(2).includes(PRUNE_STAGING_FLAG)) {
    prune(cwd)
    return
  }
  await archive(cwd, new Date().toISOString())
}

// Run ONLY when executed as a script, never on import — the same guard `pruneCas.ts:94` and
// `projectAdoptionIndex.ts:230` carry, for the same measured reason: `main()` opens a database under
// `.var/`, writes a file, and in `--prune-staging` mode DELETES files. An unguarded module body
// would do all of that to a developer's real store the moment anything imported this file.
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
