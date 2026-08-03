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
    throw new Error(
      `checkpoint for ${cp.sourceId} is RUNNING — a previous run did not reach a terminal state; ` +
        "resume would skip records that run fetched but may not have persisted",
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
