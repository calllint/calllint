/**
 * Telemetry contract — the closed vocabulary (new11 §3.5, ADR 0049 §2.6).
 *
 * This module is DATA ONLY: allowed events, the forbidden-field denylist, the
 * `source` tiers, and result labels. It is decoupled from the verdict path
 * (new11 §1.5) — importing it must never change scan output. Emission itself
 * lives elsewhere; this package only defines and sanitizes the shape.
 */

/** The only event names that may ever be emitted (new11 §3.5 allowed events). */
export const ALLOWED_EVENTS = [
  "install_completed",
  "preflight_completed",
  "decision_safe",
  "decision_review",
  "decision_block",
  "decision_unknown",
  "approval_created",
  "apply_completed",
  "verify_completed",
  "rollback_completed",
  "guard_drift_detected",
  "trust_page_viewed",
  "trust_page_to_install",
  "partner_api_called",
  "badge_rendered",
] as const
export type TelemetryEventName = (typeof ALLOWED_EVENTS)[number]

/**
 * Fields that MUST NOT appear on any event (new11 §3.5 forbidden fields). These
 * carry config bodies, commands, secrets, private-repo identity, or model-visible
 * text — none of which may leave the machine. Enforced structurally by the
 * sanitizer (allowlist output) AND defensively by security-boundary.yml.
 */
export const FORBIDDEN_FIELDS = [
  "rawConfig",
  "command",
  "environmentValue",
  "secret",
  "fileContents",
  "privateRepository",
  "userPrompt",
  "findingEvidenceText",
] as const
export type ForbiddenField = (typeof FORBIDDEN_FIELDS)[number]

/** Emitting surface. Maps 1:1 to the four telemetry tiers (see tiers.ts). */
export const SOURCES = ["cli", "ci", "server", "install"] as const
export type TelemetrySource = (typeof SOURCES)[number]

/** Decision/verdict labels that may ride on an event `result` (aggregate only). */
export const RESULTS = ["SAFE", "REVIEW", "BLOCK", "UNKNOWN"] as const
export type TelemetryResult = (typeof RESULTS)[number]

export const EVENT_VERSION = "1.0.0"
