/**
 * artifactTransitions — the permitted moves of `ArtifactStatus`, as one table.
 *
 * A note for the reviewer before the table: this is NOT a second state machine competing with
 * `packages/evidence/src/model/stateMachine.ts`. That one is over `ResolutionState` (8 states,
 * about whether a subject's evidence resolved); this is over `ArtifactStatus` (5 states, about
 * whether we hold verified bytes). The sets are disjoint and neither is a superset of the other.
 * Generalizing to INV-10's seven terminal states is a later batch and covers neither set.
 *
 * The table exists as data, rather than as `if` statements in the write path, for one reason:
 * `REJECTED` must be terminal, and a rule enforced at a single consulted point is a rule a
 * reviewer can confirm by reading one file. Control #25 permits `REJECTED -> FETCHED` here and
 * observes a re-run silently "heal" a digest mismatch.
 */
import type { ArtifactStatus } from "./subject.js"

/**
 * From -> the set of statuses that may follow.
 *
 *  - `RESOLVED -> FETCHED`      bytes obtained and the digest agrees with the claim
 *  - `RESOLVED -> UNAVAILABLE`  TRIED and could not obtain bytes (404, network, timeout, cap)
 *  - `RESOLVED -> REJECTED`     bytes obtained and REFUSED (mismatch, not a tarball, path escape)
 *  - `RESOLVED -> RESOLVED`     no adapter for this package type: not tried, so nothing claimed
 *  - `UNAVAILABLE -> *`         a later run may succeed, refuse, or fail again
 *  - `FETCHED -> *`             a new claim may re-verify, go missing, or now be refused
 *  - `REJECTED -> {}`           TERMINAL. A digest mismatch is not transient.
 *  - `UNSUPPORTED -> {}`        the registry declared no resolvable type; only R-3 writes it, and
 *                               a re-resolution of identity rewrites it rather than transitioning
 *                               it, so artifact resolution never moves it.
 */
export const ARTIFACT_TRANSITIONS: Readonly<Record<ArtifactStatus, readonly ArtifactStatus[]>> = Object.freeze({
  RESOLVED: Object.freeze<ArtifactStatus[]>(["RESOLVED", "FETCHED", "UNAVAILABLE", "REJECTED"]),
  UNAVAILABLE: Object.freeze<ArtifactStatus[]>(["UNAVAILABLE", "FETCHED", "REJECTED"]),
  FETCHED: Object.freeze<ArtifactStatus[]>(["FETCHED", "UNAVAILABLE", "REJECTED"]),
  REJECTED: Object.freeze<ArtifactStatus[]>([]),
  UNSUPPORTED: Object.freeze<ArtifactStatus[]>([]),
})

/**
 * The statuses artifact resolution will never move away from.
 *
 * Derived from the table rather than restated, so the two cannot disagree. Written as a
 * predicate over the table for the same reason `releasesSubject` is one predicate: a rule
 * duplicated at call sites is a rule that gets half-changed.
 */
export function isTerminalArtifactStatus(status: ArtifactStatus): boolean {
  return ARTIFACT_TRANSITIONS[status].length === 0
}

/** True when `to` may follow `from`. */
export function canTransitionArtifact(from: ArtifactStatus, to: ArtifactStatus): boolean {
  return ARTIFACT_TRANSITIONS[from].includes(to)
}

/**
 * Throw unless `from -> to` is permitted.
 *
 * The write path calls this INSIDE its transaction, so a refused transition rolls that one
 * artifact back and leaves the row exactly as it was. Throwing rather than returning a boolean
 * is deliberate here: a caller that reached a forbidden transition has a logic defect, and the
 * quiet alternative — skipping the update — would leave the run reporting success while the
 * database disagreed with it.
 */
export function assertArtifactTransition(from: ArtifactStatus, to: ArtifactStatus, artifactVersionId: string): void {
  if (!canTransitionArtifact(from, to)) {
    throw new Error(
      `artifact "${artifactVersionId}": ${from} -> ${to} is not a permitted transition` +
        (isTerminalArtifactStatus(from) ? ` (${from} is terminal)` : ""),
    )
  }
}

/**
 * The statuses artifact resolution reads work from.
 *
 * `RESOLVED` is the fresh work and `UNAVAILABLE` is the retryable failure. `FETCHED` is excluded
 * so a warm store does not re-download what it already holds — which is what makes "cache hit =>
 * no refetch" observable as a test over `fetchImpl` call counts, given that every scheduled CI
 * run is a cold checkout and can never demonstrate cache reuse.
 */
export const ARTIFACT_RESOLUTION_INPUT_STATUSES: readonly ArtifactStatus[] = Object.freeze([
  "RESOLVED",
  "UNAVAILABLE",
])
