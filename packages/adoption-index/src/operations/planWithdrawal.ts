/**
 * planWithdrawal — decide which subjects the lifecycle axis must move, and to what.
 *
 * PURE, and deliberately separated from the write: the store applies the plan through
 * `setSubjectLifecycle`, so every rule below is testable without a database and a test cannot pass by
 * accidentally exercising SQLite's defaults instead of the rule. Same observer/evaluator split the
 * safe-install projection uses.
 *
 * THIS CLOSES A GAP R-2 STATED IN ITS OWN CODE. `refreshFromMirror` computes `absentFromSource` and
 * `detectSourceChange` turns it into `reason: "SOURCE_WITHDRAWAL"`, whose remedy string ends
 * "de-listing is NOT applied by this batch". Detection and reporting shipped; application did not.
 *
 * THE JOIN IS ON `canonicalName`, measured. Against a populated store (298 subjects / 1200 source
 * records / 839 aliases) a native id reached a subject 298/298 through `subject_aliases.alias` AND
 * 298/298 through `canonical_subjects.canonical_name`, so coverage does not decide it. `canonicalName`
 * wins on three other counts: it is `NOT NULL UNIQUE` in the DDL, `domain/subject.ts` calls it "the
 * AUTHORITATIVE key: the original registry name, never the lossy slug", and the alias table also holds
 * SLUG-shaped aliases — the case-fold collisions that `migrations/002` exists because of. A `CONFLICT`
 * subject keeps its name while its slug is NULL, so joining on the name reaches it too, which is
 * required: a conflicted subject can be de-listed like any other.
 *
 * REINSTATEMENT NEEDS POSITIVE EVIDENCE, not merely absence from the absent set. `absentFromSource` is
 * derived from the records the mirror held BEFORE the run, so "not absent" also covers subjects that
 * set never contained. Reinstating on that would be reinstating on ignorance, so this reads
 * `observedNativeIds` — what the run actually saw — and reinstates only on a hit.
 */
import type { AdoptionLifecycleStatus } from "../domain/adoptionRecord.js"
import { isTerminalLifecycle } from "../domain/subjectLifecycle.js"
import type { StoredSubject } from "../storage/store.js"

/** One planned move. `from` is the stored value, so the applier's transition check cannot surprise us. */
export interface WithdrawalPlanEntry {
  subjectId: string
  canonicalName: string
  from: AdoptionLifecycleStatus
  to: AdoptionLifecycleStatus
}

export interface WithdrawalPlan {
  /** Absent from a cohort that COMPLETED — moved to `WITHDRAWN`, never to `TOMBSTONED`. */
  withdraw: readonly WithdrawalPlanEntry[]
  /** Withdrawn and observed again — moved back to `ACTIVE`. The truncation escape hatch. */
  reinstate: readonly WithdrawalPlanEntry[]
  /** Absent native ids no stored subject claims. Reported, never silently dropped. */
  unmatched: readonly string[]
  /** Absent subjects already `TOMBSTONED`. Terminal, so untouched by design. */
  skippedTerminal: readonly string[]
}

export interface PlanWithdrawalInput {
  /** Every stored subject, as `store.listSubjects()` returns them. */
  subjects: readonly StoredSubject[]
  /** `refreshFromMirror`'s set: native ids the mirror held that this run did NOT observe. */
  absentFromSource: readonly string[]
  /** `syncSource`'s set: native ids this run DID observe. Reinstatement requires a hit here. */
  observedNativeIds: ReadonlySet<string>
}

/**
 * Build the plan. No clock, no store, no I/O.
 *
 * A TRUNCATED RUN MUST NEVER REACH THIS FUNCTION AT ALL. `assertMirrorComplete` already fails the run
 * closed before `absentFromSource` is even read, so an incomplete cohort cannot produce a withdrawal.
 * That is the FIRST line of defence and this is the second: even if a partial cohort did arrive, the
 * worst it can do is write `WITHDRAWN`, which `reinstate` undoes on the next complete run. Nothing here
 * can reach `TOMBSTONED` — that status is only reachable through an explicit, separately authorized
 * call, so no automatic path can make an unreachable-source blip permanent.
 */
export function planWithdrawal(input: PlanWithdrawalInput): WithdrawalPlan {
  const byName = new Map(input.subjects.map((s) => [s.canonicalName, s]))
  const withdraw: WithdrawalPlanEntry[] = []
  const unmatched: string[] = []
  const skippedTerminal: string[] = []

  for (const nativeId of input.absentFromSource) {
    const subject = byName.get(nativeId)
    if (subject === undefined) {
      // No stored subject claims this name. Reported rather than dropped: it means the mirror and the
      // subject plane disagree about what exists, which is a defect worth surfacing, not a no-op.
      unmatched.push(nativeId)
      continue
    }
    if (isTerminalLifecycle(subject.lifecycleStatus)) {
      // `canonicalName`, not `subjectId`, and the choice is load-bearing rather than cosmetic. This
      // list sits beside `unmatched` in one summary object, and `unmatched` STRUCTURALLY cannot hold
      // a `subjectId` — its entries are absent names that no subject claims. Reporting one of the two
      // as digests and the other as names would put two vocabularies in one object with no type
      // difference to warn a reader, so an operator comparing them would silently compare a
      // `sha256:…` against a name and conclude the sets are disjoint. Both are names; the applied
      // writes below carry the whole entry, so no `subjectId` is lost.
      skippedTerminal.push(subject.canonicalName)
      continue
    }
    if (subject.lifecycleStatus === "WITHDRAWN") continue // already concluded; `withdrawnAt` must not move
    withdraw.push({
      subjectId: subject.subjectId,
      canonicalName: subject.canonicalName,
      from: subject.lifecycleStatus,
      to: "WITHDRAWN",
    })
  }

  // Re-observed withdrawals, in stored order (`listSubjects` sorts by canonical name) so the plan is
  // deterministic without a second sort.
  const reinstate: WithdrawalPlanEntry[] = input.subjects
    .filter((s) => s.lifecycleStatus === "WITHDRAWN" && input.observedNativeIds.has(s.canonicalName))
    .map((s) => ({ subjectId: s.subjectId, canonicalName: s.canonicalName, from: s.lifecycleStatus, to: "ACTIVE" }))

  return { withdraw, reinstate, unmatched: unmatched.sort(), skippedTerminal: skippedTerminal.sort() }
}
