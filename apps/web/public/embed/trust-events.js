/**
 * trust-events.js — the first-party, privacy-preserving funnel beacon
 * (new13 §Phase-2.5-B; ADR 0055 §2).
 *
 * A page can count Trust-page → install-intent conversion WITHOUT a third-party
 * vendor and WITHOUT any LLM. This shim POSTs a closed, tiny event to the
 * same-origin sink /v1/events/trust; the server hashes the coarse page dimension
 * and stores nothing raw (see functions/v1/events/trust.ts).
 *
 * Ships as a single static ESM file from the CDN — no build step, no deps,
 * import-free (so the embed "no bare import" guard holds). Distinct from
 * calllint-trust.js: that RENDERS a verdict badge from the Partner API; this
 * only EMITS a funnel event and renders nothing.
 *
 * Privacy posture (ADR 0055 §2), enforced here + server-side:
 *   • first-party only — same-origin POST, no external beacon, no vendor;
 *   • PII-free — sends only the coarse pathname (query + fragment stripped HERE,
 *     before anything leaves the browser) and a closed event name;
 *   • cookie-free — the fetch fallback omits credentials; this shim writes no
 *     cookie and no web-storage entry;
 *   • the raw path is hashed SERVER-SIDE into a sha256 bucket, so it is never
 *     stored raw;
 *   • no LLM anywhere on the path.
 *
 * SHIPS DARK this round: referenced by NO page, and /v1/events/trust is not in
 * _routes.json, so the sink is unreachable in production. Wiring a page to call
 * sendTrustEvent(...) and flipping _routes.json is a later, explicit go-live step.
 */

/** The frozen first-party sink path (must equal the CF route it targets). */
export const EVENTS_PATH = "/v1/events/trust"

/** Wire identity — MUST equal @calllint/trust-event-contract's TRUST_EVENT_VERSION
 *  (asserted by the shim's anti-drift test; inlined because this file is import-free). */
export const TRUST_EVENT_SCHEMA = "calllint.trust-event.v1"

/** The closed funnel-event vocabulary — MUST set-equal the contract's TRUST_EVENTS
 *  (asserted by the anti-drift test). An off-vocabulary event is dropped, never sent. */
export const TRUST_EVENTS = ["trust_page_viewed", "trust_page_to_install", "app_created_viewed", "claim_cta_clicked"]

/** Coarsen a page identifier to a bare, capped path — query + fragment stripped so a
 *  token or PII in the URL never leaves the browser. Returns "" for a non-string. */
function coarsePath(raw) {
  if (typeof raw !== "string" || !raw) return ""
  return raw.split(/[?#]/)[0].slice(0, 256)
}

/** The current pathname, guarded so the module also imports cleanly under Node (tests). */
function currentPath() {
  return typeof location !== "undefined" && location ? location.pathname : ""
}

/**
 * Build the closed wire payload for a funnel event. Pure: no network, no DOM.
 * Fails closed — returns null for any event outside the closed vocabulary, so a
 * typo can never be sent. `page` is the coarse dimension the SERVER will hash;
 * it is coarsened here and omitted when empty.
 */
export function buildPayload(event, page) {
  if (TRUST_EVENTS.indexOf(event) === -1) return null
  const out = { schema: TRUST_EVENT_SCHEMA, event }
  const p = coarsePath(page)
  if (p) out.page = p
  return out
}

/**
 * Emit a funnel event to the first-party sink. Prefers navigator.sendBeacon (fires
 * reliably during unload); falls back to a keepalive, credential-less fetch. Every
 * DOM/network global is guarded, so calling this under Node is a safe no-op-ish path.
 * Returns true when a send was dispatched, false when nothing was sent (off-vocabulary
 * event, or no transport available). Never throws.
 */
export function sendTrustEvent(event, opts) {
  opts = opts || {}
  const page = opts.page != null ? opts.page : currentPath()
  const payload = buildPayload(event, page)
  if (!payload) return false // off-vocabulary → send nothing (fail closed)
  const body = JSON.stringify(payload)

  const nav = typeof navigator !== "undefined" ? navigator : null
  if (nav && typeof nav.sendBeacon === "function") {
    try {
      // A string beacon is a CORS-simple request; our server reads the body as JSON
      // regardless of content-type, so no Blob (and no preflight) is needed.
      return nav.sendBeacon(EVENTS_PATH, body)
    } catch (_e) {
      // fall through to fetch
    }
  }
  if (typeof fetch === "function") {
    try {
      fetch(EVENTS_PATH, {
        method: "POST",
        body: body,
        keepalive: true,
        credentials: "omit", // cookie-free: never attach credentials
        headers: { "content-type": "application/json" },
      }).catch(function () {})
      return true
    } catch (_e) {
      return false
    }
  }
  return false
}
