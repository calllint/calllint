/**
 * The Freshness Calculator (R-10, `docs/new17.md` §P4).
 *
 * `freshness.ts` (S-2) answers one question: how old is THIS observation? That is a single-axis
 * display value, and it must stay single-axis — `apps/web/scripts/trust-freshness.js` recomputes
 * exactly it in the browser from the element's own `datetime` attribute, and
 * `freshness-served-plane.test.ts` asserts the two planes agree. §P4 asks a different question:
 * across every axis that can go stale independently, is our knowledge of this subject still good,
 * and when must it be resolved again?
 *
 * So this is an ADJACENT calculator, not a wider `Freshness`. Two structural reasons:
 *   1. `EnvelopeFreshness` in `packages/partner-api/src/types.ts` pins `FRESHNESS_KEYS` with a
 *      two-sided `AssertNever` bridge. A new key inside `freshness` moves that pinned set.
 *   2. The browser plane can only ever see one axis (an element's own `datetime`). A multi-axis
 *      status recomputed there would be a second, weaker source of truth for the same field.
 *
 * INV-R11, the invariant this file exists to hold:
 *
 *   A failed refresh never extends freshness, and freshness never modifies a verdict.
 *
 * The first half is why `bakedAt` is NOT an axis. The bake re-runs on every push; if re-emitting a
 * page counted as resolving it, every entry would be permanently FRESH and the field would measure
 * our CI cadence rather than our knowledge. §P4 states this directly: 页面重新生成不能让旧
 * evidence 变新. Only a timestamp written by a step that actually SUCCEEDED at fetching or
 * resolving upstream state may appear in `basis`.
 *
 * The second half is structural: nothing here is imported by `computeVerdict`, and `status` is
 * emitted OUTSIDE `pageDigest` on `index.json` only — the same placement, forced by the same
 * reasoning, as `identity` (R-8) and `freshness` (S-2). `observedAt` is sealed inside the digest,
 * so any `f(observedAt, now)` field in a page body would make all 39 digests a function of the
 * wall clock (ADR 0053 §5, ADR 0061 §4).
 */

import { AGING_MULTIPLE, CADENCE_DAYS } from "./freshness.js"

const MS_PER_DAY = 86_400_000

/**
 * The resolution axes this calculator can actually measure from committed bytes.
 *
 * Deliberately TWO, not §P4's nine. The other seven are enumerated in `UNMEASURED_AXES` below with
 * the reason each is unmeasurable today, because naming a gap is honest and silently omitting it is
 * how a coverage limit becomes an implied guarantee (product principle 2: UNKNOWN is not SAFE).
 */
export const RESOLUTION_AXES = ["source-observation", "evidence-resolution"] as const

export type ResolutionAxis = (typeof RESOLUTION_AXES)[number]

/**
 * §P4's four states, exactly. Note `UNKNOWN` — which `FreshnessState` does not have, and cannot
 * meaningfully have: a single-axis age is either a number or a fixture anchor. Here it is
 * load-bearing, and it is the answer whenever NO axis could be measured. It never inherits a
 * previous state (§P4: `UNKNOWN` 不能因上次是 SAFE 而继承 SAFE).
 */
export const RESOLUTION_STATES = ["FRESH", "AGING", "STALE", "UNKNOWN"] as const

export type ResolutionStatus = (typeof RESOLUTION_STATES)[number]

/**
 * The seven §P4 facts nothing on `main` can measure today, each with the reason.
 *
 * Emitted ONCE at the document level (`index.json.resolutionPolicy`), not repeated on all 39
 * entries: these are limits of the calculator, identical for every subject, so per-entry copies
 * would be 39 restatements of one fact. A per-entry `blockingUnknowns` carries only what is
 * unknown about THAT entry.
 *
 * This list is the difference between §P4's nine axes and `RESOLUTION_AXES`' two. A gate asserts
 * that arithmetic so a future axis cannot be implemented while its "unmeasurable" note survives.
 */
export const UNMEASURED_AXES = [
  { fact: "artifact-bytes-changed", reason: "no per-artifact digest history is committed; only the current digest" },
  { fact: "resolver-version-changed", reason: "resolver version is not stamped into the snapshot" },
  { fact: "policy-version-changed", reason: "the served tree records no per-entry policy identity" },
  { fact: "evidence-ttl", reason: "no upstream advisory declares a TTL; ttlMs=0 is the conservative default" },
  { fact: "upstream-withdrawal", reason: "withdrawal/tombstone lifecycle is R-11; the mirror is append-only" },
  { fact: "claim-status-changed", reason: "the claim store carries no transition timestamps" },
  { fact: "failed-refresh-count", reason: "the ingest workflow records no per-subject failure counter" },
] as const

/** One measured axis: which axis, and the instant it last SUCCEEDED. */
export interface ResolutionBasis {
  axis: ResolutionAxis
  at: string
  ageDays: number
}

/** §P4's output shape. */
export interface Resolution {
  status: ResolutionStatus
  basis: ResolutionBasis[]
  lastSuccessfulResolution: string | null
  nextRequiredResolution: string | null
  blockingUnknowns: string[]
  cadenceDays: number
}

export interface ComputeResolutionInput {
  /**
   * Candidate axes. A `null` instant means "this axis exists for this subject but did not resolve"
   * — a FAILED refresh — and it is dropped from `basis` while its name lands in
   * `blockingUnknowns`. That asymmetry IS INV-R11's first half: a failure cannot contribute a
   * timestamp, so it can never extend freshness.
   */
  axes: ReadonlyArray<{ axis: ResolutionAxis; at: string | null }>
  now: string
  cadenceDays?: number
}

function parseInstant(value: string, label: string): number {
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) {
    throw new Error(`resolution: ${label} must be a parseable ISO-8601 instant, got ${JSON.stringify(value)}`)
  }
  return ms
}

/**
 * Decide §P4's five fields from the axes that actually resolved.
 *
 * `status` is decided by the OLDEST measured axis, never the newest. A subject whose registry entry
 * we observed today but whose vulnerability evidence we last resolved six months ago is not fresh;
 * §P4 states exactly this case (Registry 未变化不代表 vulnerability evidence 未过期). Taking the
 * newest would let one cheap, fast axis mask every expensive one.
 *
 * `lastSuccessfulResolution` is the NEWEST, because that is the question it asks — when did we last
 * succeed at anything. The two therefore come from opposite ends of `basis` on purpose, and
 * `nextRequiredResolution` can legitimately fall BEFORE `lastSuccessfulResolution`: that is the
 * honest signal that one axis is already overdue even though another resolved recently.
 *
 * With no measured axis the answer is `UNKNOWN` with null instants — never FRESH by default, and
 * never a state carried over from a previous bake (this function has no memory of one).
 */
export function computeResolution(input: ComputeResolutionInput): Resolution {
  const cadenceDays = input.cadenceDays ?? CADENCE_DAYS
  if (!Number.isFinite(cadenceDays) || cadenceDays <= 0) {
    throw new Error(`resolution: cadenceDays must be a positive finite number, got ${String(cadenceDays)}`)
  }
  const nowMs = parseInstant(input.now, "now")
  const blockingUnknowns: string[] = []
  const basis: ResolutionBasis[] = []
  for (const candidate of input.axes) {
    if (candidate.at === null) {
      blockingUnknowns.push(candidate.axis)
      continue
    }
    const atMs = parseInstant(candidate.at, `axes[${candidate.axis}].at`)
    basis.push({
      axis: candidate.axis,
      at: candidate.at,
      // Floored, and floored at zero: a clock-skewed `now` earlier than the observation reports age
      // 0, never a negative age that would read as "resolved in the future". Same shape as
      // `computeFreshness`, so the two calculators cannot disagree about what "20 days old" means.
      ageDays: Math.max(0, Math.floor((nowMs - atMs) / MS_PER_DAY)),
    })
  }
  // Deterministic order regardless of how the caller listed the axes, so the emitted bytes are a
  // function of the axes' VALUES and not of the call site's argument order.
  basis.sort((a, b) => (a.axis < b.axis ? -1 : a.axis > b.axis ? 1 : 0))

  if (basis.length === 0) {
    return { status: "UNKNOWN", basis, lastSuccessfulResolution: null, nextRequiredResolution: null, blockingUnknowns, cadenceDays }
  }

  const instants = basis.map((b) => parseInstant(b.at, "basis.at"))
  const oldestMs = Math.min(...instants)
  const newestMs = Math.max(...instants)
  const oldestAgeDays = Math.max(0, Math.floor((nowMs - oldestMs) / MS_PER_DAY))
  // Thresholds as MULTIPLES of the shared constants, never as literals: a test that restated `7`
  // and `21` here would agree with a mutated constant instead of catching it.
  const status: ResolutionStatus =
    oldestAgeDays <= cadenceDays ? "FRESH" : oldestAgeDays <= cadenceDays * AGING_MULTIPLE ? "AGING" : "STALE"
  return {
    status,
    basis,
    lastSuccessfulResolution: new Date(newestMs).toISOString(),
    // The deadline the WEAKEST axis sets. Derived from `oldestMs`, so a fast axis cannot push the
    // deadline out — the same reason `status` reads the oldest end of `basis`.
    nextRequiredResolution: new Date(oldestMs + cadenceDays * MS_PER_DAY).toISOString(),
    blockingUnknowns,
    cadenceDays,
  }
}

/**
 * The cadence a 5-field cron expression actually implies, in days.
 *
 * WHY THIS EXISTS. `CADENCE_DAYS = 7` was justified in prose — both `freshness.ts` and
 * `freshness.test.ts` name `.github/workflows/trust-ingest.yml`'s `cron: "17 6 * * 1"` — but no gate
 * read that file. Moving the schedule to daily would have left the constant describing a cron that
 * no longer existed, with every test still green, because the assertion restated the literal (`7`)
 * rather than deriving it. This is the same failure shape as
 * `expansion-eligibility.test.ts`'s `timeout-minutes` before it was read rather than copied.
 *
 * Pure, so the calculator stays I/O-free; the accompanying test does the reading.
 *
 * Refuses rather than guesses. Only the two shapes the project actually uses are decodable —
 * daily (`* *` in the day fields) and single-day weekly. A step, a list, or a pinned day-of-month
 * throws, because inventing a plausible period for `0 6 * * 1,4` would silently install a wrong
 * cadence, and a loud failure asks a human for the number instead.
 */
export function cadenceDaysFromCron(expr: string): number {
  const f = expr.trim().split(/\s+/)
  if (f.length !== 5) {
    throw new Error(`resolution: expected a 5-field cron expression, got ${f.length} field(s): ${JSON.stringify(expr)}`)
  }
  // Indexed reads, not a destructure: `noUncheckedIndexedAccess` types every element
  // `string | undefined` and the length check above does not narrow a tuple out of an array.
  const dom = f[2] ?? ""
  const dow = f[4] ?? ""
  const undecodable = (why: string): never => {
    throw new Error(
      `resolution: cannot derive a cadence from cron ${JSON.stringify(expr)} — ${why}. ` +
        "Pass an explicit cadenceDays rather than letting a guessed period stand in for the schedule.",
    )
  }
  if (dom !== "*") undecodable("a pinned day-of-month is monthly or irregular")
  if (dow === "*") return 1
  if (/^[0-7]$/.test(dow)) return 7
  return undecodable("only `*` (daily) or a single day-of-week (weekly) is decodable")
}
