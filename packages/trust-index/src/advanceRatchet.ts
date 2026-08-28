/**
 * Advance Gate S0's regression ratchet to a cohort that has just been committed.
 *
 * WHY THIS FILE EXISTS. ADR 0083 made `S0_REGRESSION_FLOOR` a ratchet pinned to the committed
 * cohort, and named the route by which it moves: "ingest, then the test's derived pin reds until
 * the floor follows. The ordering is deliberate — the floor may never lead the cohort." That is
 * still exactly right, and nothing here changes it. What ADR 0083 could not know is that the
 * Cumulative Coverage Amendment would make ingest AUTOMATIC and WEEKLY, which turned "a human
 * advances the floor after an authorized expansion" into a chore that recurs every Sunday and reds
 * the bot's own PR until someone performs it by hand. A guard whose green depends on a weekly
 * manual edit is a guard that will eventually be edited the cheap way — downward. ADR 0091.
 *
 * THE RATCHET PROPERTY IS PRESERVED BY `Math.max`, NOT BY THE HUMAN. The floor advances to the
 * committed cohort when the cohort GREW, and holds when it shrank. So a lost record still reds:
 * the floor stays at the old high-water mark, `gate-s0.ts`'s load-time coherence check sees a floor
 * above the committed cohort and exits 2, and the derived pin in
 * `tests/invariants/gate-s0-claims.invariants.test.ts` reds too. Neither the gate nor the pin is
 * weakened; the only thing removed is the human keystroke on the GROWTH direction, which was never
 * the direction the ratchet defends.
 */
import { readFileSync, writeFileSync } from "node:fs"

/** Matches the ratchet declaration and nothing else. Anchored per-line, as the gate declares it. */
const FLOOR_DECL = /^const S0_REGRESSION_FLOOR = (\d+)$/m

export interface RatchetAdvance {
  /** The floor before this call. */
  readonly from: number
  /** The floor after this call — `max(from, committedCohort)`. */
  readonly to: number
  /** False when the floor already covered the cohort (a hold, or a shrink). */
  readonly advanced: boolean
}

/**
 * Compute the next floor. Pure, so the monotonicity can be asserted without touching a file.
 *
 * `Math.max` is the whole safety argument: this function CANNOT lower a floor, whatever it is
 * handed. A shrunken cohort returns the old floor unchanged and leaves the gate to red on it.
 */
export function nextRatchetFloor(current: number, committedCohort: number): number {
  return Math.max(current, committedCohort)
}

/**
 * Rewrite the ratchet in `gate-s0.ts` to cover `committedCohort`, returning what moved.
 *
 * Throws when the declaration is absent rather than appending one: a renamed constant means the
 * gate's shape changed, and silently writing a fresh line would create a second floor the gate
 * does not read. Only the matched declaration's digits are replaced, so the surrounding prose —
 * which explains why the number is what it is — survives untouched.
 */
export function advanceRatchetFloor(gatePath: string, committedCohort: number): RatchetAdvance {
  if (!Number.isInteger(committedCohort) || committedCohort < 0) {
    throw new RangeError(`advanceRatchetFloor needs a non-negative integer cohort, got ${committedCohort}`)
  }
  const src = readFileSync(gatePath, "utf8")
  const found = FLOOR_DECL.exec(src)
  if (found === null) {
    throw new Error(
      `${gatePath} declares no \`const S0_REGRESSION_FLOOR = <number>\` — the ratchet cannot be advanced blind`,
    )
  }
  const from = Number(found[1])
  const to = nextRatchetFloor(from, committedCohort)
  if (to === from) return { from, to, advanced: false }
  writeFileSync(gatePath, src.replace(FLOOR_DECL, `const S0_REGRESSION_FLOOR = ${to}`), "utf8")
  return { from, to, advanced: true }
}
