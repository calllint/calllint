/**
 * Trust-event sanitization — the structural privacy guarantee (new13 §Phase-2.5-B,
 * ADR 0055 §2).
 *
 * `sanitizeTrustEvent` NEVER copies an input object through. It reads only the
 * known-safe fields by name and BUILDS a fresh event from that allowlist, so a
 * forbidden or unknown field is structurally incapable of reaching output. It is
 * **fail-closed** for writes: on an unknown event name, an oversized payload, a
 * present forbidden field, a wrong wire tag, or a malformed coarse dimension it
 * returns `null` (the event is DROPPED — never stored, never surfaced; ADR 0055
 * §2). The caller (the Cloudflare Pages function) still answers `204 No Content`
 * either way, so the write outcome is invisible to the client (fail-OPEN for UX).
 *
 * Purity: no clock (the observation instant `now` is injected), no network, no
 * fs — identical posture to @calllint/telemetry-contract. The one permitted
 * coarse dimension (`pageBucket`) MUST already be hashed server-side by the
 * caller (ADR 0055 §2 "server-side hashing of any coarse dimension"); this
 * module only validates its `sha256:…` shape and never sees a raw path.
 */
import {
  FORBIDDEN_FIELDS,
  PAGE_BUCKET_RE,
  TRUST_EVENT_VERSION,
  TRUST_EVENTS,
  type TrustEventName,
} from "./events.js"

/** The maximum accepted raw payload size, in bytes of its JSON form. A larger
 *  body is dropped unread (fail-closed): a funnel ping is a handful of fields. */
export const MAX_RAW_BYTES = 512

/** A raw, untrusted event as posted by the client shim (before sanitization). */
export interface RawTrustEvent {
  schema?: unknown
  event?: unknown
  /** Optional server-hashed coarse dimension (`sha256:…`); never a raw path. */
  pageBucket?: unknown
  [k: string]: unknown
}

/** The closed, storable shape. ONLY these fields can ever appear in output. */
export interface SanitizedTrustEvent {
  schema: typeof TRUST_EVENT_VERSION
  event: TrustEventName
  /** ISO-8601 UTC observation instant, injected by the caller (never client-set). */
  ts: string
  /** Present only when the caller supplied a well-formed server-hashed bucket. */
  pageBucket?: string
}

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.length > 0

/**
 * Validate + sanitize a raw trust event into the closed contract shape, or return
 * `null` to signal a fail-closed DROP. Deterministic given (`raw`, `now`).
 *
 * @param raw the untrusted client payload (already JSON-parsed).
 * @param now ISO-8601 UTC instant to stamp as `ts` (injected; no clock here).
 */
export function sanitizeTrustEvent(raw: unknown, now: string): SanitizedTrustEvent | null {
  // Reject anything that is not a plain object outright (fail-closed).
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null
  const input = raw as RawTrustEvent

  // Oversized payloads are dropped unread — a funnel ping is tiny by construction.
  let rawBytes: number
  try {
    rawBytes = byteLength(JSON.stringify(input))
  } catch {
    return null // non-serializable (e.g. a cycle) → drop
  }
  if (rawBytes > MAX_RAW_BYTES) return null

  // A forbidden field being PRESENT is a hard drop — never silently stripped, so a
  // caller can't accidentally normalize away a leak (mirrors telemetry-contract).
  for (const f of FORBIDDEN_FIELDS) {
    if (f in input) return null
  }

  // Wire identity (ADR 0055 §5): the tag is enforced by string-compare.
  if (input.schema !== TRUST_EVENT_VERSION) return null

  // Closed event vocabulary.
  if (!isNonEmptyString(input.event)) return null
  if (!(TRUST_EVENTS as readonly string[]).includes(input.event)) return null

  // The injected instant must be a usable ISO-8601 string (the SERVER's clock).
  if (!isNonEmptyString(now) || Number.isNaN(Date.parse(now))) return null

  // Allowlist construction: ONLY these fields can ever appear in output.
  const out: SanitizedTrustEvent = {
    schema: TRUST_EVENT_VERSION,
    event: input.event as TrustEventName,
    ts: now,
  }

  // The one permitted coarse dimension: accept ONLY a well-formed server hash.
  // A malformed bucket fails the whole write closed (it signals a broken caller).
  if (input.pageBucket !== undefined) {
    if (typeof input.pageBucket !== "string" || !PAGE_BUCKET_RE.test(input.pageBucket)) {
      return null
    }
    out.pageBucket = input.pageBucket
  }

  return out
}

/** UTF-8 byte length without depending on Node's Buffer (works in a CF worker). */
function byteLength(s: string): number {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s).length
  // Fallback for any runtime without TextEncoder (not expected in CF/Node 20).
  return unescape(encodeURIComponent(s)).length
}
