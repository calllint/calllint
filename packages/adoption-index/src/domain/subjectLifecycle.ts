/**
 * subjectLifecycle — the permitted moves of a subject's `AdoptionLifecycleStatus`, as one table.
 *
 * Same shape, and for the same reasons, as `artifactTransitions.ts` and `jobStates.ts`: a table
 * keeps the PREVIOUS value in scope, which is the one thing a SQLite CHECK constraint cannot see.
 * `migrations/003` therefore declares `lifecycle_status` as a bare `TEXT NOT NULL DEFAULT 'ACTIVE'`
 * and leaves every transition rule here.
 *
 * THE VOCABULARY IS REUSED, NOT INVENTED. `ADOPTION_LIFECYCLE_STATUSES` was frozen at R-7 with zero
 * producers; this module and `applyWithdrawal` are its first. `adoptionRecord.ts` already states that
 * `WITHDRAWN` "is a conclusion drawn from a record's disappearance" — that disappearance is
 * `refreshFromMirror`'s `absentFromSource`, so this is the mechanism that docblock described.
 *
 * THE LOAD-BEARING RULE IS THAT A TRUNCATED RUN CANNOT DESTROY DATA. This is not hypothetical: a
 * measured job timeout on this workstream (653 pages / 7090 s) exits with a PARTIAL cohort, and a
 * partial cohort makes every unobserved subject look absent. Two rules together make that harmless:
 *
 *   - `WITHDRAWN -> ACTIVE` is PERMITTED, so re-observation heals a false withdrawal by itself;
 *   - `TOMBSTONED` is TERMINAL, and is never reachable from an automatic path — `applyWithdrawal`
 *     writes `WITHDRAWN` only. Tombstoning requires an explicit, separately-authorized call.
 *
 * So the worst a truncation can do is mark subjects `WITHDRAWN` and have the next full run undo it.
 * If `WITHDRAWN -> ACTIVE` were forbidden "because withdrawal is final", one CI timeout would
 * permanently de-list every subject it failed to reach. INV-R12 (withdrawal is not deletion) is what
 * makes that recoverable: the row, its history, and its receipts all survive a withdrawal untouched.
 *
 * SELF-TRANSITIONS ARE PERMITTED for every non-terminal status, because the writer is idempotent and
 * a replay re-asserts the status it already holds — the same allowance `ARTIFACT_TRANSITIONS` makes
 * for `RESOLVED -> RESOLVED`.
 */
import { ADOPTION_LIFECYCLE_STATUSES, type AdoptionLifecycleStatus } from "./adoptionRecord.js"

/**
 * `from -> [permitted to]`, exhaustive over the frozen vocabulary.
 *
 *  - `ACTIVE -> DEPRECATED`      the source now says deprecated (lowercase, mirrored, then concluded)
 *  - `ACTIVE -> WITHDRAWN`       observed absent from a cohort that DID complete
 *  - `DEPRECATED -> ACTIVE`      a source un-deprecates; nothing forbids it, so nothing here does
 *  - `WITHDRAWN -> ACTIVE`       RE-OBSERVED. The truncation escape hatch above.
 *  - `WITHDRAWN -> DEPRECATED`   re-observed AND deprecated in the same run
 *  - `WITHDRAWN -> TOMBSTONED`   an explicit, human-authorized conclusion that it is gone for good
 *  - `TOMBSTONED -> {}`          TERMINAL. Resurrection would silently re-list a de-listed subject.
 */
export const SUBJECT_LIFECYCLE_TRANSITIONS: Readonly<
  Record<AdoptionLifecycleStatus, readonly AdoptionLifecycleStatus[]>
> = Object.freeze({
  ACTIVE: Object.freeze<AdoptionLifecycleStatus[]>(["ACTIVE", "DEPRECATED", "WITHDRAWN"]),
  DEPRECATED: Object.freeze<AdoptionLifecycleStatus[]>(["DEPRECATED", "ACTIVE", "WITHDRAWN"]),
  WITHDRAWN: Object.freeze<AdoptionLifecycleStatus[]>(["WITHDRAWN", "ACTIVE", "DEPRECATED", "TOMBSTONED"]),
  TOMBSTONED: Object.freeze<AdoptionLifecycleStatus[]>([]),
})

/**
 * The table's keys are EXACTLY the frozen vocabulary, asserted at runtime and not only by `Record`.
 *
 * `Record<AdoptionLifecycleStatus, …>` is two-sided in the type checker — an object literal missing a
 * key or carrying an excess one both fail `tsc` — but that check is ERASED, so it cannot see a value
 * that arrives from SQLite. This module is also the one place that can compare the table against
 * `ADOPTION_LIFECYCLE_STATUSES` as VALUES, which is what keeps the import load-bearing rather than
 * decorative. Thrown at module load: a table that disagrees with its own vocabulary is a defect that
 * must not be reachable by a caller, and every consumer below indexes it unguarded.
 */
const TRANSITION_KEYS = Object.keys(SUBJECT_LIFECYCLE_TRANSITIONS).sort()
const VOCABULARY_KEYS = [...ADOPTION_LIFECYCLE_STATUSES].sort()
if (TRANSITION_KEYS.join(",") !== VOCABULARY_KEYS.join(",")) {
  throw new Error(
    `subjectLifecycle: transition table keys [${TRANSITION_KEYS.join(", ")}] do not match ` +
      `ADOPTION_LIFECYCLE_STATUSES [${VOCABULARY_KEYS.join(", ")}]`,
  )
}

/**
 * The statuses a subject never moves away from.
 *
 * Derived from the table rather than restated, so the two cannot disagree — the same reason
 * `isTerminalArtifactStatus` is a predicate over `ARTIFACT_TRANSITIONS`.
 */
export function isTerminalLifecycle(status: AdoptionLifecycleStatus): boolean {
  return SUBJECT_LIFECYCLE_TRANSITIONS[status].length === 0
}

/** True when `to` may follow `from`. */
export function canTransitionLifecycle(from: AdoptionLifecycleStatus, to: AdoptionLifecycleStatus): boolean {
  return SUBJECT_LIFECYCLE_TRANSITIONS[from].includes(to)
}

/**
 * Throw unless `from -> to` is permitted.
 *
 * Called INSIDE the write transaction, so a refused transition rolls back that one subject and leaves
 * the row exactly as it was. Throwing rather than returning a boolean matches
 * `assertArtifactTransition`: the quiet alternative — skipping the update — would leave the run
 * reporting success while the database disagreed with it.
 */
export function assertLifecycleTransition(
  from: AdoptionLifecycleStatus,
  to: AdoptionLifecycleStatus,
  subjectId: string,
): void {
  if (!canTransitionLifecycle(from, to)) {
    throw new Error(
      `subject "${subjectId}": ${from} -> ${to} is not a permitted lifecycle transition` +
        (isTerminalLifecycle(from) ? ` (${from} is terminal)` : ""),
    )
  }
}
