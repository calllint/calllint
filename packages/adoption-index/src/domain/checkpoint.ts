/**
 * SourceCheckpoint — the resumable position of one source's sync (§9.4, table
 * `source_checkpoints`).
 *
 * The rule that shapes this type: **never advance the checkpoint before all fetched
 * records are persisted** (§9.4, verbatim). A checkpoint written first and records
 * second loses every record in the gap on a crash, and loses them SILENTLY — the next
 * incremental run starts after the records it never stored. So the checkpoint carries
 * `status` explicitly, and `advanceCheckpoint` is callable only from inside the same
 * transaction that persisted the records (see storage/sqliteStore.ts).
 *
 * `status` is a lifecycle, and `FAILED` is terminal for the RUN, not for the source:
 * the next run reads the last durable cursor and retries from there. Every state here
 * is reachable and every run ends in one of the two terminal states, which is what
 * INV-R5 ("every source record reaches a terminal state; none is silently dropped")
 * requires at the run level.
 */

export type CheckpointStatus = "IDLE" | "RUNNING" | "COMPLETED" | "FAILED"

/** The terminal states of a sync run. A run left `RUNNING` is a crashed run. */
export const TERMINAL_CHECKPOINT_STATUSES: readonly CheckpointStatus[] = ["COMPLETED", "FAILED"] as const

export function isTerminalCheckpointStatus(status: CheckpointStatus): boolean {
  return TERMINAL_CHECKPOINT_STATUSES.includes(status)
}

export interface SourceCheckpoint {
  sourceId: string
  /** Opaque pagination cursor from the source. Never parsed or synthesized locally. */
  cursor: string | null
  /** ISO-8601 high-water mark for `updated_since` incremental sync. */
  updatedSince: string | null
  /** Digest of the projected snapshot this checkpoint produced, when it produced one. */
  snapshotDigest: string | null
  lastStartedAt: string | null
  lastCompletedAt: string | null
  status: CheckpointStatus
  lastErrorCode: string | null
}

/**
 * Validate a checkpoint before a source adapter resumes from it (§9.3
 * `validateCheckpoint`). Fails CLOSED: a checkpoint that cannot be understood must
 * force a full sync rather than silently resume from a position it invented.
 *
 * Throws rather than returning a boolean because every caller's only correct response
 * to an unreadable checkpoint is to stop using it, and a returned `false` is ignorable.
 */
export function assertUsableCheckpoint(cp: SourceCheckpoint): void {
  if (cp.sourceId.length === 0) throw new Error("checkpoint has an empty sourceId")
  if (cp.status === "RUNNING") {
    // THE REMEDY IS NAMED, because for months there was none to name. `RUNNING` is not terminal and
    // nothing cleared it, so one hard kill wedged a persistent store permanently: every later run
    // died here, and the message said only what was wrong. Measured 2026-09-01 on a store wedged
    // weeks earlier. A refusal that states no way out is a refusal an operator cannot act on — the
    // same standard ADR 0087 set for `sync:mcp-bundle` ("the remedy for a guard has to be
    // runnable"). `pnpm recover-checkpoint:trust-index` performs the one transition this state
    // needs, `RUNNING` → `FAILED`, and touches neither cursor nor watermark.
    throw new Error(
      `checkpoint for ${cp.sourceId} is RUNNING — a previous run did not reach a terminal state; ` +
        "resume would skip records that run fetched but may not have persisted. " +
        "Remedy: `pnpm recover-checkpoint:trust-index` (marks it FAILED, which is terminal, " +
        "leaving cursor and updatedSince untouched so the next run re-reads its window)",
    )
  }
  for (const [field, value] of [
    ["updatedSince", cp.updatedSince],
    ["lastStartedAt", cp.lastStartedAt],
    ["lastCompletedAt", cp.lastCompletedAt],
  ] as const) {
    if (value !== null && Number.isNaN(Date.parse(value))) {
      throw new Error(`checkpoint for ${cp.sourceId} has an unparseable ${field}: ${JSON.stringify(value)}`)
    }
  }
}

export function emptyCheckpoint(sourceId: string): SourceCheckpoint {
  return {
    sourceId,
    cursor: null,
    updatedSince: null,
    snapshotDigest: null,
    lastStartedAt: null,
    lastCompletedAt: null,
    status: "IDLE",
    lastErrorCode: null,
  }
}
