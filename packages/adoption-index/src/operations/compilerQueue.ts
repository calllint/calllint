/**
 * compilerQueue — the queue's five operations over `compiler_jobs`, and the run bracket over
 * `compiler_runs` (§7.1, §10.2, ADR 0061). R-6.
 *
 * ONE MODULE, NOT FIVE FILES, because these are not five stages — they are one lifecycle, and its
 * rules only hold jointly. `leaseJob` increments `attempt_count` so that `settleAttempt` can decide
 * `DEAD_LETTER` from the row alone; `reclaimExpiredLeases` deliberately leaves that counter alone so a
 * crashed attempt still counts. Splitting them into `enqueueJobs.ts` / `leaseJob.ts` would put the two
 * halves of that argument in two files and invite the next reader to change one.
 *
 * WHAT THIS LAYER ADDS OVER `store.ts`, given that all the SQL lives there (§10.3): the store enforces
 * the per-row invariants, and this module supplies the two POLICIES a store cannot —
 *
 *   - EXHAUSTION. `attemptCount >= maxAttempts` means `DEAD_LETTER` rather than another `PENDING`. The
 *     store cannot decide this: it does not know a caller's retry budget, and a budget baked into the
 *     store would be one number for every stage. `decideDisposition` decides it, once, purely.
 *   - BACKOFF. How long a released job waits. Computed here as a DURATION IN MILLISECONDS, never as a
 *     point in time — see below.
 *
 * THIS MODULE CANNOT PRODUCE A TIMESTAMP, and that is structural rather than promised. There is no
 * `Date` in this file, no `Date.parse`, and no formatter: every absolute stamp is either passed in
 * (`now`, `leaseExpiresAt`) or produced by an injected `schedule` the caller supplies. So INV-R6's
 * "never from a wall-clock read inside the compile path" holds because a clock read here is
 * UNREPRESENTABLE, not because a comment forbids it — the same argument that makes R-5's compilation
 * offline (no `fetchImpl` parameter exists to inject one through).
 *
 * `schedule` is injected only where the need is CONDITIONAL. A lease deadline is unconditional, so
 * `leaseNextJob` takes the stamp itself; a retry deadline exists only if a retry was decided, and the
 * caller cannot know that without duplicating `decideDisposition`. So `settleAttempt` takes the
 * capability and calls it on exactly the one path that needs it.
 *
 * NOTHING HERE EXECUTES ANYTHING. A job is a row naming work to be done; running the seven stages is
 * not this batch's business (see `CompilerJobType`). No `fetchImpl`, no child process, no dynamic
 * import on this path.
 */
import type { CompilerJobType, CompilerRunMetrics, CompilerRunType } from "../domain/job.js"
import type { AdoptionIndexStore, StoredCompilerJob } from "../storage/store.js"

/**
 * Turn a DURATION into an absolute ISO-8601 stamp.
 *
 * The caller's one clock read, in the one form this module needs. A typical edge implementation is
 * `(ms) => new Date(nowMs + ms).toISOString()` where `nowMs` was read once at the edge — the
 * arithmetic and the formatting both live out there, which is why neither appears in here.
 */
export type ScheduleFn = (delayMs: number) => string

/** One unit of work to queue. `priority` omitted ⇒ the DDL's default (100). */
export interface JobRequest {
  jobType: CompilerJobType
  subjectKey: string
  inputDigest: string
  priority?: number
}

export interface EnqueueJobsInput {
  store: AdoptionIndexStore
  jobs: readonly JobRequest[]
  /** Injected ISO-8601: `created_at` on a new row, `updated_at` on either path. */
  now: string
  /**
   * When these jobs become leasable. Defaults to `now` — eligible immediately.
   *
   * A DEFAULT rather than a required field, unlike the retry path's `availableAt`. A first enqueue has
   * nothing to back off from; a RELEASE does, which is why `settleAttempt` computes one and the store
   * refuses a `PENDING` completion without it.
   */
  availableAt?: string
}

export interface EnqueueJobsResult {
  /** Jobs whose identity triple was not already queued. */
  queued: number
  /** Jobs already present — their schedule was updated, the row was not duplicated. */
  updated: number
  /** Every job's id, in the order requested. */
  jobIds: string[]
}

/**
 * Queue work, ONE TRANSACTION PER JOB.
 *
 * Not one transaction around the loop, and this is the repository's most expensive lesson rather than
 * a style choice: a cohort-wide transaction discarded 19_737 innocent subjects because 2 collided
 * (`fail-DESTRUCTIVE`). `store.transaction()` issues raw `BEGIN`/`COMMIT` with no nesting, so a single
 * transaction here would let one malformed digest roll back every job already queued. A per-job scope
 * makes a bad request a per-job failure. Control #74 wraps the loop and observes the whole batch
 * vanish.
 *
 * A malformed job still THROWS rather than being skipped — the store's assertions are the fail-closed
 * boundary, and a caller that queued nonsense has a defect. Per-job transactions mean the throw
 * discards that job's row only; everything already committed stays committed, which is the point.
 */
export function enqueueJobs(input: EnqueueJobsInput): EnqueueJobsResult {
  const availableAt = input.availableAt ?? input.now
  const result: EnqueueJobsResult = { queued: 0, updated: 0, jobIds: [] }

  for (const job of input.jobs) {
    const written = input.store.transaction((tx) =>
      tx.enqueueJob({
        jobType: job.jobType,
        subjectKey: job.subjectKey,
        inputDigest: job.inputDigest,
        priority: job.priority,
        availableAt,
        now: input.now,
      }),
    )
    result.jobIds.push(written.jobId)
    if (written.inserted) result.queued += 1
    else result.updated += 1
  }

  return result
}

export interface LeaseNextInput {
  store: AdoptionIndexStore
  /** Recorded verbatim in `lease_owner`. A worker identity, never a secret. */
  owner: string
  /** Injected ISO-8601. Rows with `available_at <= now` are eligible. */
  now: string
  /** Injected ISO-8601: when this claim lapses. The store refuses a value at or before `now`. */
  leaseExpiresAt: string
  /** Restrict the claim to one stage. Omitted ⇒ any type. */
  jobType?: CompilerJobType
}

/**
 * Claim the next eligible job, or return null.
 *
 * A THIN wrapper over `tx.leaseJob`, on purpose: single ownership is a property of ONE conditional
 * UPDATE, and any logic added here between choosing and claiming would reintroduce the window that
 * UPDATE exists to close. Both stamps are the caller's, so this function has no policy of its own —
 * which is the honest shape for the one operation that must stay atomic.
 */
export function leaseNextJob(input: LeaseNextInput): StoredCompilerJob | null {
  return input.store.transaction((tx) =>
    tx.leaseJob({
      owner: input.owner,
      now: input.now,
      leaseExpiresAt: input.leaseExpiresAt,
      jobType: input.jobType,
    }),
  )
}

export interface RenewLeaseInput {
  store: AdoptionIndexStore
  jobId: string
  owner: string
  now: string
  /** The new expiry. The store refuses a value at or before `now`. */
  leaseExpiresAt: string
}

/**
 * Extend a claim this owner still holds. False when it was lost to the expiry sweep.
 *
 * FALSE IS NOT AN ERROR. A worker that took longer than its lease has genuinely lost the row, and its
 * correct response is to stop — not to crash, and certainly not to keep writing. `completeJob` refuses
 * the transition if it tries anyway, so the fail-closed property does not depend on the caller reading
 * this boolean.
 */
export function renewLease(input: RenewLeaseInput): boolean {
  return input.store.transaction((tx) =>
    tx.renewLease({
      jobId: input.jobId,
      owner: input.owner,
      now: input.now,
      leaseExpiresAt: input.leaseExpiresAt,
    }),
  )
}

/** How one attempt ended, as the worker reports it — before any retry policy is applied. */
export type AttemptOutcome =
  /** The work completed. */
  | "SUCCESS"
  /** It failed in a way another attempt might survive (a timeout, a 503). */
  | "RETRYABLE"
  /** It failed in a way no attempt will survive (a malformed input, a refusal). */
  | "PERMANENT"

/** What the queue decided to do about one attempt. */
export type AttemptDisposition =
  | "SUCCEEDED"
  /** Released for another attempt, with a computed backoff. */
  | "RETRY_SCHEDULED"
  /** Concluded without retrying — the worker said no attempt would survive. */
  | "FAILED"
  /** Attempts exhausted. Terminal, and needs a human and a new row. */
  | "DEAD_LETTER"

export interface SettleAttemptInput {
  store: AdoptionIndexStore
  /** The row the worker held. Its `attemptCount` is the one `leaseJob` already incremented. */
  job: StoredCompilerJob
  outcome: AttemptOutcome
  /** Injected ISO-8601 for `updated_at`. */
  now: string
  /**
   * Turns the computed retry DELAY into an absolute stamp. Called on the `RETRY_SCHEDULED` path only.
   *
   * Required rather than defaulted, because a default would need a clock (see the module docblock).
   * Omitting it is not representable, so no caller can accidentally get a store-refused write.
   */
  schedule: ScheduleFn
  /** Hand-outs allowed before `DEAD_LETTER`. Defaults to `DEFAULT_MAX_ATTEMPTS`. */
  maxAttempts?: number
  /** First-retry delay in milliseconds; doubled per prior attempt. Defaults to `DEFAULT_BACKOFF_MS`. */
  backoffMs?: number
  /** A short stable code for `last_error_code`. Free-form prose belongs in the CAS, not this column. */
  errorCode?: string
  /** `sha256:<hex>` of the error bytes in the CAS. The bytes are content-addressed, never inlined. */
  errorDigest?: string
}

/**
 * Five attempts: the initial one plus four retries.
 *
 * A number rather than "retry until it works", because the schema's own words are that "a job that
 * silently retries forever is how a compiler burns a rate limit and reports nothing". Five is a
 * default a caller may override per stage, not a constant this module hides.
 */
export const DEFAULT_MAX_ATTEMPTS = 5

/** 30 s before the first retry, doubling — 30 s, 1 m, 2 m, 4 m across the four retries. */
export const DEFAULT_BACKOFF_MS = 30_000

/** One hour. The ceiling on a doubled backoff. */
export const MAX_BACKOFF_MS = 3_600_000

/**
 * Apply the retry policy to one finished attempt and write the result.
 *
 * THE EXHAUSTION TEST IS `attemptCount >= maxAttempts`, READ FROM THE ROW. `leaseJob` incremented it
 * when the work was handed out, so a worker that crashed without reporting is already counted. That is
 * what closes the loop the schema names: a counter incremented on COMPLETION would never advance for a
 * job that dies every time, and it would be retried forever. Control #82 counts on completion instead
 * and observes exactly that.
 *
 * `PERMANENT` reaches `FAILED` WITHOUT consuming the budget, and the distinction from `DEAD_LETTER` is
 * intent rather than severity: `FAILED` is a refusal to retry, `DEAD_LETTER` is an exhaustion. Both are
 * terminal and both need a human, but a reader can tell them apart without parsing `last_error_code` —
 * which is why the schema has both.
 */
export function settleAttempt(input: SettleAttemptInput): AttemptDisposition {
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const backoffMs = input.backoffMs ?? DEFAULT_BACKOFF_MS
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error(`maxAttempts must be a positive integer, found ${String(maxAttempts)}`)
  }
  if (!Number.isInteger(backoffMs) || backoffMs < 0) {
    throw new Error(`backoffMs must be a non-negative integer of milliseconds, found ${String(backoffMs)}`)
  }

  const disposition = decideDisposition(input.outcome, input.job.attemptCount, maxAttempts)
  const availableAt =
    disposition === "RETRY_SCHEDULED" ? input.schedule(retryDelayMs(input.job.attemptCount, backoffMs)) : undefined

  input.store.transaction((tx) => {
    tx.completeJob({
      jobId: input.job.jobId,
      state: disposition === "RETRY_SCHEDULED" ? "PENDING" : disposition,
      now: input.now,
      availableAt,
      // Cleared on success: a row that succeeded carries no error, and leaving a stale code would make
      // a healthy job read as one that failed and was somehow fixed.
      lastErrorCode: disposition === "SUCCEEDED" ? null : (input.errorCode ?? null),
      lastErrorDigest: disposition === "SUCCEEDED" ? null : (input.errorDigest ?? null),
    })
  })

  return disposition
}

/**
 * The disposition, as a pure function of the three inputs.
 *
 * Separated from the write so the policy is testable without a store, and so the mapping exists in one
 * place. `>=`, not `>`: with `maxAttempts = 5` the fifth hand-out sets `attemptCount = 5`, and that
 * attempt is the last one permitted — so a failure at 5 is exhaustion, not a sixth chance. Control #83
 * makes it strict-greater and observes six hand-outs.
 */
export function decideDisposition(
  outcome: AttemptOutcome,
  attemptCount: number,
  maxAttempts: number,
): AttemptDisposition {
  switch (outcome) {
    case "SUCCESS":
      return "SUCCEEDED"
    case "PERMANENT":
      return "FAILED"
    case "RETRYABLE":
      return attemptCount >= maxAttempts ? "DEAD_LETTER" : "RETRY_SCHEDULED"
  }
}

/**
 * Exponential delay for the retry that follows `attemptCount` hand-outs.
 *
 * `attemptCount` is at least 1 whenever this is reached (the row was leased), so the first retry waits
 * `backoffMs` and each subsequent one doubles. Capped at `MAX_BACKOFF_MS`, because doubling is
 * unbounded and a queue whose next attempt is scheduled for the next century has lost the row. The
 * `doublings > 30` branch caps BEFORE the multiplication, so the cap cannot be reached by way of
 * `Infinity`.
 */
export function retryDelayMs(attemptCount: number, backoffMs: number): number {
  const doublings = Math.max(0, attemptCount - 1)
  const scaled = doublings > 30 ? MAX_BACKOFF_MS : backoffMs * 2 ** doublings
  return Math.min(scaled, MAX_BACKOFF_MS)
}

export interface ReclaimInput {
  store: AdoptionIndexStore
  /** Injected ISO-8601. Leases expiring at or before this are released. */
  now: string
}

/**
 * Release every expired lease, returning how many rows were reclaimed.
 *
 * ONE transaction for the whole sweep, and the exception is deliberate: this is a single conditional
 * UPDATE, so there is no loop for a bad row to poison. The per-item rule exists because a loop's later
 * failure must not undo its earlier successes; a statement has no earlier successes.
 */
export function reclaimExpiredLeases(input: ReclaimInput): number {
  return input.store.transaction((tx) => tx.reclaimExpiredLeases(input.now))
}

export interface BeginRunInput {
  store: AdoptionIndexStore
  runType: CompilerRunType
  /** `sha256:<hex>` over what this pass consumes. */
  inputManifestDigest: string
  /** Injected ISO-8601. Part of `runId`, so a replay with the same stamp is the same run. */
  startedAt: string
}

/** Open one `compiler_runs` row, returning its `runId`. */
export function beginCompilerRun(input: BeginRunInput): string {
  return input.store.transaction((tx) =>
    tx.beginCompilerRun({
      runType: input.runType,
      inputManifestDigest: input.inputManifestDigest,
      startedAt: input.startedAt,
    }),
  )
}

export interface ConcludeRunInput {
  store: AdoptionIndexStore
  runId: string
  /** `null` for a crashed run. Never an all-zero digest — the store refuses that. */
  outputManifestDigest: string | null
  completedAt: string
  metrics: CompilerRunMetrics
}

/**
 * Conclude one pass, GRADING IT FROM ITS OWN COUNTERS rather than from a caller's opinion.
 *
 * `gradeRun` decides `SUCCEEDED` / `PARTIAL` / `FAILED`, and the state is not a parameter. A run that
 * compiled 24 of 25 subjects is `PARTIAL` — "not a success, and grading it as one would let a
 * projection ship over an incomplete index" (the schema). If the caller supplied the state, a run with
 * `failures: 1` could be recorded as `SUCCEEDED` and nothing would contradict it; control #86 does
 * exactly that and observes the grade refuse to move.
 *
 * This is a MEASUREMENT, not a verdict. Product Principle 4 reserves verdicts for deterministic rules
 * over evidence; `failures > 0` is a count of things that did not finish, which is why the grade may be
 * derived here while `evidence_records.verdict` may not.
 */
export function concludeCompilerRun(input: ConcludeRunInput): void {
  const state = gradeRun(input.metrics, input.outputManifestDigest)
  input.store.transaction((tx) => {
    tx.concludeCompilerRun({
      runId: input.runId,
      state,
      outputManifestDigest: input.outputManifestDigest,
      completedAt: input.completedAt,
      metrics: input.metrics,
    })
  })
}

/**
 * Grade a finished pass from its counters and whether it produced a manifest.
 *
 * Three rules, in this order:
 *
 *   1. NO OUTPUT MANIFEST ⇒ `FAILED`, whatever the counters say. A pass that produced nothing a later
 *      replay can read did not conclude; the store refuses any other grade without a digest anyway, so
 *      deciding it here keeps the two from disagreeing.
 *   2. ANY FAILURE ⇒ `PARTIAL`. Not `SUCCEEDED`, per the schema, and not `FAILED` either — the 24
 *      subjects that did compile are real and their manifest is real.
 *   3. Otherwise `SUCCEEDED`.
 *
 * A run with a manifest and six zero counters grades `SUCCEEDED`, and that is correct rather than
 * suspicious: a reconcile pass over an unchanged corpus reads nothing and emits nothing. `PARTIAL`
 * means something FAILED, not that something was skipped.
 */
export function gradeRun(
  metrics: CompilerRunMetrics,
  outputManifestDigest: string | null,
): "SUCCEEDED" | "PARTIAL" | "FAILED" {
  if (outputManifestDigest === null) return "FAILED"
  return metrics.failures > 0 ? "PARTIAL" : "SUCCEEDED"
}

export interface WithCompilerRunInput extends BeginRunInput {
  /** Injected ISO-8601, recorded if the body throws. */
  completedAt: string
  /**
   * The counters as they stand when the run ends.
   *
   * A FUNCTION, not a value, and called inside the `catch` — after the throw. A snapshot taken before
   * the body would report zeros for work that actually happened, which is the opposite of what a crash
   * record is for.
   */
  metricsOf: () => CompilerRunMetrics
}

/**
 * A run bracket that always concludes, even when the body throws.
 *
 * The one shape a caller cannot get wrong by forgetting a `finally`: a pass that crashes mid-way leaves
 * a row stuck in `RUNNING` forever, and `RUNNING` has no self-edge (see `jobStates.ts`), so nothing can
 * later conclude it. This records `FAILED` with a null manifest and RE-THROWS — the honest record of a
 * crash, and the reason `outputManifestDigest` is nullable at all.
 *
 * The success path deliberately does NOT conclude the run. The body knows what it produced; only it can
 * supply the output manifest digest, and a bracket that guessed one would be inventing the value a
 * later replay compares against. So the contract is: conclude it yourself on success, and this
 * guarantees a crash is still recorded.
 */
export function withCompilerRun<T>(input: WithCompilerRunInput, body: (runId: string) => T): T {
  const runId = beginCompilerRun(input)
  try {
    return body(runId)
  } catch (err) {
    concludeCompilerRun({
      store: input.store,
      runId,
      outputManifestDigest: null,
      completedAt: input.completedAt,
      metrics: input.metricsOf(),
    })
    throw err
  }
}
