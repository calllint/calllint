import type { ApprovedDriftReport, Verdict } from "@calllint/types"

/**
 * H1 — Continuous Guard engine (ADR 0045). Pure and total.
 *
 * Maps an approved-state drift report (ADR 0024 `verifyApproved`) onto a
 * retention *action*: what the guard should do when the authority surface at an
 * agent-tool config change moment either held steady or moved. This is NOT a
 * second drift engine and NOT a new verdict vocabulary — it consumes the shipped
 * `ApprovedDriftReport` and the shipped `SAFE/REVIEW/BLOCK/UNKNOWN` verdicts, and
 * only decides the retention response + a severity signal.
 *
 * The command layer (apps/cli) owns the concrete process exit code so this
 * engine stays free of CLI constants — it returns an abstract `action` + the
 * driving `verdict`, and the command maps action → exit.
 *
 * Contract (ADR 0045 §2/§3):
 *   - no drift            → "silent"          (verified unchanged)
 *   - drift, worst SAFE   → "note"            (informational; surface moved but no new risk)
 *   - drift, worst REVIEW → "prompt"          (human confirmation needed)
 *   - drift, worst UNKNOWN→ "request-evidence" (insufficient evidence; never SAFE, I-04)
 *   - drift, worst BLOCK  → "refuse"          (policy blocks the new authority)
 *   - guard's OWN failure → "fail-closed"     (never reads as a pass, ADR 0045 §3)
 */

export const GUARD_ACTIONS = [
  "silent",
  "note",
  "prompt",
  "request-evidence",
  "refuse",
  "fail-closed",
] as const
export type GuardAction = (typeof GUARD_ACTIONS)[number]

export interface GuardAssessment {
  /** The retention response the command should take. */
  action: GuardAction
  /**
   * The driving verdict. For a normal assessment this is the drift report's
   * verdict (SAFE when unchanged; never SAFE when drifted). For a fail-closed
   * assessment it is UNKNOWN — the guard could not establish safety.
   */
  verdict: Verdict
  /** True only when the approved surface moved (drift report `drifted`). */
  drifted: boolean
  /** A one-line human explanation, always present. */
  summary: string
  /**
   * Set only when `action === "fail-closed"`: why the guard itself could not
   * run. Kept distinct from a computed verdict so a broken guard is never
   * confused with a clean surface.
   */
  failure?: string
}

/**
 * Assess a completed drift report. Pure: same report → same assessment.
 *
 * `drifted === false` is the silent, byte-identical-surface path (the retention
 * promise: no new authority → no noise). Any drift maps its worst verdict onto a
 * retention action; because `verifyApproved` never emits SAFE when `drifted` is
 * true, the SAFE branch here only fires on the `!drifted` path.
 */
export function assessGuardDrift(report: ApprovedDriftReport): GuardAssessment {
  if (!report.drifted) {
    return {
      action: "silent",
      verdict: "SAFE",
      drifted: false,
      summary: "No authority change since the approved baseline.",
    }
  }

  const changed = report.entries.filter((e) => e.status !== "unchanged")
  const n = changed.length
  const surfaces = `${n} surface${n === 1 ? "" : "s"}`

  switch (report.verdict) {
    case "BLOCK":
      return {
        action: "refuse",
        verdict: "BLOCK",
        drifted: true,
        summary: `Authority changed on ${surfaces}; the new surface is blocked by policy.`,
      }
    case "UNKNOWN":
      return {
        action: "request-evidence",
        verdict: "UNKNOWN",
        drifted: true,
        summary: `Authority changed on ${surfaces}; the new surface could not be verified — evidence or approval required.`,
      }
    case "REVIEW":
      return {
        action: "prompt",
        verdict: "REVIEW",
        drifted: true,
        summary: `Authority changed on ${surfaces}; review the new surface before proceeding.`,
      }
    case "SAFE":
      // A drifted report should not be SAFE (verifyApproved floors moved
      // surfaces to REVIEW). If it ever is, surface it as a note rather than
      // silence — the surface DID move — but never as a pass-with-new-risk.
      return {
        action: "note",
        verdict: "SAFE",
        drifted: true,
        summary: `Authority changed on ${surfaces}; no new blockers observed.`,
      }
  }
}

/**
 * The guard's OWN failure path (ADR 0045 §3). Call this when the surface could
 * not be computed at all — an unreadable/corrupt approved baseline, an internal
 * error, a walker failure. The result is UNKNOWN + "fail-closed": it MUST NOT
 * read as a pass. Kept as an explicit constructor so every caller fails closed
 * the same way and a broken guard is never silently mapped to SAFE.
 */
export function guardFailClosed(failure: string): GuardAssessment {
  return {
    action: "fail-closed",
    verdict: "UNKNOWN",
    drifted: false,
    summary: "Continuous Guard could not verify the authority surface; failing closed.",
    failure,
  }
}
