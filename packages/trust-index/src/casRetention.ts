/**
 * CAS retention policy — prune old blobs to bound monotonic growth.
 *
 * ADR 0061 §8.4 named the gap: "CAS growth is therefore monotonic and unbounded … A retention
 * policy must ship with R-9's deployment." This module is that policy.
 */

import { rmSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { casBlobsRoot } from "@calllint/adoption-index"

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

/** The default retention window, in days. ADR 0061 §8.4. */
export const DEFAULT_RETENTION_DAYS = 90

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
