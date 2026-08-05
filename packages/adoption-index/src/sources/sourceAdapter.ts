/**
 * SourceAdapter — the §9.3 port. One adapter per source; the store knows none of them.
 *
 * `fullSync` and `incrementalSync` both return an AsyncIterable so a large source can be
 * streamed and persisted in batches rather than buffered whole. R-1 ships one adapter
 * (the Official MCP Registry, the §8.1 seed identity); R-3+ add others behind this same
 * port without touching the store.
 */
import type { SourceCheckpoint } from "../domain/checkpoint.js"
import type { SourceRecordV1 } from "../domain/sourceRecord.js"

export interface SourceSyncContext {
  /**
   * Retrieval time, stamped onto every record's provenance. Injected — the sync edge
   * captures a clock ONCE and passes it inward, so the records of one run share one
   * `retrievedAt` and a compile over them holds no wall-clock read (§9.5, INV-R6).
   */
  retrievedAt: string
  /** Injected fetch. Tests pass a stub; there is no ambient network access. */
  fetchImpl: typeof fetch
  /** Hard cap on records per run (ADR 0038 §6: start small, fail safe). */
  maxEntries: number
  /** Hard cap on HTTP requests per run, so a cursor loop cannot spin forever. */
  maxPages?: number
  /**
   * Called by the adapter when a read ends for any reason OTHER than the source running
   * out of records, so the caller can refuse to project from a truncated mirror.
   *
   * WHY A CALLBACK AND NOT A RETURN VALUE. `fullSync`/`incrementalSync` return an
   * `AsyncIterable` so a large source streams rather than buffers, and an iterable's
   * consumer sees only items — there is no channel on which "I stopped early" can arrive.
   * `SyncOutcome` was declared for this and is produced by nothing, which is exactly how
   * the page ceiling stayed invisible: `capReached` was computed by the CALLER as
   * `records.length >= maxEntries`, a test the page-limit exit passes while truncating.
   *
   * Optional so existing callers compile unchanged; a caller that omits it is choosing not
   * to hear about truncation, and the only caller that projects does not omit it.
   */
  onTruncated?: (reason: SyncTruncationReason) => void
}

/**
 * Why a paginated read stopped short of exhausting the source.
 *
 * Three distinct exits, kept distinct because they need different operator responses:
 * `record-cap` and `page-cap` are raised by config, while `cursor-repeat` means the source
 * echoed a cursor back and is a source-side fault no local number can fix.
 */
export type SyncTruncationReason = "record-cap" | "page-cap" | "cursor-repeat"

export interface SourceAdapter {
  sourceId: string
  fullSync(ctx: SourceSyncContext): AsyncIterable<SourceRecordV1>
  incrementalSync(checkpoint: SourceCheckpoint, ctx: SourceSyncContext): AsyncIterable<SourceRecordV1>
  /**
   * Reject a checkpoint this adapter cannot resume from (§9.3). Fails CLOSED: the caller's
   * correct response is a full sync, never a resume from a guessed position.
   */
  validateCheckpoint(checkpoint: SourceCheckpoint): void
}

/**
 * The advertised end of a paginated read: the cursor the NEXT run resumes from, and the
 * watermark it filters on. Returned separately from the records because §9.4 forbids
 * advancing either one before the records are durably committed.
 *
 * NOT PRODUCED BY ANY ADAPTER. Both port methods return a bare `AsyncIterable`, so nothing
 * on this interface — `nextCursor`, `pagesFetched` — ever reaches a caller. It is kept
 * because it documents the §9.4 shape a future batched-persist adapter owes, and removing
 * it would delete that contract; it is annotated because reading it as live plumbing is
 * what made the page-ceiling truncation look reported when it was not. Truncation travels
 * on `SourceSyncContext.onTruncated`, which an adapter does call.
 */
export interface SyncOutcome {
  records: SourceRecordV1[]
  nextCursor: string | null
  /** The highest `publishedAt` observed, or null when the source reported none. */
  highWaterMark: string | null
  /** Pages actually fetched, so a test can assert a cache/incremental path did not refetch. */
  pagesFetched: number
}
