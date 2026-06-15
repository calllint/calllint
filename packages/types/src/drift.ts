import type { Fingerprints } from "./fingerprint.js"
import type { RiskSymbol } from "./symbols.js"
import type { Verdict } from "./verdict.js"

/**
 * A baseline captures the approved risk surface of each server at a point in
 * time, so a later scan can be compared against it (TOCTOU / rug-pull
 * detection). It stores only deterministic data — never timestamps in the
 * comparison surface — so two baselines of the same config are identical.
 */
export interface BaselineEntry {
  server: string
  verdict: Verdict
  symbols: RiskSymbol[]
  /** The stable finding ids that made up the approved risk surface. */
  findingIds: string[]
  fingerprints: Fingerprints
}

export interface Baseline {
  schemaVersion: "mcpguard.baseline.v0"
  configPath: string
  entries: BaselineEntry[]
  /** Informational only; never part of the comparison. */
  createdAt: string
}

export const DRIFT_STATUSES = [
  "unchanged",
  "config-changed",
  "package-changed",
  "risk-surface-changed",
  "verdict-changed",
  "added",
  "removed",
] as const
export type DriftStatus = (typeof DRIFT_STATUSES)[number]

export interface DriftEntry {
  server: string
  status: DriftStatus
  /** Human-readable reasons for the drift. */
  reasons: string[]
  baselineVerdict?: Verdict
  currentVerdict?: Verdict
  /** True when this drift is a supply-chain / rug-pull signal (RUGPULL). */
  rugPull: boolean
}

export interface DriftReport {
  schemaVersion: "mcpguard.drift.v0"
  configPath: string
  /** True if any entry drifted (status !== "unchanged"). */
  drifted: boolean
  /** True if any entry is a rug-pull signal. */
  rugPullDetected: boolean
  entries: DriftEntry[]
  generatedAt: string
}
