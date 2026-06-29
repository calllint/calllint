import type { ReasonCode } from "./reasonCodes.js"
import type { Verdict } from "./verdict.js"

// ---------------------------------------------------------------------------
// Approved State v0 (new4 L4 — ADR 0024)
//
// The capability-layer approval record. Distinct from the Evidence-layer
// `Baseline` (calllint.baseline.v0): an ApprovedState is keyed on the
// CompactDecision `fingerprintHash` (the canonical capability hash, ADR 0019),
// per surface. It is what `calllint approve` writes and `calllint verify
// --approved` diffs against. Drift never collapses to SAFE (CLAUDE.md).
// ---------------------------------------------------------------------------

/** One approved surface: the capability hash a maintainer signed off on. */
export interface ApprovedEntry {
  /** sha256 of the CapabilityFingerprint, e.g. "sha256:…". */
  fingerprintHash: string
  /** Surface label, e.g. ".cursor/mcp.json". */
  surface: string
  /** The verdict at approval time. */
  verdict: Verdict
  /** ISO-8601, injected for reproducibility. */
  approvedAt: string
  /** Informational snapshot of reason codes at approval time. */
  reasonCodes?: ReasonCode[]
}

/** The committed approved state for a repo (`.calllint/approved.json`). */
export interface ApprovedState {
  schemaVersion: "calllint.approved.v0"
  approved: ApprovedEntry[]
}

/** Per-surface result of comparing current decisions to approved state. */
export const APPROVED_DRIFT_STATUS = [
  "unchanged",
  "hash-changed",
  "verdict-changed",
  "added",
  "removed",
] as const
export type ApprovedDriftStatus = (typeof APPROVED_DRIFT_STATUS)[number]

export interface ApprovedDriftEntry {
  surface: string
  status: ApprovedDriftStatus
  approvedHash?: string
  currentHash?: string
  approvedVerdict?: Verdict
  currentVerdict?: Verdict
}

/** The result of `verify --approved`. `drifted` is true if any entry moved. */
export interface ApprovedDriftReport {
  schemaVersion: "calllint.approveddrift.v0"
  drifted: boolean
  /** Worst verdict implied by the drift (never SAFE when drifted). */
  verdict: Verdict
  entries: ApprovedDriftEntry[]
  generatedAt: string
}
