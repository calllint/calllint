/**
 * Trust-event contract — the closed web-funnel vocabulary (new13 §Phase-2.5-B,
 * ADR 0055 §2/§5).
 *
 * This module is DATA ONLY: the wire tag, the allowed event names, and the
 * forbidden-field denylist. It defines the first-party, privacy-preserving
 * funnel stream that later counts Trust-page → install-intent conversion with
 * NO third-party vendor and NO LLM (ADR 0055 §2). It is fully decoupled from the
 * verdict path — importing it can never change a scan verdict or a page digest.
 * Emission (a Cloudflare Pages function) and the client shim live elsewhere; this
 * package only DEFINES and SANITIZES the shape, mirroring @calllint/telemetry-contract.
 */

/**
 * Wire identity (ADR 0055 §5): the single source of truth for the tag. The code
 * enforces it by string-compare (there is no runtime ajv anywhere in the repo),
 * exactly as install-planner/src/verifyDecisionReceipt.ts does for
 * `calllint.receipt.v1`. The property that carries it is `schema` — the
 * evidence-manifest / decision-receipt idiom, not telemetry's `eventVersion`.
 */
export const TRUST_EVENT_VERSION = "calllint.trust-event.v1" as const

/**
 * The only event names that may ever be stored (closed vocabulary). The first
 * two are REUSED verbatim from the CLI telemetry vocabulary
 * (@calllint/telemetry-contract ALLOWED_EVENTS) so the web funnel and the CLI
 * telemetry names never diverge; the last two are web-surface-specific and map
 * to shipped pages (the /trust/app-created.html landing from PR #215 and the
 * claim CTA on an unclaimed Trust Page).
 */
export const TRUST_EVENTS = [
  "trust_page_viewed",
  "trust_page_to_install",
  "app_created_viewed",
  "claim_cta_clicked",
] as const
export type TrustEventName = (typeof TRUST_EVENTS)[number]

/**
 * Fields that MUST NOT appear on a raw event — they carry PII, high-cardinality
 * identifiers, or free text that could smuggle a URL/token/prompt. The closed
 * output shape (allowlist construction + `additionalProperties:false`) already
 * makes them structurally impossible to store; this denylist is defense in depth
 * and is asserted by the sanitizer test. Note `page`: a raw path is never stored
 * — the serving function hashes it server-side into `pageBucket` first (ADR 0055
 * §2 "server-side hashing of any coarse dimension"), so a raw `page` reaching the
 * sanitizer is itself a drop signal.
 */
export const FORBIDDEN_FIELDS = [
  "page",
  "url",
  "referrer",
  "referer",
  "userAgent",
  "ip",
  "cookie",
  "query",
  "email",
] as const
export type ForbiddenField = (typeof FORBIDDEN_FIELDS)[number]

/** Shape of the one permitted coarse dimension after server-side hashing. */
export const PAGE_BUCKET_RE = /^sha256:[0-9a-f]{64}$/
