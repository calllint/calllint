/**
 * CAS retention policy — prune old blobs to bound monotonic growth.
 *
 * ADR 0061 §8.4 named the gap: "CAS growth is therefore monotonic and unbounded … A retention
 * policy must ship with R-9's deployment." This module is that policy.
 *
 * §8.6 added a SECOND sweep for a second growth surface. Measured, not assumed: `cas/blobs` is
 * bounded by `pruneOldBlobs` below, and every table in the store is `ON CONFLICT`-keyed except
 * `compiler_runs`, which appends one sub-kB row per run (hundreds of kB a year — not a threat).
 * The unbounded surface nobody swept was `work/<hex>.part`. `cas.ts:85,88` removes the staging
 * file on both of its failure paths, but a SIGKILL between `writeFileSync(staging)` and the
 * `rename` — which is what `MemoryMax=1G` or `TimeoutStartSec=45min` delivers — leaves it behind,
 * and `pruneOldBlobs` never looks at `work/`. See `pruneStaleStaging`.
 */

import { rmSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { casBlobsRoot, casWorkRoot } from "@calllint/adoption-index"

export interface PruneOldBlobsInput {
  /**
   * The INDEX root (the directory that holds `cas/`), not the blob tree itself. The two-character
   * fan-out layout under it belongs to `paths.ts` alone (INV-R7), so this module never names it.
   */
  root: string
  retentionDays: number
  now: string
}

export interface PruneOldBlobsResult {
  inspected: number
  deleted: number
  failed: number
}

export interface PruneStaleStagingInput {
  /** The INDEX root (the directory that holds `work/`), not the staging tree itself. INV-R7. */
  root: string
  /** Hours, not days — a staging file lives for milliseconds. See `DEFAULT_STAGING_ORPHAN_HOURS`. */
  orphanHours: number
  now: string
}

export interface PruneStaleStagingResult {
  inspected: number
  deleted: number
  failed: number
  /**
   * Entries in `work/` that are not `*.part` files, left untouched.
   *
   * Reported rather than dropped: a non-zero `skipped` is how an operator learns something else
   * started writing into the staging directory, which is a fact this sweep must surface instead of
   * silently declining to act on it.
   */
  skipped: number
}

/** The default retention window, in days. ADR 0061 §8.4. */
export const DEFAULT_RETENTION_DAYS = 90

/**
 * The default staging-orphan window, in HOURS — deliberately not the blob window.
 *
 * A staging file is live for as long as it takes to write bytes and rename them, which is
 * milliseconds. Anything older than one ingest cycle is therefore an orphan with certainty, and
 * the cycle is daily (`OnCalendar=*-*-* 02:30:00`) with a `TimeoutStartSec=45min` ceiling. 48h is
 * two full cycles: long enough that a run in progress is never touched, short enough that an
 * orphan does not outlive the week.
 *
 * Reusing `DEFAULT_RETENTION_DAYS` here would leave every orphan on disk for three months, which
 * is the growth this sweep exists to stop.
 */
export const DEFAULT_STAGING_ORPHAN_HOURS = 48

/**
 * Parse the retention window from the environment, refusing anything that is not a positive integer.
 *
 * The regex is deliberately stricter than `parseInt`, which reads a prefix and discards the rest.
 * `parseInt` would accept `"45.9"` as 45, `"30d"` as 30, and `"-1"` as **-1** — a negative window
 * puts the cutoff in the future and deletes the entire CAS, including the blobs the run just wrote.
 * A typo must stop the sweep, not silently redefine it.
 */
export function resolveRetentionDays(env: Record<string, string | undefined>): number {
  const raw = (env.CAS_RETENTION_DAYS ?? "").trim()
  if (raw === "") return DEFAULT_RETENTION_DAYS
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(`CAS_RETENTION_DAYS must be a positive integer, received ${JSON.stringify(raw)}`)
  }
  const days = Number.parseInt(raw, 10)
  if (days <= 0) {
    throw new Error(`CAS_RETENTION_DAYS must be greater than zero, received ${JSON.stringify(raw)}`)
  }
  return days
}

/**
 * Parse the staging-orphan window from the environment, refusing anything but a positive integer.
 *
 * Same strictness as `resolveRetentionDays`, and for a sharper reason: this window is in HOURS, so
 * a value that silently coerced to 0 would delete the `.part` file a concurrent write is streaming
 * into right now. Zero is refused rather than treated as "sweep everything".
 */
export function resolveStagingOrphanHours(env: Record<string, string | undefined>): number {
  const raw = (env.CAS_STAGING_ORPHAN_HOURS ?? "").trim()
  if (raw === "") return DEFAULT_STAGING_ORPHAN_HOURS
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(`CAS_STAGING_ORPHAN_HOURS must be a positive integer, received ${JSON.stringify(raw)}`)
  }
  const hours = Number.parseInt(raw, 10)
  if (hours <= 0) {
    throw new Error(`CAS_STAGING_ORPHAN_HOURS must be greater than zero, received ${JSON.stringify(raw)}`)
  }
  return hours
}

/**
 * Delete abandoned `work/<hex>.part` staging files — the second growth surface of ADR 0061 §8.6.
 *
 * WHY THIS IS SEPARATE FROM `pruneOldBlobs` rather than a flag on it. Three differences, each of
 * which would be a bug if collapsed: the tree is FLAT where `cas/blobs` is a two-character fan-out;
 * the window is HOURS where retention is days (see `DEFAULT_STAGING_ORPHAN_HOURS`); and a `.part`
 * file is *garbage by definition* where a blob is content someone may still want. Sharing one
 * traversal would have to branch on all three.
 *
 * ONLY `*.part` IS TOUCHED. `work/` is the staging directory today and `casStagingPath` is its only
 * writer, but a future writer putting something durable there must not be swept by a sweep written
 * before it existed. The suffix filter is that guarantee, and non-matching entries are counted as
 * `skipped` so the log shows they were seen and left alone rather than silently ignored.
 *
 * A MISSING TREE IS AN ERROR, NOT AN EMPTY ONE — the same rule `pruneOldBlobs` follows. Step 1 of
 * the worker creates every index directory unconditionally (`refreshSnapshot.ts:278`), so an absent
 * `work/` means the root is wrong, and a mis-rooted sweep that reported `inspected 0` every night
 * is exactly the §8.5 decoy-root failure this must not reproduce.
 */
export function pruneStaleStaging(input: PruneStaleStagingInput): PruneStaleStagingResult {
  const { root, orphanHours, now } = input
  const workRoot = casWorkRoot(root)
  const cutoffMs = new Date(now).getTime() - orphanHours * 3600 * 1000

  let inspected = 0
  let deleted = 0
  let failed = 0
  let skipped = 0

  let entries: string[]
  try {
    entries = readdirSync(workRoot)
  } catch (err) {
    console.error(`Failed to read CAS staging directory ${workRoot}:`, err)
    throw err
  }

  for (const name of entries) {
    const entryPath = join(workRoot, name)
    if (!name.endsWith(".part")) {
      skipped++
      continue
    }
    try {
      const stats = statSync(entryPath)
      if (!stats.isFile()) {
        skipped++
        continue
      }
      inspected++
      if (stats.mtimeMs < cutoffMs) {
        try {
          rmSync(entryPath, { force: true })
          deleted++
        } catch (err) {
          console.error(`Failed to delete staging file ${entryPath}:`, err)
          failed++
        }
      }
    } catch (err) {
      console.error(`Failed to stat staging file ${entryPath}:`, err)
      failed++
    }
  }

  return { inspected, deleted, failed, skipped }
}

export function pruneOldBlobs(input: PruneOldBlobsInput): PruneOldBlobsResult {
  const { root, retentionDays, now } = input
  const blobsRoot = casBlobsRoot(root)
  const cutoffMs = new Date(now).getTime() - retentionDays * 86400 * 1000

  let inspected = 0
  let deleted = 0
  let failed = 0

  let fanoutDirs: string[]
  try {
    fanoutDirs = readdirSync(blobsRoot)
  } catch (err) {
    console.error(`Failed to read CAS blobs directory ${blobsRoot}:`, err)
    throw err
  }

  for (const fanout of fanoutDirs) {
    const fanoutPath = join(blobsRoot, fanout)
    let blobNames: string[]
    try {
      if (!statSync(fanoutPath).isDirectory()) continue
      blobNames = readdirSync(fanoutPath)
    } catch (err) {
      console.error(`Failed to read fan-out directory ${fanoutPath}:`, err)
      failed++
      continue
    }

    for (const name of blobNames) {
      const blobPath = join(fanoutPath, name)
      try {
        const stats = statSync(blobPath)
        if (!stats.isFile()) continue
        inspected++
        if (stats.mtimeMs < cutoffMs) {
          try {
            rmSync(blobPath, { force: true })
            deleted++
          } catch (err) {
            console.error(`Failed to delete ${blobPath}:`, err)
            failed++
          }
        }
      } catch (err) {
        console.error(`Failed to stat ${blobPath}:`, err)
        failed++
      }
    }
  }

  return { inspected, deleted, failed }
}
