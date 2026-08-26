/**
 * Per-request body churn: normalization rules, and why this is not a heuristic.
 *
 * check-official-sources.mjs is forbidden from "adding a heuristic that guesses"
 * whether a change matters. These rules do not guess. Every one was derived by
 * fetching the SAME url twice ~1.5s apart and diffing the bytes: anything that
 * differs between two fetches that close together cannot be a product change a
 * vendor made. Stripping it is a statement about the transport, not a judgement
 * about content.
 *
 * The raw sha256 is never discarded. A body whose raw hash moved but whose
 * normalized hash did not is reported under `suppressedBodyChurn` — suppressed
 * from the change list, still recorded in the artifact.
 *
 * Adding a rule requires that same evidence: two fetches, the diff, the token.
 * The first version of this file was written from a previous measurement's
 * *summary* instead of its bytes, and suppressed 2 of 14 churning urls. The
 * rules below were derived from an actual byte diff of github.com/cline/cline
 * (403092 vs 403093 bytes, 20 differing lines, six token classes).
 *
 * A rule's third element may be a FACTORY function, called once per body, which
 * returns the String.replace replacer. That lets a rule hold per-body state
 * without leaking it across hosts.
 */

/**
 * GitHub's Primer components mint a fresh uuid per render for each interactive
 * element, and cross-reference it from `for=` / `aria-labelledby=`. Collapsing
 * them all to one constant would erase that pairing, so a product change that
 * only RE-PAIRS elements would go unreported. Numbering by first appearance
 * instead is order-sensitive: it can only make this observer noisier, never
 * quieter. That direction is the safe one.
 */
const orderedDomIds = () => {
  const seen = new Map()
  return (_match, prefix, uuid) => {
    if (!seen.has(uuid)) seen.set(uuid, `uuid${seen.size + 1}`)
    return prefix + seen.get(uuid)
  }
}

/**
 * Zero the leaf values of github's per-request csrf token map while KEEPING its
 * path keys, so a product change that alters which paths get a token is still
 * observable. Collapsing the map to `{}` would have hidden that.
 */
const csrfTokenValues = () => (_m, open, body, close) =>
  open + body.replace(/:"[^"]*"/g, ':""') + close

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
// Attributes measured to carry a generated uuid on github's rendered pages.
const ID_ATTRS = 'id|for|aria-labelledby|aria-describedby|popovertarget|aria-controls|anchor'

/** [label, pattern, replacement | factory] — label appears in the artifact. */
export const NORMALIZATION_RULES = [
  // github: per-request request id, on <meta> and inside the base64 payload.
  ['github-request-id', /(<meta name="request-id" content=")[^"]*/g, '$1'],
  ['github-html-safe-nonce', /(<meta name="html-safe-nonce" content=")[^"]*/g, '$1'],
  // github: a v2:<uuid> nonce minted per render, echoed onto elements as data-nonce.
  ['github-fetch-nonce', /(<meta name="fetch-nonce" content=")[^"]*/g, '$1'],
  ['github-data-nonce', /(\sdata-nonce=")v2:[^"]*/g, '$1'],
  // github: visitor-payload base64-encodes the request_id AND a per-request
  // visitor_id; visitor-hmac signs it. Both move on every fetch.
  ['github-visitor-payload', /(<meta name="visitor-payload" content=")[^"]*/g, '$1'],
  ['github-visitor-hmac', /(<meta name="visitor-hmac" content=")[^"]*/g, '$1'],
  // github: an anonymous per-session upload token embedded in the page's JSON.
  // Never echoed anywhere — matched only to erase it before hashing.
  ['github-upload-token', /("uploadToken":")[^"]*/g, '$1'],
  ['github-csrf-tokens', /("csrf_tokens":\{)((?:[^{}]|\{[^{}]*\})*)(\})/g, csrfTokenValues],
  // github/primer: uuid element ids + the attributes that reference them.
  ['dom-generated-uuid-ids', new RegExp(`((?:${ID_ATTRS})="[^"]*?)${UUID}`, 'g'), orderedDomIds],
  // rails-style per-request csrf token (pulsemcp).
  ['rails-csrf-token', /(<meta name="csrf-token" content=")[^"]*/g, '$1'],
  // cloudflare challenge params: a per-response ray id and a unix timestamp (pulsemcp).
  ['cloudflare-cv-params', /(__CF\$cv\$params=\{r:')[^']*(',t:')[^']*/g, '$1$2'],
  // cloudflare email obfuscation re-keys its hex on every response (pulsemcp).
  ['cloudflare-email-protection', /(\/cdn-cgi\/l\/email-protection#)[0-9a-f]+/g, '$1'],
  // vercel edge trace id (openai developers docs).
  ['vercel-trace', /[a-z]{3}\d::[a-z0-9]{5,6}-\d{13}-[a-f0-9]{12}/g, 'VERCEL_TRACE'],
  /*
   * No rule for windsurf's `hnd1::<epoch>.<n>.<base64>` trace. Stripping the epoch was tried
   * and dropped: the base64 payload after it moves too, so the body still did not converge and
   * the rule bought nothing. A rule that fires without changing any verdict is unearned surface.
   * windsurf stays in UNCOVERED_CHURN — see the corrected reason there.
   */
  // tencent cloud per-request id rendered into the error element.
  ['tencent-reqid', /(error-reqid[^>]*>)[^<]*/g, '$1'],
]

/**
 * Hosts whose churn these rules do NOT cover. Declared in the artifact so the
 * gap is visible instead of looking like a quiet week: a [BODY] from one of
 * these may still be per-request noise, and a human has to look.
 */
export const UNCOVERED_CHURN = [
  {
    hostId: 'windsurf',
    // Corrected 2026-08-26. The previous reason — "regenerated obfuscated inline script; not
    // normalizable without executing JS" — was wrong: the script is not what changes. A
    // per-request trace `hnd1::<epoch>.<n>.<base64>` is rendered into the page, and both the
    // epoch and the base64 payload after it move. Normalizing an arbitrary-length base64 blob
    // would be broad enough to hide a real content change, so this one is left reported.
    reason: 'per-request base64 trace payload rendered into the page; too broad to strip safely',
  },
]

/** @returns {{ text: string, applied: string[] }} */
export function normalizeBody(body) {
  let text = body
  const applied = []
  for (const [label, pattern, replacement] of NORMALIZATION_RULES) {
    // A factory is invoked per body, so its state never crosses hosts.
    const replacer = typeof replacement === 'function' ? replacement() : replacement
    const next = text.replace(pattern, replacer)
    if (next !== text) applied.push(label)
    text = next
  }
  return { text, applied }
}
