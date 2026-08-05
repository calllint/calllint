/**
 * jobStates — the permitted moves of `CompilerJobState` and `CompilerRunState`, as two tables.
 *
 * WHICH LAYER THIS IS, stated before the tables because the repository now holds SIX state
 * vocabularies and two of them share spellings with these. This file is the QUEUE: whether a unit
 * of compiler work is waiting, held, or finished. It is:
 *
 *   - NOT `ResolutionState` (8 states, `packages/evidence/src/model/stateMachine.ts`) — whether a
 *     subject's EVIDENCE resolved. That file is untouched by this batch.
 *   - NOT `ArtifactStatus` (5 states, `subject.ts:114`) — whether we hold VERIFIED BYTES.
 *   - NOT `IdentityStatus` (4 states, `subject.ts:61`) — what identity resolution CONCLUDED.
 *   - NOT `CheckpointStatus` (4 states, `checkpoint.ts:19`) — the position of one SOURCE's sync.
 *     The closest sibling: both grade a run, and `RUNNING` means the same thing in both.
 *   - NOT INV-10's seven terminal states (`SUPPORTED`, `LOCAL_PREFLIGHT_REQUIRED`, `UNSUPPORTED`,
 *     `DEPRECATED`, `TOMBSTONED`, `IDENTITY_CONFLICT`, `PROCESSING_FAILED`). Those are the
 *     compiler's CONCLUSION about one source record, and R-6 measured that no column in the
 *     canonical DDL carries them: `source_records.lifecycle_status` holds the source's own four
 *     lowercase values, `canonical_subjects.identity_status` holds R-3's four, and
 *     `artifact_versions.artifact_status` holds R-4's five. See `test/job-state-machine.test.ts`,
 *     which refuses either union naming any of the seven.
 *
 *     R-6 ALSO CONCLUDED, FROM THAT SAME MEASUREMENT, that `adoption_records.lifecycle_status` "is
 *     where they land, so they are R-7's to introduce". THAT INFERENCE IS FALSIFIED — inverted here
 *     rather than deleted, because the measurement above is still sound and only the forward pointer
 *     was wrong. R-7 wrote that column and it holds FOUR uppercase values
 *     (`ACTIVE|DEPRECATED|WITHDRAWN|TOMBSTONED`, `adoptionRecord.ts`), a fifth distinct vocabulary
 *     rather than the seven. Two of the seven (`DEPRECATED`, `TOMBSTONED`) do appear in it, which is
 *     exactly how the wrong inference was reached: a spelling overlap read as an identity. The seven
 *     belong to a GENERALIZED `packages/evidence/src/model/stateMachine.ts` (adrs/0061 §8), which
 *     R-7 left untouched, so they remain unintroduced by any batch to date.
 *
 * THREE OF THE FOUR RUN STATES SHARE A SPELLING WITH A JOB STATE OR A RESOLUTION STATE, and the
 * collision is in the committed schemas, not a choice available here: `SUCCEEDED`/`FAILED` appear in
 * both unions below and `PARTIAL` also names a `ResolutionState`. They are not the same fact. A job
 * `SUCCEEDED` means one unit of work finished; a run `SUCCEEDED` means a whole compiler pass did.
 * `ResolutionState.PARTIAL` is RE-QUEUEABLE and may still reach `PUBLISHED`; `CompilerRunState`'s
 * `PARTIAL` is TERMINAL, a final grade on a pass that compiled 24 of 25 subjects. Shared spellings
 * are exactly how two layers get fused by a later reader, so the unions are kept separate, closed,
 * and asserted closed.
 *
 * WHY TABLES RATHER THAN `if` STATEMENTS, the same reason as `artifactTransitions.ts`: the queue's
 * fail-closed rule is that `FAILED` and `DEAD_LETTER` are terminal and never re-run implicitly
 * (`calllint.compiler-job.v1`'s description, verbatim: "a job that silently retries forever is how a
 * compiler burns a rate limit and reports nothing"). A rule enforced at one consulted point is a
 * rule a reviewer confirms by reading one file. Controls #78 and #79 widen these tables and observe
 * a terminal job resurrect.
 *
 * NEITHER TABLE IS ENFORCED BY THE DATABASE. Measured: `migrations/001` declares `state TEXT NOT
 * NULL` on both `compiler_jobs` and `compiler_runs` with NO `CHECK` constraint, so SQLite accepts
 * any string — including a misspelling. TypeScript is erased at runtime, so the union types cannot
 * catch one either. `assertJobState`/`assertRunState` therefore run on the WRITE PATH, not only in
 * the type checker; control #80 writes `"SUCCEEEDED"` and control #81 removes the assertion.
 */
import type { CompilerJobState, CompilerRunState } from "./job.js"

/**
 * From -> the set of job states that may follow.
 *
 *  - `PENDING -> PENDING`      re-enqueued with the same inputs: priority/availableAt may move,
 *                              the row does not. This edge is what makes the queue idempotent by
 *                              identity rather than by attempt.
 *  - `PENDING -> LEASED`       a worker claimed it.
 *  - `LEASED -> LEASED`        the holder renewed its lease. Same owner, later expiry.
 *  - `LEASED -> PENDING`       released for another attempt: the holder hit a retryable error, or
 *                              its lease expired and another worker reclaimed the row.
 *  - `LEASED -> SUCCEEDED`     the work completed.
 *  - `LEASED -> FAILED`        the work failed and will not be retried.
 *  - `LEASED -> DEAD_LETTER`   attempts are exhausted.
 *  - `SUCCEEDED -> {}`         TERMINAL, and NOT for a fail-closed reason — for an identity one.
 *                              The UNIQUE triple `(job_type, subject_key, input_digest)` includes
 *                              the inputs, so "the same job again" means the same inputs, and
 *                              INV-R6 makes re-running those byte-identical. CHANGED inputs are a
 *                              different digest, hence a different triple and a different row.
 *                              Re-running a `SUCCEEDED` row is therefore never the way to get new
 *                              work done; it is only a way to grow the queue.
 *  - `FAILED -> {}`            TERMINAL. Fail-closed, per the schema's own description.
 *  - `DEAD_LETTER -> {}`       TERMINAL. Requeueing needs a human and a new row.
 */
export const COMPILER_JOB_TRANSITIONS: Readonly<Record<CompilerJobState, readonly CompilerJobState[]>> =
  Object.freeze({
    PENDING: Object.freeze<CompilerJobState[]>(["PENDING", "LEASED"]),
    LEASED: Object.freeze<CompilerJobState[]>(["LEASED", "PENDING", "SUCCEEDED", "FAILED", "DEAD_LETTER"]),
    SUCCEEDED: Object.freeze<CompilerJobState[]>([]),
    FAILED: Object.freeze<CompilerJobState[]>([]),
    DEAD_LETTER: Object.freeze<CompilerJobState[]>([]),
  })

/**
 * From -> the set of run states that may follow.
 *
 * One start, one conclusion. `RUNNING -> RUNNING` is deliberately ABSENT: `runId` is derived from
 * the run's identity including its injected `startedAt`, so a second call recording the same start
 * is either a duplicate the caller should hear about or a resumed process that ought to be
 * concluding the run it already opened. A silent re-open would let a crashed pass look freshly
 * started, which is the defect `assertUsableCheckpoint` refuses at the source level.
 *
 * All three conclusions are terminal, including `PARTIAL`. The next pass is a NEW run with a new
 * id — the run record is history, and history that can be edited is not a reproducibility record.
 */
export const COMPILER_RUN_TRANSITIONS: Readonly<Record<CompilerRunState, readonly CompilerRunState[]>> =
  Object.freeze({
    RUNNING: Object.freeze<CompilerRunState[]>(["SUCCEEDED", "PARTIAL", "FAILED"]),
    SUCCEEDED: Object.freeze<CompilerRunState[]>([]),
    PARTIAL: Object.freeze<CompilerRunState[]>([]),
    FAILED: Object.freeze<CompilerRunState[]>([]),
  })

/**
 * The job states the queue will never move away from.
 *
 * Derived from the table rather than restated, so the two cannot disagree — the arrangement
 * `isTerminalArtifactStatus` uses, for the same reason: a rule duplicated at call sites is a rule
 * that gets half-changed.
 */
export function isTerminalJobState(state: CompilerJobState): boolean {
  return COMPILER_JOB_TRANSITIONS[state].length === 0
}

/** The run states no further transition is defined from. Derived, never restated. */
export function isTerminalRunState(state: CompilerRunState): boolean {
  return COMPILER_RUN_TRANSITIONS[state].length === 0
}

/** True when `to` may follow `from` for a job. */
export function canTransitionJob(from: CompilerJobState, to: CompilerJobState): boolean {
  return COMPILER_JOB_TRANSITIONS[from].includes(to)
}

/** True when `to` may follow `from` for a run. */
export function canTransitionRun(from: CompilerRunState, to: CompilerRunState): boolean {
  return COMPILER_RUN_TRANSITIONS[from].includes(to)
}

/**
 * Throw unless `from -> to` is a permitted job move.
 *
 * The write path calls this INSIDE its transaction after reading the row's current state, so a
 * refused move rolls that one job back and leaves the row exactly as it was. Throwing rather than
 * returning a boolean matches `assertArtifactTransition`: a caller that reached a forbidden
 * transition has a logic defect, and the quiet alternative — skipping the update — would leave the
 * run reporting progress the queue never made.
 */
export function assertJobTransition(from: CompilerJobState, to: CompilerJobState, jobId: string): void {
  if (!canTransitionJob(from, to)) {
    throw new Error(
      `job "${jobId}": ${from} -> ${to} is not a permitted transition` +
        (isTerminalJobState(from) ? ` (${from} is terminal)` : ""),
    )
  }
}

/** Throw unless `from -> to` is a permitted run move. */
export function assertRunTransition(from: CompilerRunState, to: CompilerRunState, runId: string): void {
  if (!canTransitionRun(from, to)) {
    throw new Error(
      `run "${runId}": ${from} -> ${to} is not a permitted transition` +
        (isTerminalRunState(from) ? ` (${from} is terminal)` : ""),
    )
  }
}

/**
 * The job states a worker may lease work from.
 *
 * `PENDING` alone — a positive whitelist, shaped like `EVIDENCE_COMPILATION_INPUT_STATUSES` and for
 * the same argument. "Not terminal and not LEASED" reads as complete but admits by omission: a
 * sixth state added later would become leasable without anyone deciding it should be. Leasing a
 * `LEASED` row is the double-lease this set exists to make unrepresentable, and leasing a terminal
 * row is the implicit re-run the schema forbids.
 *
 * Availability is a SECOND condition, checked against an injected `now` in the same statement — a
 * state test alone would hand out work scheduled for later (`availableAt` is the backoff, computed
 * by the caller, never read from a clock in here; INV-R6, §9.5).
 */
export const LEASABLE_JOB_STATES: readonly CompilerJobState[] = Object.freeze(["PENDING"])

/** Whether a job in this state may be handed to a worker, availability aside. */
export function isLeasableJobState(state: CompilerJobState): boolean {
  return LEASABLE_JOB_STATES.includes(state)
}
