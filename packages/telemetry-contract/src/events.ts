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

/**
 * WHICH KIND OF DISCOVERY SURFACE a run arrived through (new19 §21) — optional,
 * and deliberately a SEPARATE dimension from `source`.
 *
 * `source` answers "what emitted this" (cli / ci / server / install) and is a
 * closed four-tier enum wired to the gate defaults in tiers.ts. Widening it to
 * carry discovery provenance would have changed which tier a run is gated under,
 * i.e. a privacy control, to record an analytics fact. So this is additive: a run
 * from the CLI reached via the MCP registry is still `source: "cli"`, now with
 * `discoverySurface: "mcp-registry"`.
 *
 * THESE ARE SURFACE **TYPES**, NOT SURFACE IDS, for two reasons measured against
 * the 23 published surfaces:
 *
 *   1. Ids are not safe tokens. An id like `io.github.calllint/calllint` contains
 *      `/`, which the ingress's `SAFE_TOKEN_PATTERN` excludes on purpose so a
 *      filesystem path can never be stored as a dimension. A vocabulary whose own
 *      members fail the server's validator would be rejected on arrival.
 *   2. Ids are high-cardinality and per-host. 23 ids × the existing key dimensions
 *      makes daily rows that can approach one-install granularity; 6 types keep a
 *      row a genuine aggregate. new18 §20's never-persist stance is about what a
 *      row can single out, not only about field names.
 *
 * This list MUST equal the published surface-type vocabulary. That equality is the
 * denominator — otherwise a seventh type added upstream would silently arrive here
 * as an off-vocabulary value and be dropped, and a dropped dimension is invisible
 * in an aggregate counter. It is asserted in `tests/invariants/`, NOT here: §23
 * forbids anything under `packages/` from naming a distribution artifact, and this
 * package must stay readable without one. See
 * tests/invariants/telemetry-surface-vocabulary.invariants.test.ts.
 */
export const DISCOVERY_SURFACES = [
  "agent-harness",
  "mcp-registry",
  "marketplace",
  "documentation",
  "search-surface",
  "mirror",
] as const
export type DiscoverySurface = (typeof DISCOVERY_SURFACES)[number]

/** Decision/verdict labels that may ride on an event `result` (aggregate only). */
export const RESULTS = ["SAFE", "REVIEW", "BLOCK", "UNKNOWN"] as const
export type TelemetryResult = (typeof RESULTS)[number]

export const EVENT_VERSION = "1.0.0"
