/**
 * processingTime — mean/p95 over one run's work units, and the nearest-rank percentile (ADR 0097).
 *
 * ## Why this is its own module and not part of `job.ts`
 *
 * `job.ts` states its own contract: "Every field below is transcribed from the committed schema's
 * `required` list and `enum` members — not designed here." `ProcessingTimeStats` is NOT in the
 * committed schema. It is a v3 run-REPORT field, designed here, and putting it in `job.ts` would
 * make that file's opening promise false for one interface — the kind of small erosion that makes
 * a docblock stop being load-bearing.
 *
 * ## Why `domain/` and not `operations/`
 *
 * `operations/` imports `storage/`; `storage/` imports `operations/` nowhere, and that direction is
 * unbroken across the package. `storage/runReport.ts` and `operations/resolveArtifacts.ts` both
 * need this type, so it belongs in the layer they can both reach.
 *
 * ## No clock here
 *
 * This module reads no time. It takes durations someone else measured and does arithmetic over
 * them. The monotonic clock lives at the one seam that can observe a unit of work start and finish
 * (`resolveArtifacts`), which keeps INV-R6's rule — time is a parameter, never ambient — true of
 * this layer as well.
 */

/**
 * Mean/p95 over one run's attempts, in milliseconds.
 *
 * `n` SHIPS BESIDE THE STATISTIC, always. A p95 over 3 samples and a p95 over 300 are different
 * claims wearing one name, and a reader who cannot see `n` cannot tell them apart — the same reason
 * every rate in this pipeline prints its denominator. `skipped` is carried too, so a reader can
 * check `n + skipped` against the run's `considered` rather than take `n` on trust.
 */
export interface ProcessingTimeStats {
  /** Attempts that produced a duration. Never 0 — an empty distribution is `null`, not a zeroed row. */
  readonly n: number
  /** Units excluded because nothing was tried (`NO_ADAPTER`). Present so `n` can be audited. */
  readonly skipped: number
  readonly meanMs: number
  readonly p95Ms: number
  readonly minMs: number
  readonly maxMs: number
}

/**
 * Nearest-rank p95 — the sample at `ceil(0.95 * n) - 1` of the sorted durations.
 *
 * NEAREST-RANK, NOT INTERPOLATED, and at this `n` the choice is visible. With 36 attempts the rank
 * is index 34; a linear interpolation would invent a value BETWEEN two real observations and print
 * it as an observed duration. Every other number in this pipeline is forbidden from doing that, so
 * this one is too: the p95 it reports is always an actual measurement, traceable to one artifact.
 *
 * RETURNS `null` ON AN EMPTY INPUT, and callers must not substitute zeros. `0 ms` over 0 samples is
 * the perfect-score-from-no-observations fault this repository has closed four times; a rate over an
 * empty denominator is the absence of a measurement wearing a good result's clothes.
 *
 * Pure and exported so a gate can RECOUNT the statistic from the same samples instead of trusting
 * the writer's arithmetic — the discipline ADR 0093 set for the CAS manifest's `totals`.
 */
export function processingTimeStats(
  durationsMs: readonly number[],
  skipped: number,
): ProcessingTimeStats | null {
  if (durationsMs.length === 0) return null
  const sorted = [...durationsMs].sort((a, b) => a - b)
  const n = sorted.length
  const rank = Math.max(0, Math.ceil(0.95 * n) - 1)
  const sum = sorted.reduce((acc, d) => acc + d, 0)
  return {
    n,
    skipped,
    // Whole milliseconds. A fractional mean over network fetches is precision the measurement does
    // not have, and `performance.now`'s tail would make two identical runs differ in their last
    // digits — noise a reader would have to learn to ignore.
    meanMs: Math.round(sum / n),
    p95Ms: Math.round(sorted[rank] ?? 0),
    minMs: Math.round(sorted[0] ?? 0),
    maxMs: Math.round(sorted[n - 1] ?? 0),
  }
}
