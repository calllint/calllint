/**
 * npm download backfill (new18 §24).
 *
 * The npm downloads range API caps a single request at 18 months, so a full
 * backfill needs chunking. new18 §24 requires the chunks be deterministic,
 * contiguous, non-overlapping, and summed exactly once — the failure mode being
 * a double-counted boundary day, which silently inflates a cumulative total in a
 * way no test of the total alone would catch.
 *
 * Pure functions here; the fetch lives in the generator so this is testable
 * without network.
 */

/** npm's documented maximum span for a single range request. */
export const MAX_RANGE_DAYS = 540

export interface DateRange {
  start: string
  end: string
}

export interface DailyDownload {
  day: string
  downloads: number
}

const MS_PER_DAY = 86_400_000

const toDay = (date: Date): string => date.toISOString().slice(0, 10)
const parseDay = (day: string): number => Date.parse(`${day}T00:00:00Z`)

/**
 * Split [start, end] into contiguous chunks of at most MAX_RANGE_DAYS.
 *
 * Each chunk's start is the day AFTER the previous chunk's end, so no day
 * appears twice and none is skipped.
 */
export function planRanges(start: string, end: string): DateRange[] {
  const startMs = parseDay(start)
  const endMs = parseDay(end)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new Error(`npm backfill: unparseable range ${start}..${end}`)
  }
  if (endMs < startMs) return []

  const ranges: DateRange[] = []
  let cursorMs = startMs
  while (cursorMs <= endMs) {
    const chunkEndMs = Math.min(cursorMs + (MAX_RANGE_DAYS - 1) * MS_PER_DAY, endMs)
    ranges.push({ start: toDay(new Date(cursorMs)), end: toDay(new Date(chunkEndMs)) })
    cursorMs = chunkEndMs + MS_PER_DAY
  }
  return ranges
}

/**
 * Merge chunk responses into one day-keyed series, rejecting a duplicated day.
 *
 * A duplicate means the chunk plan overlapped, which would double-count on
 * summation. Throwing is deliberate: a silently-merged duplicate produces a
 * plausible-looking but wrong cumulative figure.
 */
export function mergeDaily(chunks: DailyDownload[][]): DailyDownload[] {
  const byDay = new Map<string, number>()
  for (const chunk of chunks) {
    for (const { day, downloads } of chunk) {
      if (byDay.has(day)) {
        throw new Error(`npm backfill: day ${day} appeared in more than one chunk`)
      }
      byDay.set(day, downloads)
    }
  }
  return [...byDay.entries()]
    .map(([day, downloads]) => ({ day, downloads }))
    .sort((a, b) => a.day.localeCompare(b.day))
}

/** Total downloads across the whole series. */
export const sumDownloads = (series: DailyDownload[]): number =>
  series.reduce((total, { downloads }) => total + downloads, 0)

/**
 * Total downloads over the trailing `days` window ending at `throughDay`
 * inclusive. A 30-day window is the 30 calendar days up to and including that
 * day, so the cutoff is days-1 back.
 */
export function sumTrailing(
  series: DailyDownload[],
  throughDay: string,
  days: number,
): number {
  const endMs = parseDay(throughDay)
  const startMs = endMs - (days - 1) * MS_PER_DAY
  return series
    .filter(({ day }) => {
      const ms = parseDay(day)
      return ms >= startMs && ms <= endMs
    })
    .reduce((total, { downloads }) => total + downloads, 0)
}

/** The latest day present in a series, or null when empty. */
export const latestDay = (series: DailyDownload[]): string | null =>
  series.length === 0 ? null : (series[series.length - 1]?.day ?? null)
