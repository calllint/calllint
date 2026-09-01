/**
 * processing-time — the mean/p95 statistic, and the four traps it is built to fall into safely.
 *
 * The statistic itself is arithmetic and would be boring to test if the measure it serves had not
 * spent its whole life REFUSED behind a blocker that was wrong in three separate ways (ADR 0097).
 * So these tests are aimed less at the formula than at the properties that make the formula
 * trustworthy:
 *
 *   1. an empty distribution returns `null`, never a zeroed object — a mean of 0 over 0 samples is
 *      the perfect-score-from-no-observations fault this repo has closed four times;
 *   2. p95 is NEAREST-RANK, so the value it reports is always one of the inputs and never a number
 *      interpolated between two of them;
 *   3. `n` and `skipped` are carried, so a reader can audit the distribution against the run;
 *   4. the input is not mutated — the caller's `records` order is load-bearing elsewhere.
 */
import { describe, expect, it } from "vitest"
import { processingTimeStats } from "../src/domain/processingTime.js"

describe("processingTimeStats — the empty distribution", () => {
  it("returns null on no samples, and NOT a zeroed statistic", () => {
    // THE NEGATIVE FIXTURE for this whole feature. `{ n: 0, meanMs: 0, p95Ms: 0 }` would render in
    // the gate as "mean 0 ms, p95 0 ms" — an instantaneous compiler, asserted from nothing. Every
    // caller must be forced to branch, which only a `null` does.
    expect(processingTimeStats([], 0)).toBeNull()
    expect(processingTimeStats([], 28)).toBeNull()
  })
})

describe("processingTimeStats — nearest-rank p95", () => {
  it("reports an OBSERVED duration, never an interpolation between two", () => {
    // 20 samples, so `ceil(0.95 * 20) - 1 = 18` — the 19th smallest. A linear-interpolation p95
    // over this input lands at 96.5, which is not a duration anything took.
    const durations = Array.from({ length: 20 }, (_, i) => (i + 1) * 5) // 5,10,…,100
    const s = processingTimeStats(durations, 0)
    expect(s).not.toBeNull()
    expect(s?.p95Ms, "the p95 must be the sample at index 18, i.e. 95 ms").toBe(95)
    expect(durations, "and it must be a value that actually appears in the input").toContain(s?.p95Ms)
  })

  it("does not fall off the end at small n, where ceil(0.95n)-1 is the last index", () => {
    // n=1 → rank 0; n=2 → rank 1; n=3 → rank 2. All three are the MAX, which is correct: with three
    // observations the 95th percentile is the slowest one, and there is no honest way to claim less.
    expect(processingTimeStats([7], 0)?.p95Ms).toBe(7)
    expect(processingTimeStats([7, 90], 0)?.p95Ms).toBe(90)
    expect(processingTimeStats([90, 7, 40], 0)?.p95Ms).toBe(90)
  })

  it("sorts before ranking, so input order cannot change the answer", () => {
    const ascending = processingTimeStats([1, 2, 3, 400], 0)
    const shuffled = processingTimeStats([400, 2, 1, 3], 0)
    expect(shuffled).toEqual(ascending)
  })
})

describe("processingTimeStats — what ships beside the number", () => {
  it("carries n and skipped, so the distribution can be audited against the run", () => {
    // THE POSITIVE FIXTURE, shaped like the real run: 36 attempted of 64 considered, 28 skipped.
    const durations = Array.from({ length: 36 }, (_, i) => 100 + i)
    const s = processingTimeStats(durations, 28)
    expect(s?.n).toBe(36)
    expect(s?.skipped).toBe(28)
    // The reader can now check 36 + 28 = 64 against the report's `considered` without trusting us.
    expect((s?.n ?? 0) + (s?.skipped ?? 0)).toBe(64)
  })

  it("reports min <= mean <= max, and rounds to whole milliseconds", () => {
    const s = processingTimeStats([10, 11, 12], 0)
    expect(s?.minMs).toBe(10)
    expect(s?.maxMs).toBe(12)
    expect(s?.meanMs).toBe(11)
    // 10.5 mean over two samples rounds rather than printing a fractional millisecond: sub-ms
    // precision over network fetches is precision the measurement does not have.
    expect(processingTimeStats([10, 11], 0)?.meanMs).toBe(11)
  })

  it("does not mutate its input", () => {
    // `resolveArtifacts` passes durations derived from `records`, whose order is
    // `artifact_version_id` and is asserted elsewhere. An in-place `sort` here would reorder a
    // caller's array from inside a statistics helper — the kind of action at a distance that shows
    // up three modules away as a flaky ordering assertion.
    const input = [3, 1, 2]
    processingTimeStats(input, 0)
    expect(input).toEqual([3, 1, 2])
  })
})
