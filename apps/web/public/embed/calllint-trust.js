/**
 * <calllint-trust> — one-tag embed of a CallLint authority verdict.
 *
 * A partner or directory shows CallLint's "observed at digest" verdict for an
 * MCP server WITHOUT running CallLint. The element fetches the read-only Partner
 * API (I2a, schema calllint.partner-api.v0) by `resource` ("{ns}/{name}") or
 * `digest` ("sha256:…"), then renders the verdict label, the observation date,
 * and a link to the full Trust Page.
 *
 * Ships as a single static ESM file from the CDN — no build step, no deps. If
 * JavaScript is off, the element's inner fallback (author a plain <a> to the
 * Trust Page inside the tag) is shown unchanged.
 *
 * Boundary (ADR 0038 §5): heuristic decision support, NOT a certification or
 * guarantee of safety; UNKNOWN is never SAFE. The badge never uses green except
 * for SAFE — mirrors the CLI badge red line (report-renderer/renderBadge.ts).
 *
 * Distinct from renderBadge.ts: that is the CLI's own scan-result shields.io
 * badge; this consumes the public Partner API and runs no scanner.
 */

/** Default CallLint origin the widget fetches from (partners embed cross-origin). */
export const DEFAULT_ORIGIN = "https://calllint.com"
/** Read-only Partner API base path (I2a). */
export const API_BASE = "/v1/public"
/** The envelope schema this widget understands. */
export const EMBED_SCHEMA = "calllint.partner-api.v0"

/** Verdict → visual tone. Only SAFE may be green (CLI badge red line). */
export const VERDICT_TONE = {
  SAFE: { fg: "#0a7a45", bg: "#e7f7ee", label: "No blockers observed" },
  REVIEW: { fg: "#a66300", bg: "#fdf3e2", label: "Review required" },
  UNKNOWN: { fg: "#555555", bg: "#eeeeee", label: "Insufficient evidence" },
  BLOCK: { fg: "#c00000", bg: "#fdeaea", label: "Blocked by policy" },
}
/** Colours shields/embeds treat as green; used by the no-green-only guard test. */
export const GREEN_TONES = ["#0a7a45", "green", "#0f0", "#00ff00", "brightgreen"]
/** Boundary micro-copy carried by every rendered badge (ADR 0038 §5). */
export const BOUNDARY_NOTE = "Not a certification or guarantee of safety."

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/

/** HTML-escape a string for safe text/attribute interpolation. */
export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/** Trim a trailing slash so `origin + API_BASE` never doubles up. */
function trimSlash(s) {
  return String(s || "").replace(/\/+$/, "")
}

/**
 * Build the Partner API URL for a widget's attributes. `digest` wins over
 * `resource`. Returns null when neither is a usable identifier.
 */
export function buildApiUrl({ origin, resource, digest } = {}) {
  const base = trimSlash(origin || DEFAULT_ORIGIN) + API_BASE
  if (digest && DIGEST_RE.test(digest)) {
    return `${base}/artifacts/${encodeURIComponent(digest)}`
  }
  if (resource && /^[^/]+\/[^/]+/.test(resource)) {
    const [ns, ...rest] = resource.split("/")
    return `${base}/resources/${encodeURIComponent(ns)}/${rest.map(encodeURIComponent).join("/")}`
  }
  return null
}

/**
 * Project a Partner API envelope into a flat, render-ready view model. Pure:
 * no fetch, no DOM. An unrecognized verdict degrades to UNKNOWN tone (never
 * to SAFE — UNKNOWN is never SAFE).
 */
export function envelopeToView(env, origin) {
  const verdict = VERDICT_TONE[env && env.verdict] ? env.verdict : "UNKNOWN"
  const tone = VERDICT_TONE[verdict]
  const base = trimSlash(origin || DEFAULT_ORIGIN)
  const page = env && env.trustPageUrl ? env.trustPageUrl : "/trust/"
  const pageUrl = /^https?:/.test(page) ? page : base + page
  const observed = env && env.observedAt ? String(env.observedAt).slice(0, 10) : ""
  return {
    name: (env && env.canonicalName) || "",
    verdict,
    label: (env && env.verdictLabel) || tone.label,
    tone,
    observed,
    digest: (env && env.artifactDigest) || "",
    pageUrl,
  }
}

/** Render a view model to a self-contained HTML string (inline-styled). */
export function viewToHtml(v) {
  const short = v.digest ? v.digest.slice(0, 14) + "…" : ""
  return (
    `<a class="calllint-trust-badge" href="${esc(v.pageUrl)}"` +
    ` title="${esc(BOUNDARY_NOTE)}" data-verdict="${esc(v.verdict)}"` +
    ` rel="noopener" target="_blank"` +
    ` style="display:inline-flex;align-items:center;gap:.5em;` +
    `font:600 12px/1.4 system-ui,sans-serif;text-decoration:none;` +
    `padding:.3em .6em;border-radius:.4em;color:${v.tone.fg};` +
    `background:${v.tone.bg};border:1px solid ${v.tone.fg}33">` +
    `<span>CallLint</span>` +
    `<span style="font-weight:700">${esc(v.label)}</span>` +
    (v.observed ? `<span style="opacity:.7;font-weight:400">@ ${esc(v.observed)}</span>` : "") +
    (short ? `<span style="opacity:.55;font-weight:400">${esc(short)}</span>` : "") +
    `</a>`
  )
}

// --- Custom element (browser only) -----------------------------------------
// Guard every DOM global so this module also imports cleanly under Node (tests).
const Base = typeof HTMLElement !== "undefined" ? HTMLElement : class {}

export class CalllintTrust extends Base {
  static get observedAttributes() {
    return ["resource", "digest", "base"]
  }
  connectedCallback() {
    this._render()
  }
  attributeChangedCallback() {
    if (this.isConnected) this._render()
  }
  async _render() {
    const origin = this.getAttribute("base") || DEFAULT_ORIGIN
    const url = buildApiUrl({
      origin,
      resource: this.getAttribute("resource"),
      digest: this.getAttribute("digest"),
    })
    if (!url) return // no identifier → leave author's fallback markup intact
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } })
      if (!res.ok) return // 4xx/5xx → keep fallback link
      const env = await res.json()
      if (!env || env.schema !== EMBED_SCHEMA) return
      this.innerHTML = viewToHtml(envelopeToView(env, origin))
    } catch {
      // network/parse error → keep the author's fallback markup
    }
  }
}

if (typeof customElements !== "undefined" && !customElements.get("calllint-trust")) {
  customElements.define("calllint-trust", CalllintTrust)
}
