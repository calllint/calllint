import type { ReasonCode } from "./reasonCodes.js"
import type { Verdict } from "./verdict.js"

// ---------------------------------------------------------------------------
// Compact Decision v0 (new4 L2 default output — ADR 0020)
//
// The default output: ≤30 terminal lines, <1 KB JSON for a single surface.
// Agent- and CI-friendly. A projection of the existing ScanReport, not a second
// scoring system — the verdict still comes from the risk engine.
// ---------------------------------------------------------------------------

/**
 * The deterministic next step for the caller (agent / human / CI). Closed set so
 * agents can branch without parsing prose.
 */
export const NEXT_ACTIONS = [
  "continue",
  "ask_before_continue",
  "stop",
  "gather_more_evidence",
] as const
export type NextAction = (typeof NEXT_ACTIONS)[number]

/**
 * Deterministic verdict → nextAction map (ADR 0020). UNKNOWN never maps to
 * `continue` (CLAUDE.md: UNKNOWN ≠ SAFE). This is the single source of truth;
 * the decision layer applies it and a unit test asserts it stays total.
 */
export const VERDICT_NEXT_ACTION: Record<Verdict, NextAction> = {
  SAFE: "continue",
  REVIEW: "ask_before_continue",
  BLOCK: "stop",
  UNKNOWN: "gather_more_evidence",
}

/** The compact L2 decision. `fingerprintHash` comes from the CapabilityFingerprint. */
export interface CompactDecision {
  schemaVersion: "calllint.decision.v0"
  verdict: Verdict
  /** The surface label, e.g. ".cursor/mcp.json" or "stdin:snippet". */
  surface: string
  fingerprintHash: string
  /** Stable order, deduped (see reasonCodes). */
  reasonCodes: ReasonCode[]
  nextAction: NextAction
}
