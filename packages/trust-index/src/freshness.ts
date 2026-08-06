/**
 * Workstream S PR S-2 — the freshness calculator. Closes the last unblocked measured
 * absence in `artifacts/adoption-index-v1/current-gaps.md` §1.4:
 *
 *   "No module under `packages/*​/src` computes freshness. Evidence *level* ships
 *    (`evidenceLevel.test.ts`); freshness does not. This is the calculation the ROLLING
 *    half of the compiler exists to feed, so its absence is what makes 'rolling'
 *    currently unrepresentable."
 *
 * WHAT THIS IS NOT. Freshness is a DISPLAY axis, exactly like `evidenceLevel` next door.
 * ADR 0053 §5 forbids multiplying or averaging the independent dimensions into a single
 * "trust score", and `computeVerdict` remains the only verdict engine (ADR 0061 §4). A
 * stale page is not a less-safe page; it is a page whose observation is older. Nothing
 * here reads, returns, or influences a verdict.
 *
 * WHY IT IS PURE, AND WHY `now` IS A PARAMETER. `observedAt` is sealed INSIDE
 * `pageDigest` (`bakeTrustPage.ts` — `hashJson({canonicalName, verdict, preparation, scan,
 * observedAt})`). Freshness is `f(observedAt, now)`, so a freshness field inside the page
 * body would make all 39 page digests a function of the wall clock: every bake would move
 * every byte and the reproducibility gate (ADR 0046 §4) would red daily. So this module
 * takes an INJECTED `now` and never reads a clock — the same discipline the store states at
 * `adoption-index/src/storage/store.ts` ("with an INJECTED `now`. Not `CURRENT_TIMESTAMP`,
 * not `Date.now()`"), and its output lands OUTSIDE `pageDigest`.
 */
import { FIXTURE_OBSERVED_AT } from "./cohort.js"

/**
 * The ingestion cadence, in days, that the thresholds below are derived from.
 *
 * DERIVED, NOT INVENTED: `.github/workflows/trust-ingest.yml` runs `cron: "17 6 * * 1"` —
 * weekly, Monday 06:17 UTC. Absolute day constants would be a silent drift surface: moving
 * the cron to daily would leave a 7-day "FRESH" window describing a schedule that no longer
 * exists. Expressing the thresholds as MULTIPLES of the cadence means changing the cron
 * changes them with it.
 */
export const CADENCE_DAYS = 7

/**
 * How many cadence periods a snapshot may lag before it stops being merely `AGING`.
 * Three means "we missed up to two consecutive runs" — recoverable and worth showing,
 * distinct from a pipeline that has actually stopped.
 */
export const AGING_MULTIPLE = 3

/** Milliseconds in a day. Named so the two planes cannot disagree about the divisor. */
const MS_PER_DAY = 86_400_000

/**
 * `TIMELESS` is load-bearing, not a convenience member.
 *
 * 20 of the 39 served entries are fixtures pinned to `FIXTURE_OBSERVED_AT`, and `cohort.ts`
 * states why: "Fixtures are timeless anchors, so 'observed at' is a fixed epoch marker, not
 * a wall-clock read." Feeding that anchor through a subtraction would report every fixture
 * as ~20 700 days stale — a false statement about half the corpus, and one that would push a
 * reader toward "the pipeline is broken" when the pipeline is fine.
 */
export type FreshnessState = "FRESH" | "AGING" | "STALE" | "TIMELESS"

export interface Freshness {
  /** Whole days between `observedAt` and `now`. `null` exactly when `TIMELESS`. */
  ageDays: number | null
  state: FreshnessState
  /** Echoed so a consumer can re-derive the thresholds without importing this module. */
  cadenceDays: number
  /** Which time axis produced this — an audit field, never a score input. */
  basis: "snapshot-fetchedAt" | "fixture-anchor"
}

export interface ComputeFreshnessInput {
  /** The page's sealed observation time (ISO-8601 UTC). */
  observedAt: string
  /** Injected wall clock (ISO-8601 UTC). Never read from `Date.now()` inside this module. */
  now: string
  /** Overridable only so a test can assert the derivation; production uses the default. */
  cadenceDays?: number
}

function parseInstant(value: string, field: string): number {
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) {
    throw new Error(
      `computeFreshness: \`${field}\` is not a parseable ISO-8601 instant (received ${JSON.stringify(value)}) — ` +
        "a silently-zero age would report a stale corpus as FRESH, which is the same class of hazard as a blank " +
        "grouping key and is refused for the same reason",
    )
  }
  return ms
}

/**
 * Project an observation time onto the freshness display axis. Pure: no clock, no I/O.
 *
 * Fails CLOSED on an unparseable instant rather than defaulting to zero. A zero age would
 * render as FRESH — the single most misleading value this function could return — so the
 * refusal is the safe branch, following `compileEvidence`'s precedent for a degenerate input.
 */
export function computeFreshness(input: ComputeFreshnessInput): Freshness {
  const cadenceDays = input.cadenceDays ?? CADENCE_DAYS
  if (!Number.isFinite(cadenceDays) || cadenceDays <= 0) {
    throw new Error(
      `computeFreshness: \`cadenceDays\` must be a positive finite number (received ${JSON.stringify(input.cadenceDays)}) — ` +
        "a zero or negative cadence makes every threshold collapse onto one value",
    )
  }

  // The anchor is recognised by EXACT equality with the imported constant, never by a
  // magnitude heuristic ("anything before 2000 is a fixture"). A heuristic would also
  // swallow a genuinely ancient real entry, silently converting a real staleness signal
  // into "timeless" — the failure mode that matters most here.
  if (input.observedAt === FIXTURE_OBSERVED_AT) {
    return { ageDays: null, state: "TIMELESS", cadenceDays, basis: "fixture-anchor" }
  }

  const observedMs = parseInstant(input.observedAt, "observedAt")
  const nowMs = parseInstant(input.now, "now")

  // Clamped at zero: an `observedAt` in the future is a clock-skew artefact, and a negative
  // age has no display meaning. It reads as FRESH, which is the honest projection of "this
  // was observed no earlier than now".
  const ageDays = Math.max(0, Math.floor((nowMs - observedMs) / MS_PER_DAY))

  const state: FreshnessState =
    ageDays <= cadenceDays ? "FRESH" : ageDays <= cadenceDays * AGING_MULTIPLE ? "AGING" : "STALE"

  return { ageDays, state, cadenceDays, basis: "snapshot-fetchedAt" }
}
