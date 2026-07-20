/**
 * @calllint/telemetry-contract — the closed telemetry vocabulary, tier policy,
 * sanitizer, and anonymous-installation-id contract (new11 §3.5, ADR 0049 §2.6).
 *
 * This package is DEFINITION + SANITIZATION only. It never emits, never touches
 * the network, and is fully decoupled from the verdict path (§1.5): importing it
 * cannot change scan output. Actual emission (if/when wired) must route every
 * event through sanitizeEvent and honor TIER_POLICY defaults.
 */
export {
  ALLOWED_EVENTS,
  FORBIDDEN_FIELDS,
  SOURCES,
  RESULTS,
  EVENT_VERSION,
  type TelemetryEventName,
  type ForbiddenField,
  type TelemetrySource,
  type TelemetryResult,
} from "./events.js"
export { TIER_POLICY, isEnabledByDefault, type TierPolicy } from "./tiers.js"
export {
  sanitizeEvent,
  bucketDuration,
  type RawEventInput,
  type SanitizedEvent,
} from "./sanitize.js"
export {
  INSTALLATION_ID_PREFIX,
  makeInstallationId,
  isValidInstallationId,
  assertNotFingerprint,
} from "./installationId.js"
