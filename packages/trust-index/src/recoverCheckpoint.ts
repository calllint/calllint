/**
 * recover-checkpoint — mark a crash-wedged `RUNNING` checkpoint `FAILED`, so the next run may start.
 *
 * THE REMEDY `assertUsableCheckpoint` NEVER NAMED. Its refusal is correct and load-bearing:
 * `beginRun` writes `RUNNING` before any fetch, so a process killed mid-read leaves `RUNNING` on
 * disk, and resuming from it "would skip records that run fetched but may not have persisted"
 * (`domain/checkpoint.ts:53`). But `RUNNING` is not terminal and NOTHING cleared it — no script, no
 * doc, no ADR — so a single hard kill wedged a store permanently. Measured 2026-09-01: this
 * machine's store had been wedged since a kill weeks earlier, and every local `pnpm
 * ingest:trust-index` since had exited 1 at the same line. A guard whose remedy is not runnable is
 * satisfied only by luck (ADR 0087's phrasing); this is that remedy, made runnable.
 *
 * The asymmetry is why it went unnoticed: a GitHub Actions runner starts every scheduled ingest with
 * an empty gitignored `.var/`, so a fresh checkpoint is `IDLE` — resumable, and never `RUNNING`. Only
 * a persistent store (this machine, the R-9 worker) can inherit a crash. Same asymmetry `pruneCas.ts`
 * documents for CAS growth, and the same conclusion: the local/worker path needs an operator step CI
 * does not.
 *
 * IT DOES EXACTLY ONE TRANSITION, `RUNNING` → `FAILED`, via the store's own `failRun`. Deliberately
 * NOT a delete, and deliberately not a reset to `IDLE`:
 *
 *   - `FAILED` is terminal, which is all `assertUsableCheckpoint` requires, and it is precisely what
 *     `syncSource`'s catch would have written had the process lived (`syncSource.ts:167`). So this
 *     lands the store in a state the normal code path already produces, rather than a new one.
 *   - `cursor` and `updatedSince` are left ALONE. `failRun`'s contract is "the next run retries from
 *     `cursor`", and the watermark only ever moves forward — clearing either here would silently
 *     convert the next incremental into a full read, or worse, advance past records that were never
 *     persisted. The wedge is a status problem; widening the fix to the watermark would re-introduce
 *     the §9.4 gap the refusal exists to prevent.
 *   - A checkpoint that is already terminal is left untouched and reported, exit 0. This must be
 *     re-runnable without inventing a state change.
 *
 * IT REFUSES ANY STATUS BUT `RUNNING`. `IDLE` is not terminal either, but it means "never ran" and is
 * already resumable, so forcing it to `FAILED` would fabricate a failure that never happened.
 *
 * Usage:  pnpm recover-checkpoint:trust-index
 *   env:  ADOPTION_INDEX_CWD  (directory holding `.var/`, default `process.cwd()`)
 */

import { mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  AdoptionIndexStore,
  MIGRATIONS_DIRNAME,
  OFFICIAL_REGISTRY_SOURCE_ID,
  isTerminalCheckpointStatus,
  openBetterSqlite3,
  resolveIndexPaths,
} from "@calllint/adoption-index"

function migrationsDir(): string {
  return resolve(fileURLToPath(import.meta.url), "..", "..", "..", "adoption-index", MIGRATIONS_DIRNAME)
}

async function main(): Promise<void> {
  const now = new Date().toISOString()
  const cwd = (process.env.ADOPTION_INDEX_CWD ?? "").trim() || process.cwd()
  const paths = resolveIndexPaths(cwd)
  for (const dir of paths.dirs) mkdirSync(dir, { recursive: true })

  const db = await openBetterSqlite3(paths.db)
  const store = AdoptionIndexStore.open({ cwd, migrationsDir: migrationsDir(), db, now })
  try {
    const sourceId = OFFICIAL_REGISTRY_SOURCE_ID
    const before = store.readCheckpoint(sourceId)
    console.log(`recover-checkpoint — ${sourceId}`)
    console.log(`  root   ${paths.root}`)
    console.log(`  status ${before.status}`)

    if (isTerminalCheckpointStatus(before.status)) {
      console.log(`  already terminal — nothing to recover, the next run may start`)
      return
    }
    if (before.status !== "RUNNING") {
      // IDLE: never ran, already resumable. Forcing FAILED would invent a failure.
      console.log(`  not RUNNING and not terminal — left untouched, the next run may start`)
      return
    }

    store.failRun(sourceId, "OPERATOR_RECOVERED_CRASHED_RUN")
    const after = store.readCheckpoint(sourceId)
    console.log(`  RUNNING -> ${after.status} (${after.lastErrorCode})`)
    console.log(`  cursor and updatedSince left untouched: ${JSON.stringify(after.updatedSince)}`)

    if (!isTerminalCheckpointStatus(after.status)) {
      throw new Error(`recover-checkpoint: status is still ${after.status} — the store did not recover`)
    }
    console.log(`  the next run may start`)
  } finally {
    store.close()
  }
}

main().catch((err: unknown) => {
  console.error(String(err))
  process.exit(1)
})
