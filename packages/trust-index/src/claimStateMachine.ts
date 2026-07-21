/**
 * The maintainer-claim lifecycle state machine (new11 §6.3; formalizes ADR 0047 §"claim
 * lifecycle" + ADR 0048 §4). PURE: no clock, no fs, no network. It is the *decision
 * model* for a claim's lifecycle — the committed claim store (`claim.ts`) deliberately
 * persists only the binary `active|revoked` *serving projection* of this machine, so this
 * module changes NO schema and NO serving byte-output. The Actions/ingestion plane may
 * drive a claim through these states; `projectToStoreStatus` maps the current state onto
 * the committed status the bake already understands.
 *
 * Fail-closed is the whole point (Product Principle 2, ADR 0047 §4): only `ACTIVE` serves
 * the verified-publisher flag. Every other state — including the transient re-verification
 * states and a security `SUSPENDED` — does NOT serve. An illegal transition is rejected,
 * never silently coerced. This machine never touches a verdict, severity, or receipt
 * (ADR 0047 §1 — a claim asserts namespace control, never safety).
 */
import type { ClaimStatus } from "./claim.js"

/** The nine lifecycle states of a claim (new11 §6.3). */
export const CLAIM_LIFECYCLE_STATES = [
  "UNCLAIMED",
  "CHALLENGE_CREATED",
  "VERIFICATION_PENDING",
  "VERIFIED",
  "FAILED",
  "EXPIRED",
  "ACTIVE",
  "SUSPENDED",
  "REVOKED",
] as const
export type ClaimLifecycleState = (typeof CLAIM_LIFECYCLE_STATES)[number]

/** The seven signals that force re-verification of an existing claim (new11 §6.3). */
export const CLAIM_REVERIFY_TRIGGERS = [
  "repository_ownership_changed",
  "npm_publisher_changed",
  "domain_verification_lost",
  "provenance_broken",
  "prolonged_inactivity",
  "security_event",
  "maintainer_revoked",
] as const
export type ClaimReverifyTrigger = (typeof CLAIM_REVERIFY_TRIGGERS)[number]

/** The transition events that drive the machine. */
export type ClaimEvent =
  | "create_challenge"
  | "submit_verification"
  | "verify_ok"
  | "verify_fail"
  | "expire"
  | "activate"
  | "suspend"
  | "revoke"
  | "reverify_required"

/**
 * The legal transition table: `state → { event → nextState }`. Any (state, event) pair
 * absent here is an ILLEGAL transition and is rejected by `transition`. `REVOKED` is
 * terminal (a new claim must start over at `UNCLAIMED`), and the three transient outcome
 * states (`FAILED`/`EXPIRED`) can only restart via a fresh challenge.
 */
const TRANSITIONS: Readonly<Record<ClaimLifecycleState, Partial<Record<ClaimEvent, ClaimLifecycleState>>>> = {
  UNCLAIMED: { create_challenge: "CHALLENGE_CREATED" },
  CHALLENGE_CREATED: { submit_verification: "VERIFICATION_PENDING", expire: "EXPIRED" },
  VERIFICATION_PENDING: { verify_ok: "VERIFIED", verify_fail: "FAILED", expire: "EXPIRED" },
  VERIFIED: { activate: "ACTIVE", suspend: "SUSPENDED", revoke: "REVOKED" },
  FAILED: { create_challenge: "CHALLENGE_CREATED" },
  EXPIRED: { create_challenge: "CHALLENGE_CREATED" },
  // Active claim: an external drift/security signal forces re-verification (fail-closed:
  // it stops serving until re-verified) or an immediate suspend/revoke.
  ACTIVE: { reverify_required: "VERIFICATION_PENDING", suspend: "SUSPENDED", revoke: "REVOKED" },
  SUSPENDED: { reverify_required: "VERIFICATION_PENDING", revoke: "REVOKED" },
  REVOKED: {}, // terminal
}

/** Result of attempting a transition: either the next state, or a rejection reason. */
export type TransitionResult =
  | { ok: true; state: ClaimLifecycleState }
  | { ok: false; reason: string }

/**
 * Apply one event to a state (PURE). Returns the next state, or `{ ok: false }` with a
 * reason for an illegal transition — the caller decides; this never throws or coerces.
 */
export function transition(from: ClaimLifecycleState, event: ClaimEvent): TransitionResult {
  const next = TRANSITIONS[from][event]
  if (!next) return { ok: false, reason: `illegal transition: ${event} from ${from}` }
  return { ok: true, state: next }
}

/**
 * How each re-verify trigger acts on an existing claim (new11 §6.3). Six external drift
 * signals demand re-verification (fail-closed: `reverify_required` moves an ACTIVE claim
 * to `VERIFICATION_PENDING`, dropping the served flag until control is re-proven). The
 * maintainer's own voluntary revoke is the one trigger that terminates directly.
 */
const TRIGGER_EVENT: Readonly<Record<ClaimReverifyTrigger, ClaimEvent>> = {
  repository_ownership_changed: "reverify_required",
  npm_publisher_changed: "reverify_required",
  domain_verification_lost: "reverify_required",
  provenance_broken: "reverify_required",
  prolonged_inactivity: "reverify_required",
  security_event: "reverify_required",
  maintainer_revoked: "revoke",
}

/**
 * Apply a re-verify trigger to a claim (PURE). Only `ACTIVE`/`SUSPENDED` claims can be
 * re-triggered; a trigger against any other state is an illegal transition (the trigger's
 * mapped event won't exist in that state's row), so this reuses `transition` verbatim —
 * one transition authority, no second decision path.
 */
export function applyReverifyTrigger(
  from: ClaimLifecycleState,
  trigger: ClaimReverifyTrigger,
): TransitionResult {
  return transition(from, TRIGGER_EVENT[trigger])
}

/**
 * Project a lifecycle state onto the committed store's binary status (`claim.ts`).
 * Only `ACTIVE` serves the verified-publisher flag. Every other state — transient,
 * failed, suspended, or revoked — projects to `revoked` (⇒ no flag), which is the exact
 * fail-closed rule `verifiedPublisherFor` already enforces. `UNCLAIMED` has no record at
 * all, so it returns `null` (the caller writes nothing).
 */
export function projectToStoreStatus(state: ClaimLifecycleState): ClaimStatus | null {
  if (state === "UNCLAIMED") return null
  return state === "ACTIVE" ? "active" : "revoked"
}

/** True only when a claim in this state serves the verified-publisher flag. */
export function isServingState(state: ClaimLifecycleState): boolean {
  return state === "ACTIVE"
}
