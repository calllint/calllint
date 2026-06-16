import { parseArgs, flagStr } from "./args.js"

/** A single run clock: one timestamp shared by the whole scan. */
export interface Clock {
  /** ISO 8601 string used for every report's `generatedAt`. */
  generatedAt: string
  /** Epoch milliseconds used for internal timing (`now`). */
  now: number
}

/**
 * Resolve the run clock from argv.
 *
 * `--generated-at <iso>` pins both the report timestamp and the internal `now`
 * to a fixed instant, making `--json` output fully deterministic. This is what
 * the corpus release gate and reproducible CI reports rely on; without it the
 * real wall clock is used. It only affects timestamps — never a verdict.
 *
 * Throws on a malformed value so the caller can surface a usage error rather
 * than silently emitting an `Invalid Date`.
 */
export function resolveClock(argv: string[], fallback: () => Date): Clock {
  const { flags } = parseArgs(argv)
  const raw = flagStr(flags, "generated-at")
  if (raw !== undefined) {
    const ms = Date.parse(raw)
    if (Number.isNaN(ms)) {
      throw new Error(
        `Invalid --generated-at value: "${raw}" (expected an ISO 8601 timestamp)`,
      )
    }
    return { generatedAt: new Date(ms).toISOString(), now: ms }
  }
  const d = fallback()
  return { generatedAt: d.toISOString(), now: d.getTime() }
}
