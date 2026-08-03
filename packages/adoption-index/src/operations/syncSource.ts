/**
 * syncSource — the operation that runs one source sync end to end.
 *
 * This function exists to make ONE rule structurally true: §9.4's "never advance the
 * checkpoint before all fetched records are persisted." The records are drained from the
 * adapter first, then persisted and the checkpoint advanced inside a SINGLE transaction.
 * Either both land or neither does. A crash between them is impossible rather than
 * unlikely.
 *
 * The failure path is equally deliberate. A fetch that throws leaves the checkpoint
 * `RUNNING` on disk, and `failRun` then marks it `FAILED` with an error code — a terminal
 * run state (INV-R5). What it does NOT do is advance `updatedSince`, so the next run
 * re-reads the same window. A partially-drained iterator persists nothing: half a page is
 * not a synced source, and recording it as one is how a gap becomes permanent.
 */
import type { SourceRecordV1 } from "../domain/sourceRecord.js"
import type { SourceCheckpoint } from "../domain/checkpoint.js"
import type { AdoptionIndexStore, PersistResult } from "../storage/store.js"
import type { SourceAdapter, SourceSyncContext } from "../sources/sourceAdapter.js"
import { highWaterMark } from "../sources/officialRegistry.js"

export interface SyncSourceOptions {
  store: AdoptionIndexStore
  adapter: SourceAdapter
  ctx: SourceSyncContext
  /**
   * `full` ignores the watermark; `incremental` resumes from it. The caller owns the
   * schedule — §9.4 wants a weekly full reconciliation alongside frequent incrementals,
   * and that cadence is an operational decision, not a property of this function.
   */
  mode: "full" | "incremental"
  /** ISO-8601 completion stamp written to the checkpoint. Injected (§9.5, INV-R6). */
  completedAt: string
}

export interface SyncSourceResult {
  mode: "full" | "incremental"
  records: number
  persisted: PersistResult
  checkpoint: SourceCheckpoint
  /**
   * True when the read stopped at `ctx.maxEntries` rather than at the end of the source.
   *
   * The adapter's cap is a runaway guard applied in ARRIVAL order and BEFORE the lifecycle
   * filter, so a capped read yields an arbitrary subset of the source. Any projection that
   * filters-then-sorts-then-slices needs the COMPLETE set to be correct: the emitter's own
   * cap keeps the N alphabetically-first LIVE entries, and you cannot know which those are
   * from a prefix of the arrival order.
   *
   * `paginate` returns as soon as `yielded >= maxEntries`, so the count can never exceed
   * the cap and equality is the exact condition. Equality is also reached by a source that
   * happens to hold exactly `maxEntries` records, which is indistinguishable from
   * truncation without one more request — so this reports the AMBIGUOUS case as capped and
   * a caller that projects must refuse it. Over-reporting costs a raised cap; under-
   * reporting silently ships a snapshot missing entries.
   */
  capReached: boolean
}

/** Thrown by `assertMirrorComplete`. Named so a caller can catch this and nothing else. */
export class MirrorIncompleteError extends Error {
  readonly records: number
  readonly maxEntries: number
  constructor(records: number, maxEntries: number) {
    super(
      `mirror read stopped at the record cap (${records}/${maxEntries}): the source may hold more. ` +
        `A projection over a capped read can silently omit entries, because the cap applies in ` +
        `arrival order before the lifecycle filter. Raise the cap and re-run.`,
    )
    this.name = "MirrorIncompleteError"
    this.records = records
    this.maxEntries = maxEntries
  }
}

/**
 * Fail CLOSED before projecting from the mirror.
 *
 * The alternative — projecting anyway — produces a snapshot that is well-formed, passes
 * every schema check, and is quietly missing servers. That failure is invisible in the
 * artifact, which is exactly the class of defect this workstream keeps turning into a
 * measurement. Refusing to emit is recoverable; emitting a short snapshot is not
 * detectable without the source.
 */
export function assertMirrorComplete(result: SyncSourceResult, maxEntries: number): void {
  if (result.capReached) throw new MirrorIncompleteError(result.records, maxEntries)
}

export async function syncSource(opts: SyncSourceOptions): Promise<SyncSourceResult> {
  const { store, adapter, ctx, mode } = opts
  const prior = store.beginRun(adapter.sourceId, ctx.retrievedAt)

  let records: SourceRecordV1[]
  try {
    const stream = mode === "full" ? adapter.fullSync(ctx) : adapter.incrementalSync(prior, ctx)
    records = []
    for await (const record of stream) records.push(record)
  } catch (err) {
    // Terminal for the run, and the watermark is untouched so the window is re-read.
    store.failRun(adapter.sourceId, "SOURCE_FETCH_FAILED")
    throw err
  }

  // The watermark only ever moves FORWARD. An incremental run that returns nothing (the
  // common case) must not reset the watermark to null and silently convert every later
  // incremental into a full read.
  const observed = highWaterMark(records)
  const nextWatermark = pickLater(prior.updatedSince, observed)

  const result = store.transaction((tx) => {
    const persisted = tx.persistSourceRecords(records, ctx.retrievedAt)
    const checkpoint: SourceCheckpoint = {
      ...prior,
      updatedSince: nextWatermark,
      lastStartedAt: ctx.retrievedAt,
      lastCompletedAt: opts.completedAt,
      status: "COMPLETED",
      lastErrorCode: null,
    }
    tx.advanceCheckpoint(checkpoint)
    return { persisted, checkpoint }
  })

  return {
    mode,
    records: records.length,
    persisted: result.persisted,
    checkpoint: result.checkpoint,
    // `paginate` returns at `yielded >= maxEntries`, so `>` is unreachable and `===` is
    // the whole condition. Derived here rather than reported by the adapter: the adapter
    // is a generator and a generator cannot return a value the consumer sees.
    capReached: records.length >= ctx.maxEntries,
  }
}

/** The later of two optional ISO-8601 stamps; unparseable input never wins. */
export function pickLater(a: string | null, b: string | null): string | null {
  const ta = a === null ? Number.NaN : Date.parse(a)
  const tb = b === null ? Number.NaN : Date.parse(b)
  if (Number.isNaN(ta) && Number.isNaN(tb)) return null
  if (Number.isNaN(tb)) return a
  if (Number.isNaN(ta)) return b
  return tb > ta ? b : a
}
