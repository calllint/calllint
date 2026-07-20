/**
 * Resolution state machine (new11 P1 §4.5) — PURE. Encodes the legal transitions
 * DISCOVERED → QUEUED → RESOLVING → {COMPLETE | PARTIAL | UNRESOLVABLE |
 * RETRYABLE_FAILURE} → (re-RESOLVING on retry) → PUBLISHED.
 *
 * Invariant (mirrors the engine): only COMPLETE with zero blocking gaps may reach
 * PUBLISHED. PARTIAL / UNRESOLVABLE / RETRYABLE_FAILURE never auto-upgrade to a
 * clean state — a missing signal is not a pass.
 */
import type { ResolutionState, ResolverStatus } from "./types.js"

/** Legal successor states for each state. Empty ⇒ terminal for this run. */
const TRANSITIONS: Record<ResolutionState, ResolutionState[]> = {
  DISCOVERED: ["QUEUED"],
  QUEUED: ["RESOLVING"],
  RESOLVING: ["COMPLETE", "PARTIAL", "UNRESOLVABLE", "RETRYABLE_FAILURE"],
  // A retryable failure or partial may be re-queued for another attempt.
  RETRYABLE_FAILURE: ["QUEUED"],
  PARTIAL: ["QUEUED", "PUBLISHED"],
  // COMPLETE is the only state eligible to publish.
  COMPLETE: ["PUBLISHED"],
  UNRESOLVABLE: [],
  PUBLISHED: [],
}

/** True when `to` is a legal next state from `from`. */
export function canTransition(from: ResolutionState, to: ResolutionState): boolean {
  return TRANSITIONS[from].includes(to)
}

/** States from which no further transition is defined for this run. */
export function isTerminal(state: ResolutionState): boolean {
  return TRANSITIONS[state].length === 0 || state === "COMPLETE" || state === "PARTIAL"
}

/** Map a resolver's per-invocation status onto the post-RESOLVING state. */
export function stateFromResolverStatus(status: ResolverStatus): ResolutionState {
  switch (status) {
    case "complete":
      return "COMPLETE"
    case "partial":
      return "PARTIAL"
    case "unresolvable":
      return "UNRESOLVABLE"
    case "retryable-failure":
      return "RETRYABLE_FAILURE"
  }
}
