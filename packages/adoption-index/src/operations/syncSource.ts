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
import type {
  SourceAdapter,
  SourceSyncContext,
  SyncTruncationReason,
} from "../sources/sourceAdapter.js"
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
   * The native ids this run's stream actually contained, deduplicated.
   *
   * Reported rather than inferred, because R-2's withdrawal probe set-differences it against
   * the subjects the mirror already considered current. The alternative — recovering "what
   * this run saw" from `last_seen_at` after the write — is wrong whenever two runs share an
   * injected clock value, which is every test that pins `now` and any two real runs inside
   * the same millisecond. A stream can also legitimately yield one native id more than once
   * (successive versions of a server), so this is a Set, not a count.
   */
  observedNativeIds: ReadonlySet<string>
  /**
   * True when the read stopped for ANY reason other than the source running out of records.
   *
   * The adapter's cap is a runaway guard applied in ARRIVAL order and BEFORE the lifecycle
   * filter, so a capped read yields an arbitrary subset of the source. Any projection that
   * filters-then-sorts-then-slices needs the COMPLETE set to be correct: the emitter's own
   * cap keeps the N alphabetically-first LIVE entries, and you cannot know which those are
   * from a prefix of the arrival order.
   *
   * REPORTED BY THE ADAPTER, NOT INFERRED FROM THE COUNT. This was
   * `records.length >= ctx.maxEntries`, which is a test only the RECORD-cap exit passes.
   * The paginator has two other exits — the `maxPages` ceiling and a repeated cursor — and
   * both truncate while leaving `records.length` well under the cap, so both passed
   * `assertMirrorComplete` as complete reads. Measured: 5 pages x 3 records against a
   * 100_000 record cap yields 15 records and `records.length >= maxEntries` is false.
   *
   * The record-cap exit remains deliberately AMBIGUOUS-AS-CAPPED: a source holding exactly
   * `maxEntries` records is indistinguishable from truncation without one more request, so
   * it is reported as capped. Over-reporting costs a raised cap; under-reporting silently
   * ships a snapshot missing entries.
   */
  capReached: boolean
  /**
   * Which exit ended the read, or null when the source was exhausted.
   *
   * Kept alongside `capReached` rather than replacing it because the two answer different
   * questions — "may I project?" is a boolean and every existing caller asks only that,
   * while "what should the operator change?" differs per reason: a `page-cap` needs
   * `maxPages`, a `record-cap` needs `maxEntries`, and `cursor-repeat` needs neither
   * because no local number fixes a source that will not advance its own cursor.
   */
  truncationReason: SyncTruncationReason | null
}

/** What an operator should change, per exit. `cursor-repeat` names no knob on purpose. */
const REMEDY: Record<SyncTruncationReason, string> = {
  "record-cap": "Raise the record cap (TRUST_INGEST_MIRROR_MAX_ENTRIES) and re-run.",
  "page-cap":
    "Raise the page ceiling (maxPages / TRUST_INGEST_MIRROR_MAX_PAGES) and re-run. " +
    "Note the record cap was NOT the binding limit here.",
  "cursor-repeat":
    "The source echoed a cursor back instead of advancing it. No local cap fixes this; " +
    "the read cannot be completed until the source paginates correctly.",
}

/**
 * Thrown by `assertMirrorComplete`. Named so a caller can catch this and nothing else.
 *
 * `reason` is optional so the class stays constructible from the two-argument form used by
 * existing callers and tests. When present it selects the remedy, because "raise the cap"
 * is actively misleading advice for a `page-cap` truncation — the record cap was not what
 * bound the read, and raising it changes nothing.
 */
export class MirrorIncompleteError extends Error {
  readonly records: number
  readonly maxEntries: number
  readonly reason: SyncTruncationReason | null
  constructor(records: number, maxEntries: number, reason: SyncTruncationReason | null = null) {
    const where = reason === null ? "a cap" : `the ${reason} limit`
    super(
      `mirror read stopped at ${where} (${records} records read, cap ${maxEntries}): the source ` +
        `may hold more. A projection over a truncated read can silently omit entries, because the ` +
        `read stops in arrival order before the lifecycle filter. ` +
        (reason === null ? "Raise the cap and re-run." : REMEDY[reason]),
    )
    this.name = "MirrorIncompleteError"
    this.records = records
    this.maxEntries = maxEntries
    this.reason = reason
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
  if (result.capReached) {
    throw new MirrorIncompleteError(result.records, maxEntries, result.truncationReason)
  }
}

export async function syncSource(opts: SyncSourceOptions): Promise<SyncSourceResult> {
  const { store, adapter, ctx, mode } = opts
  const prior = store.beginRun(adapter.sourceId, ctx.retrievedAt)

  // Truncation is REPORTED by the adapter through the context, because an AsyncIterable
  // gives its consumer no channel but items. The first reason wins: an adapter stops at the
  // first exit it hits, so a second report would mean two exits fired in one read.
  let truncationReason: SyncTruncationReason | null = null
  const syncCtx: SourceSyncContext = {
    ...ctx,
    onTruncated: (reason) => {
      truncationReason ??= reason
      ctx.onTruncated?.(reason)
    },
  }

  let records: SourceRecordV1[]
  try {
    const stream =
      mode === "full" ? adapter.fullSync(syncCtx) : adapter.incrementalSync(prior, syncCtx)
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
    observedNativeIds: new Set(records.map((r) => r.source.sourceRecordId)),
    // REPORTED, not derived. The previous form was `records.length >= ctx.maxEntries`, on
    // the reasoning that "the adapter is a generator and a generator cannot return a value
    // the consumer sees" — a true premise with a wrong conclusion, since the channel is the
    // context, not the return value. That derivation is blind to every exit except the
    // record cap, so a read truncated by the page ceiling reported itself complete.
    //
    // The record-cap case still ORs in the count comparison, so an adapter that caps
    // without reporting (any future adapter behind this port) is still caught by the
    // conservative test rather than trusted.
    capReached: truncationReason !== null || records.length >= ctx.maxEntries,
    truncationReason:
      truncationReason ?? (records.length >= ctx.maxEntries ? "record-cap" : null),
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
