/**
 * Retention enforcement (new18 §21).
 *
 *   daily aggregate counts   may remain
 *   installation hashes      rolling max 90 days
 *   ingested batch IDs       rolling max 30 days
 *
 * Runs on a cron trigger. This is the piece the withdrawn Pages implementation
 * never had: its schema filtered *reads* to 90/30 days through two views while
 * the rows themselves accumulated forever, so the data actually retained grew
 * without bound and the views made it look bounded.
 *
 * `usage_daily_counts` is deliberately not pruned — it holds no installation
 * hash and no per-machine dimension, so an old row is an aggregate count and
 * nothing more. The cumulative figures in the report depend on it.
 */
import type { Env } from "./index.js"

export const INSTALLATION_HASH_RETENTION_DAYS = 90
export const BATCH_ID_RETENTION_DAYS = 30

/** The cutoff day (inclusive) for a rolling window, computed in UTC. */
export function cutoffDay(now: Date, days: number): string {
  const cutoff = new Date(now.getTime() - days * 86_400_000)
  return cutoff.toISOString().slice(0, 10)
}

export interface RetentionOutcome {
  installationRowsDeleted: number
  batchRowsDeleted: number
}

/** Delete rows past their retention window. Idempotent. */
export async function enforceRetention(env: Env, now: Date): Promise<RetentionOutcome> {
  const installationCutoff = cutoffDay(now, INSTALLATION_HASH_RETENTION_DAYS)
  const batchCutoff = cutoffDay(now, BATCH_ID_RETENTION_DAYS)

  const results = await env.USAGE_DB.batch([
    env.USAGE_DB.prepare("DELETE FROM usage_daily_installations WHERE day < ?").bind(
      installationCutoff,
    ),
    env.USAGE_DB.prepare("DELETE FROM usage_ingested_batches WHERE received_day < ?").bind(
      batchCutoff,
    ),
  ])

  // Read positionally without assuming the array is populated — a short result
  // means the delete did not run, which is 0 rows, not a crash in the cron path.
  return {
    installationRowsDeleted: results[0]?.meta?.changes ?? 0,
    batchRowsDeleted: results[1]?.meta?.changes ?? 0,
  }
}
