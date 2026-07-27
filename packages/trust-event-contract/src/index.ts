/**
 * @calllint/trust-event-contract — the closed web-funnel vocabulary + sanitizer
 * for the first-party trust-event stream (new13 §Phase-2.5-B, ADR 0055 §2/§5).
 *
 * This package is DEFINITION + SANITIZATION only. It never emits, never touches
 * the network, holds no clock, and has ZERO runtime dependencies — the same
 * scanner-free posture as @calllint/telemetry-contract, so it can be imported by
 * the serving deployable (the Cloudflare Pages function) without dragging a
 * scanner in (ADR 0038 §3). Importing it can never change a verdict or a page
 * digest. Actual emission routes every raw payload through `sanitizeTrustEvent`,
 * which fails closed (drops) on anything off-contract.
 */
export {
  TRUST_EVENT_VERSION,
  TRUST_EVENTS,
  FORBIDDEN_FIELDS,
  PAGE_BUCKET_RE,
  type TrustEventName,
  type ForbiddenField,
} from "./events.js"
export {
  sanitizeTrustEvent,
  MAX_RAW_BYTES,
  type RawTrustEvent,
  type SanitizedTrustEvent,
} from "./sanitize.js"
