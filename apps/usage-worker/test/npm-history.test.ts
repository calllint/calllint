/**
 * npm backfill tests (new18 §24). The requirement is arithmetic: contiguous, no
 * overlap, no missing day, summed exactly once. A double-counted boundary day is
 * the specific failure these guard, because it inflates a cumulative total in a
 * way that checking the total alone cannot detect.
 */
import { describe, expect, it } from "vitest"
import {
  MAX_RANGE_DAYS,
  latestDay,
  mergeDaily,
  planRanges,
  sumDownloads,
  sumTrailing,
  type DailyDownload,
} from "../src/npm-history.js"

const MS_PER_DAY = 86_400_000
const dayAfter = (day: string): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + MS_PER_DAY).toISOString().slice(0, 10)
const spanDays = (start: string, end: string): number =>
  (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / MS_PER_DAY + 1

describe("planRanges", () => {
  it("returns a single range when the span fits", () => {
    expect(planRanges("2026-06-17", "2026-08-20")).toEqual([
      { start: "2026-06-17", end: "2026-08-20" },
    ])
  })

  it("returns one range for a single day", () => {
    expect(planRanges("2026-06-17", "2026-06-17")).toEqual([
      { start: "2026-06-17", end: "2026-06-17" },
    ])
  })

  it("returns nothing when the end precedes the start", () => {
    expect(planRanges("2026-08-20", "2026-06-17")).toEqual([])
  })

  it("chunks a long span with contiguous, non-overlapping ranges", () => {
    const ranges = planRanges("2020-01-01", "2026-08-20")
    expect(ranges.length).toBeGreaterThan(1)

    // Contiguity: each chunk starts the day after the previous one ended.
    for (let i = 1; i < ranges.length; i += 1) {
      const previous = ranges[i - 1]
      const current = ranges[i]
      expect(current?.start).toBe(dayAfter(previous?.end ?? ""))
    }

    // Endpoints preserved exactly.
    expect(ranges[0]?.start).toBe("2020-01-01")
    expect(ranges[ranges.length - 1]?.end).toBe("2026-08-20")
  })

  it("keeps every chunk within the API's maximum span", () => {
    for (const range of planRanges("2019-01-01", "2026-08-20")) {
      expect(spanDays(range.start, range.end)).toBeLessThanOrEqual(MAX_RANGE_DAYS)
    }
  })

  it("covers exactly the requested days with no gap and no repeat", () => {
    const start = "2023-03-05"
    const end = "2026-08-20"
    const ranges = planRanges(start, end)
    const covered = ranges.reduce((sum, r) => sum + spanDays(r.start, r.end), 0)
    expect(covered).toBe(spanDays(start, end))
  })

  it("splits exactly at the boundary when the span is one day too long", () => {
    const start = "2024-01-01"
    const lastFitting = new Date(
      Date.parse(`${start}T00:00:00Z`) + (MAX_RANGE_DAYS - 1) * MS_PER_DAY,
    )
      .toISOString()
      .slice(0, 10)
    expect(planRanges(start, lastFitting)).toHaveLength(1)
    expect(planRanges(start, dayAfter(lastFitting))).toHaveLength(2)
  })

  it("throws on an unparseable date rather than planning a bogus range", () => {
    expect(() => planRanges("not-a-date", "2026-08-20")).toThrow(/unparseable/)
  })
})

describe("mergeDaily", () => {
  it("merges chunks into one ascending series", () => {
    const merged = mergeDaily([
      [{ day: "2026-08-02", downloads: 3 }],
      [{ day: "2026-08-01", downloads: 2 }],
    ])
    expect(merged.map((d) => d.day)).toEqual(["2026-08-01", "2026-08-02"])
  })

  it("throws when a day appears in two chunks", () => {
    // An overlapping plan must fail loudly — silently merging would
    // double-count on summation and produce a plausible but wrong total.
    expect(() =>
      mergeDaily([
        [{ day: "2026-08-01", downloads: 2 }],
        [{ day: "2026-08-01", downloads: 2 }],
      ]),
    ).toThrow(/more than one chunk/)
  })

  it("handles empty input and empty chunks", () => {
    expect(mergeDaily([])).toEqual([])
    expect(mergeDaily([[], []])).toEqual([])
  })
})

describe("summation", () => {
  const series: DailyDownload[] = [
    { day: "2026-07-20", downloads: 5 },
    { day: "2026-08-01", downloads: 2 },
    { day: "2026-08-19", downloads: 7 },
    { day: "2026-08-20", downloads: 1 },
  ]

  it("sums the whole series", () => {
    expect(sumDownloads(series)).toBe(15)
    expect(sumDownloads([])).toBe(0)
  })

  it("sums a trailing window inclusive of the end day", () => {
    // 2026-07-22..2026-08-20 excludes 07-20: 2 + 7 + 1 = 10.
    expect(sumTrailing(series, "2026-08-20", 30)).toBe(10)
  })

  it("includes the boundary day exactly once", () => {
    // A 1-day window is just the end day itself.
    expect(sumTrailing(series, "2026-08-20", 1)).toBe(1)
    // A 2-day window adds the previous day.
    expect(sumTrailing(series, "2026-08-20", 2)).toBe(8)
  })

  it("returns zero for a window with no data", () => {
    expect(sumTrailing(series, "2025-01-01", 30)).toBe(0)
  })

  it("reports the latest day", () => {
    expect(latestDay(series)).toBe("2026-08-20")
    expect(latestDay([])).toBeNull()
  })
})
