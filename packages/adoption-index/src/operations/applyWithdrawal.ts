/**
 * applyWithdrawal — write a `WithdrawalPlan` to the subject plane. INV-R12's application half.
 *
 * THE CONTROL API IS AN INTERNAL EXPORTED FUNCTION, not an MCP tool. The MCP surface stays frozen at
 * 13 tools / 19 resources (`pack:smoke:mcp` asserts both), so this batch adds nothing an agent can
 * call. A de-listing is a claim-facing authority decision; exposing it to an autonomous caller before
 * the authority model exists would be the same mistake as shipping a verdict with no evidence.
 *
 * WITHDRAWAL IS NOT DELETION (INV-R12), and that is enforced by construction rather than by review:
 * this module issues exactly one kind of statement, `UPDATE canonical_subjects SET lifecycle_status`,
 * through `setSubjectLifecycle`. Every row, every alias, every artifact, every evidence record and
 * every receipt survives a withdrawal byte-identical. A withdrawn subject still verifies.
 *
 * ONE TRANSACTION, AND WHY THAT IS FAIL-CLOSED RATHER THAN FAIL-DESTRUCTIVE. This workstream has
 * already shipped one refusal that discarded 19_737 innocent subjects because 2 collided, so a
 * cohort-wide rollback is not a neutral default here. The distinction is what a rollback COSTS:
 *
 *   - there, the transaction carried the only copy of freshly fetched work, so refusing it threw that
 *     work away and the next run had to re-fetch everything;
 *   - here, the transaction carries only conclusions RE-DERIVABLE from rows that already exist. A
 *     rollback loses nothing at all — `planWithdrawal` is pure and idempotent, so the next run
 *     recomputes exactly the same plan and applies it.
 *
 * A refused transition also cannot happen without a logic defect: the plan filters terminal statuses
 * out and carries each row's stored `from`, so `assertLifecycleTransition` can only fire if the row
 * moved between the plan and the write. Atomicity is therefore free, and partial application — some
 * subjects de-listed, others not, with no record of which — is the outcome worth preventing.
 */
import type { AdoptionIndexStore } from "../storage/store.js"
import type { WithdrawalPlan, WithdrawalPlanEntry } from "./planWithdrawal.js"

export interface ApplyWithdrawalInput {
  store: AdoptionIndexStore
  plan: WithdrawalPlan
  /** Injected ISO-8601, stored as `withdrawn_at` for a FIRST absence. No clock is read here (INV-R7). */
  observedAt: string
}

export interface ApplyWithdrawalResult {
  /**
   * Subjects moved to `WITHDRAWN` by this call — the WHOLE plan entry, not a bare id.
   *
   * A `readonly string[]` here would have to choose between `subjectId` and `canonicalName`, and its
   * type could not say which it chose. The first draft chose `subjectId` and put digests in the same
   * summary object as `unmatched`'s names; a test asserting `["io.b/gone"]` failed against a
   * `sha256:…` and that is how the mixed vocabulary was caught. The entry carries BOTH, plus the
   * `from`→`to` pair, so a caller logging this can name the transition without a second lookup.
   */
  withdrawn: readonly WithdrawalPlanEntry[]
  /** Subjects moved back to `ACTIVE` by this call. Same shape, same reason. */
  reinstated: readonly WithdrawalPlanEntry[]
  /**
   * Planned moves the store reported as no-ops. Non-zero on a replay, and that is the expected
   * shape — `setSubjectLifecycle` keeps the FIRST `withdrawn_at`, so re-applying changes nothing.
   */
  unchanged: number
}

export function applyWithdrawal(input: ApplyWithdrawalInput): ApplyWithdrawalResult {
  const withdrawn: WithdrawalPlanEntry[] = []
  const reinstated: WithdrawalPlanEntry[] = []
  let unchanged = 0

  input.store.transaction((tx) => {
    for (const entry of input.plan.withdraw) {
      const result = tx.setSubjectLifecycle({
        subjectId: entry.subjectId,
        status: entry.to,
        observedAt: input.observedAt,
      })
      if (result.changed) withdrawn.push(entry)
      else unchanged += 1
    }
    for (const entry of input.plan.reinstate) {
      const result = tx.setSubjectLifecycle({
        subjectId: entry.subjectId,
        status: entry.to,
        observedAt: input.observedAt,
      })
      if (result.changed) reinstated.push(entry)
      else unchanged += 1
    }
  })

  return { withdrawn, reinstated, unchanged }
}
