/**
 * assertCohortConservation — the reader the projection never had.
 *
 * ADR 0085's sharpest finding was not that a hash chose a subject's current version. It was
 * that **nothing noticed**. The projection dropped 58 of 293 live subjects — a fifth of the
 * mirror — and every gate stayed green, because no guard in this package compared what went
 * INTO the projection against what came OUT. The count ratchet cannot: it measures the
 * cohort's magnitude against its own previous value, so a projection that has always dropped
 * a fifth reports a stable number forever (ADR 0084's whole subject). `assertMirrorComplete`
 * cannot either: it measures the READ, and the read was complete.
 *
 * So this guard measures the one relation nothing else does:
 *
 *   subjects live in the MIRROR  ==  subjects SERVED + subjects the CAP excluded
 *
 * KEYED ON THE OBSERVABLE, NOT THE MECHANISM. It asks "is a live subject missing?", never
 * "did the ORDER BY pick right?". That is deliberate and it is the lesson of
 * `a-trigger-keyed-to-the-mechanism-misses-the-subject`: a guard written against D1's window
 * function would go green the moment the defect moved to the filter, the cap, or the entry
 * mapper. This one reds for any of them, including mechanisms that do not exist yet.
 *
 * THE DIFFERENCE IS PARTITIONED, NOT TOTALLED. A bare inequality would be useless here
 * because one exclusion is designed and the other is a defect:
 *
 *   - `droppedByCap` — live, current, and outside ADR 0074's alphabetical ceiling. EXPECTED.
 *     Reported with a count so a log line can state it, never thrown on. At cohort 100 of 293
 *     live subjects this is 193, and a guard that treated it as a fault would refuse every run.
 *   - `droppedByUpstreamWithdrawal` — the chosen row IS the source's latest, and the source
 *     marks it deprecated. EXPECTED, as of ADR 0095. Reported with a count, never thrown on.
 *   - `droppedByStaleCurrentRow` — live SOMEWHERE in the mirror, and the row chosen to
 *     represent the subject is neither live NOR the source's latest. This is the 58-subject
 *     class exactly, stated without reference to what chose the row. FAILS CLOSED.
 *
 * THE THIRD AND SECOND CLASSES ARE SPLIT BY THE SOURCE'S OWN `isLatest`, and that split is
 * total over the subjects that reach it. A subject only enters this partition by holding an
 * `active`/`isLatest` row somewhere, so its chosen row is one of exactly two things: also
 * `isLatest` — the source states this version is current, and states it is deprecated, which is
 * a withdrawal — or not `isLatest`, meaning the ordering seated a non-current row while a
 * current one existed, which is ADR 0085's defect and nothing else. A subject with no
 * `isLatest` row anywhere never reaches here, because such a subject is not live in the mirror
 * either.
 *
 * `isLatest` is the discriminator rather than a recomputed "which row is most current" because
 * ADR 0085 D1 made it the PRIMARY sort key: a guard that re-derived currency would be a second
 * copy of the ordering, and `a-guard-importing-one-of-two-copies` is how the two drift.
 *
 * WHAT THIS USED TO DO, AND WHY IT CHANGED. Both classes refused, on the grounds that "whether
 * a subject with two latest-marked versions — one active, one deprecated — belongs in a trust
 * cohort is a product judgement" and ADR 0085 was written because this code answered a product
 * question (withdrawal vs version bump) by accident and got it backwards. The refusal was
 * right: it held the question open instead of guessing. The question is now ANSWERED (ADR 0095
 * — upstream deprecation of the latest version removes the subject from the cohort), so the
 * placeholder retires and the guard keeps only the branch that indicts the projection.
 *
 * The refusal was also never a defence of a different policy. Measured on the real store the
 * day it first fired: 291 subjects had a `deprecated`/`isLatest` chosen row and 290 of them
 * were ALREADY leaving the cohort silently, having been first mirrored after the deprecation so
 * that no live row was in their history. Only the 1 subject mirrored while active and deprecated
 * later could trip the guard. It fired on the one case it could see, not on a distinct policy.
 *
 * WHY THE REMAINING BRANCH STILL FAILS CLOSED. After ADR 0085 D1 it is zero on real data —
 * measured over the 1200-row store: 298 subjects, 293 live in the mirror, 293 emitted, 0
 * unaccounted, and over the 25,766-subject store: 0. Refusing to project is recoverable in one
 * run; shipping a snapshot short by a fifth was invisible for two releases. Same argument
 * `assertMirrorComplete` already makes about a truncated read.
 *
 * The error NAMES the subjects. A guard that reports "3 dropped" without saying which three
 * hands the operator a number they cannot act on, and the count is the part they can already
 * see in the artifact.
 */
import type { SourceRecordV1 } from "../domain/sourceRecord.js"
import { isLiveCohort, projectSnapshot, type ProjectedSnapshot } from "../projections/snapshotProjection.js"

export interface CohortConservation {
  /** Distinct subjects holding at least one live row ANYWHERE in the mirror, history included. */
  liveInMirror: number
  /** Subjects whose CURRENT row is live — the population the projection filters down from. */
  currentLive: number
  /** Entries in the committed snapshot. */
  served: number
  /**
   * Live, current, and excluded by ADR 0074's cap. Expected; the cohort is a ceiling.
   *
   * Names, not native ids, because the cap operates on the projected entry's `name` — the key
   * space the ceiling is actually applied in. Reporting native ids here would name a different
   * thing than the mechanism that excluded them.
   */
  droppedByCap: readonly string[]
  /**
   * Was live in the mirror; the source now marks its latest version deprecated. Expected.
   *
   * Reported rather than merely subtracted. A withdrawal is the one exclusion that shrinks the
   * cohort for a reason outside this system, so the run that shrinks must be able to say which
   * subject left — otherwise a real withdrawal and a projection defect present as the same
   * smaller number, which is ADR 0084's subject.
   */
  droppedByUpstreamWithdrawal: readonly string[]
  /**
   * Live somewhere in the mirror, yet the row representing the subject is neither live nor the
   * source's own latest — so nothing outside this system explains the drop.
   *
   * Native ids, because no entry was ever projected for these subjects — they have no name in
   * the cohort's key space. That asymmetry with `droppedByCap` is the point: these two sets are
   * excluded by different machinery at different stages and are not interchangeable.
   */
  droppedByStaleCurrentRow: readonly string[]
}

/**
 * Thrown when a live subject left the projection for a reason the cap does not explain.
 *
 * Named so a caller can catch this and nothing else, as `MirrorIncompleteError` is.
 */
export class CohortConservationError extends Error {
  readonly conservation: CohortConservation
  constructor(conservation: CohortConservation, detail: string) {
    super(
      `cohort conservation failed: ${detail} ` +
        `(${conservation.liveInMirror} live in mirror, ${conservation.currentLive} current, ` +
        `${conservation.served} served, ${conservation.droppedByCap.length} excluded by the cap). ` +
        `A projection that drops a live subject for an unexplained reason produces a snapshot that ` +
        `is well-formed, passes every schema check, and is quietly short — the defect ADR 0085 ` +
        `measured at 58 subjects. Refusing to emit is recoverable; emitting a short cohort is not ` +
        `detectable without the source.`,
    )
    this.name = "CohortConservationError"
    this.conservation = conservation
  }
}

export interface MeasureCohortConservationOptions {
  /** Every row the mirror holds for this source, history included. */
  allRecords: readonly SourceRecordV1[]
  /** The current row per subject — exactly what was handed to `projectSnapshot`. */
  currentRecords: readonly SourceRecordV1[]
  /** The projection that was actually produced from `currentRecords`. */
  snapshot: ProjectedSnapshot
}

/**
 * Measure the relation. Pure, and separate from the assertion on purpose.
 *
 * Split for the same reason `syncSource` reports `capReached` on its result and
 * `assertMirrorComplete` throws on it: the NUMBERS belong in the run's output so a log line can
 * say "293 live = 100 served + 193 capped", and a test needs to read them without catching an
 * exception. A guard whose only output is a throw can only ever be observed failing.
 *
 * `isLiveCohort` is imported rather than restated in SQL. The predicate exists once, and the
 * guard applies the SAME function the projection filters on — otherwise the two could drift and
 * the guard would compare the projection against a subtly different definition of "live", which
 * is `a-guard-importing-one-of-two-copies` with an extra step.
 */
export function measureCohortConservation(opts: MeasureCohortConservationOptions): CohortConservation {
  const liveInMirror = new Set(
    opts.allRecords.filter(isLiveCohort).map((r) => r.source.sourceRecordId),
  )
  const currentLive = opts.currentRecords.filter(isLiveCohort)
  const currentLiveIds = new Set(currentLive.map((r) => r.source.sourceRecordId))

  // Re-project with a ceiling that CANNOT bind, then diff. `droppedByCap` is therefore
  // MEASURED against the shipped `selectCohortEntries` — reserved names, clamp and all —
  // rather than defined as `currentLive - served`, which would make the identity below
  // arithmetically true no matter what the cap did. `currentRecords.length` is an upper bound
  // on the live subset, so `byName.length <= max` short-circuits and no slice happens.
  const uncapped = projectSnapshot({
    records: opts.currentRecords,
    endpoint: opts.snapshot.endpoint,
    fetchedAt: opts.snapshot.fetchedAt,
    maxEntries: opts.currentRecords.length,
  })
  const servedNames = new Set(opts.snapshot.entries.map((e) => e.name))
  const droppedByCap = uncapped.entries.map((e) => e.name).filter((n) => !servedNames.has(n))

  // Split by the source's own statement of currency, not by a recomputation of it. A subject
  // reaches here only by holding a live row in history, so a chosen row that is ALSO `isLatest`
  // can only mean the source has since marked its current version deprecated — a withdrawal
  // (ADR 0095). Anything else seated a non-current row while a current one existed: ADR 0085.
  //
  // A subject with NO chosen row at all lands in `stale` rather than `withdrawn`. That is
  // unreachable through the real reads — the current row is one of the rows — and the fail-closed
  // side is the right home for a state that means the two reads disagree.
  const chosenById = new Map(opts.currentRecords.map((r) => [r.source.sourceRecordId, r]))
  const droppedByUpstreamWithdrawal: string[] = []
  const droppedByStaleCurrentRow: string[] = []
  for (const id of [...liveInMirror].sort()) {
    if (currentLiveIds.has(id)) continue
    if (chosenById.get(id)?.lifecycle.isLatest === true) droppedByUpstreamWithdrawal.push(id)
    else droppedByStaleCurrentRow.push(id)
  }

  return {
    liveInMirror: liveInMirror.size,
    currentLive: currentLive.length,
    served: opts.snapshot.count,
    droppedByCap,
    droppedByUpstreamWithdrawal,
    droppedByStaleCurrentRow,
  }
}

/**
 * Fail CLOSED on any live subject the cap does not account for.
 *
 * Three distinct refusals, because three different things can be wrong and collapsing them
 * would hand the operator one message for three remedies:
 *
 *   1. a current row is live but no row in the mirror is — arithmetically impossible, since a
 *      current row IS a row. Reachable only if the two reads disagree about which rows exist,
 *      so it is checked rather than assumed. This is the one branch that indicts the STORE.
 *   2. a live subject dropped with neither the cap NOR an upstream withdrawal to explain it —
 *      the ADR 0085 class. Withdrawal is excluded here rather than at the measurement, so the
 *      run still reports which subjects left and why (ADR 0095).
 *   3. the partition does not add up — every subject is accounted for individually and the
 *      totals still disagree, which means one of the four populations was miscounted. A guard
 *      that checked only the sets could pass here while reporting a number the artifact
 *      contradicts.
 */
export function assertCohortConserved(conservation: CohortConservation): void {
  if (conservation.currentLive > conservation.liveInMirror) {
    throw new CohortConservationError(
      conservation,
      `${conservation.currentLive} subjects have a live current row but only ` +
        `${conservation.liveInMirror} have a live row at all, which cannot happen — the current ` +
        `row is one of the rows. The two reads disagree about the mirror's contents`,
    )
  }

  if (conservation.droppedByStaleCurrentRow.length > 0) {
    throw new CohortConservationError(
      conservation,
      `${conservation.droppedByStaleCurrentRow.length} subject(s) are live in the mirror but the ` +
        `row chosen to represent them is neither live nor the source's latest, so they were ` +
        `dropped before the cap was applied: ${conservation.droppedByStaleCurrentRow.join(", ")}`,
    )
  }

  const accounted =
    conservation.served +
    conservation.droppedByCap.length +
    conservation.droppedByUpstreamWithdrawal.length +
    conservation.droppedByStaleCurrentRow.length
  if (accounted !== conservation.liveInMirror) {
    throw new CohortConservationError(
      conservation,
      `the partition does not add up: ${conservation.served} served + ` +
        `${conservation.droppedByCap.length} capped + ` +
        `${conservation.droppedByUpstreamWithdrawal.length} withdrawn + ` +
        `${conservation.droppedByStaleCurrentRow.length} stale = ${accounted}, against ` +
        `${conservation.liveInMirror} live in the mirror`,
    )
  }
}

/**
 * One line for a run log — the partition, stated on every run rather than only on a refusal.
 *
 * ADR 0085's Consequences require that when the cohort grows on the next full ingest, "the run's
 * log must say why the number moved". A count alone cannot: `100 current subject(s)` reads
 * identically whether the projection served everything it was given or silently dropped a fifth of
 * it, which is exactly the indistinguishability ADR 0085 measured at 58 subjects. The guard above
 * already refuses the unexplained case, but a guard that speaks only when it throws leaves the
 * successful run unmeasured — and the run that matters here SUCCEEDS while the number jumps.
 *
 * So the identity is printed: `live = served + capped + withdrawn + stale`. An operator reading a
 * large positive delta against a stated `served` and a stated `capped` can tell a correction from
 * adoption without querying the store, which is the whole point — ADR 0083's ratchet measures
 * magnitude and will see the jump, and magnitude is not a cause.
 *
 * `withdrawn` earns its clause for the opposite reason to `capped`: it moves the cohort DOWN, and
 * a shrink is the delta most easily misread as a defect. Naming the subjects at the point the
 * cohort loses them is what makes an upstream deprecation legible as such (ADR 0095).
 *
 * The `capped` clause is OMITTED when nothing was capped, following `describeArtifactResolution`:
 * "0 excluded by the cap" and "the ceiling did not bind on this run" are different facts, and a
 * row of zeros reads as a measurement nobody took.
 */
export function describeCohortConservation(c: CohortConservation): string {
  const capped = c.droppedByCap.length > 0 ? `, ${c.droppedByCap.length} capped` : ""
  // Named, not just counted, and capped at a handful so one mass deprecation cannot bury the
  // rest of the line. The names are the actionable part: `1 withdrawn` tells an operator the
  // cohort shrank, and only the subject tells them whether that is news.
  const w = c.droppedByUpstreamWithdrawal
  const withdrawn =
    w.length > 0
      ? `, ${w.length} withdrawn upstream (${w.slice(0, 5).join(", ")}${w.length > 5 ? ", …" : ""})`
      : ""
  // `stale` is normally absent: `assertCohortConserved` throws on a non-empty set, so a caller
  // that printed this after asserting can only ever see 0. Kept for the pre-assert caller and
  // because a silent 0 here would be the one number worth seeing if that ordering ever changes.
  const stale =
    c.droppedByStaleCurrentRow.length > 0 ? `, ${c.droppedByStaleCurrentRow.length} stale` : ""
  return `cohort: ${c.liveInMirror} live in mirror = ${c.served} served${capped}${withdrawn}${stale}`
}
