import type {
  ApprovedDriftEntry,
  ApprovedDriftReport,
  ApprovedState,
  CompactDecision,
  Verdict,
} from "@calllint/types"
import { mostSevereVerdict } from "@calllint/types"

/**
 * Compare current compact decisions against the approved capability state.
 * Pure and deterministic. Reuses the drift *concept* from drift.ts but on the
 * capability fingerprintHash, not the Evidence-layer hashes.
 *
 * Drift verdict rule (ADR 0024, UNKNOWN-safe): any moved surface drifts to at
 * least REVIEW; BLOCK/UNKNOWN current verdicts dominate. Drift NEVER collapses
 * to SAFE.
 */
export function verifyApproved(
  current: readonly CompactDecision[],
  approved: ApprovedState,
  generatedAt: string,
): ApprovedDriftReport {
  // Index approved by surface (last write wins is irrelevant — buildApproved dedups).
  const approvedBySurface = new Map<string, ApprovedState["approved"][number]>()
  for (const a of approved.approved) approvedBySurface.set(a.surface, a)

  const currentBySurface = new Map<string, CompactDecision>()
  for (const d of current) currentBySurface.set(d.surface, d)

  const entries: ApprovedDriftEntry[] = []
  const driftVerdicts: Verdict[] = []

  // Approved surfaces: unchanged / hash-changed / verdict-changed / removed.
  for (const a of approved.approved) {
    const cur = currentBySurface.get(a.surface)
    if (!cur) {
      entries.push({
        surface: a.surface,
        status: "removed",
        approvedHash: a.fingerprintHash,
        approvedVerdict: a.verdict,
      })
      driftVerdicts.push("REVIEW")
      continue
    }
    if (cur.fingerprintHash !== a.fingerprintHash) {
      entries.push({
        surface: a.surface,
        status: "hash-changed",
        approvedHash: a.fingerprintHash,
        currentHash: cur.fingerprintHash,
        approvedVerdict: a.verdict,
        currentVerdict: cur.verdict,
      })
      // Hash drift → at least REVIEW; current BLOCK/UNKNOWN dominates.
      driftVerdicts.push(escalate(cur.verdict))
      continue
    }
    if (cur.verdict !== a.verdict) {
      entries.push({
        surface: a.surface,
        status: "verdict-changed",
        approvedHash: a.fingerprintHash,
        currentHash: cur.fingerprintHash,
        approvedVerdict: a.verdict,
        currentVerdict: cur.verdict,
      })
      driftVerdicts.push(escalate(cur.verdict))
      continue
    }
    entries.push({
      surface: a.surface,
      status: "unchanged",
      approvedHash: a.fingerprintHash,
      currentHash: cur.fingerprintHash,
      approvedVerdict: a.verdict,
      currentVerdict: cur.verdict,
    })
  }

  // Surfaces present now but never approved → added.
  for (const d of current) {
    if (!approvedBySurface.has(d.surface)) {
      entries.push({
        surface: d.surface,
        status: "added",
        currentHash: d.fingerprintHash,
        currentVerdict: d.verdict,
      })
      driftVerdicts.push(escalate(d.verdict))
    }
  }

  const drifted = entries.some((e) => e.status !== "unchanged")
  const verdict = drifted ? mostSevereVerdict(driftVerdicts) : "SAFE"

  return {
    schemaVersion: "calllint.approveddrift.v0",
    drifted,
    verdict,
    entries,
    generatedAt,
  }
}

/** A drifted surface is never SAFE: SAFE/REVIEW floor to REVIEW; BLOCK/UNKNOWN dominate. */
function escalate(current: Verdict): Verdict {
  return current === "BLOCK" || current === "UNKNOWN" ? current : "REVIEW"
}
