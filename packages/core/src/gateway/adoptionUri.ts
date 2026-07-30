/**
 * `calllint://adoption/{canonicalSlug}[@{version}][?artifact=…&contract=…]` — the
 * OS-level deep link an install page emits, parsed as HOSTILE input.
 *
 * The URI arrives from a web page, so nothing in it is trusted. This module is
 * PURE and TOTAL: it converts a string into either a rejection with a reason, or a
 * normalized request whose every field has been shape-checked. It resolves nothing,
 * reads nothing, and writes nothing — a caller cannot use this result to skip the
 * local approval, because it does not carry a plan.
 *
 * The grammar deliberately matches the shipped MCP resource URI
 * (`packages/calllint-mcp/src/resources.ts`): same scheme prefix, slugs may contain
 * `/`, and an optional version pins at the LAST `@` so a scoped slug is safe. One
 * URI shape means one thing in both surfaces. The digests are a query-string
 * ADDITION, not a grammar change — they are ASSERTIONS the caller re-checks against
 * locally committed bytes, never a source of truth.
 *
 * Naming: `adoption/`, never `safe-install/`. new14 open-risks rejects any PR
 * reviving the `calllint://safe-install/...` spelling.
 */

/** The scheme prefix, identical to the MCP resource surface. */
export const ADOPTION_URI_SCHEME = "calllint://adoption/"

/** A sha256 digest as it appears in the contract sidecars. */
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/

/**
 * Conservative slug shape: the published canonical names are
 * `mcp-registry/<reverse.dns.name>`. No `%`, so a percent-encoded traversal cannot
 * survive; no `..`; no whitespace; no scheme punctuation.
 */
const SLUG_RE = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/

/** Semver-ish, and the only characters a committed `subject.version` uses. */
const VERSION_RE = /^[a-zA-Z0-9][a-zA-Z0-9.+-]*$/

/** Why a URI was refused. Every rejection names exactly one cause. */
export type AdoptionUriRejection =
  | "NOT_AN_ADOPTION_URI"
  | "EMPTY_TARGET"
  | "MALFORMED_SLUG"
  | "MALFORMED_VERSION"
  | "MALFORMED_DIGEST"
  | "UNKNOWN_QUERY_PARAM"
  | "DUPLICATE_QUERY_PARAM"

/** A shape-checked deep-link request. Carries no plan and no authority. */
export interface AdoptionUriRequest {
  readonly canonicalSlug: string
  /** null ⇒ the URI pinned no version (the caller must not invent one). */
  readonly version: string | null
  /** Asserted artifact digest, to be re-checked locally. null ⇒ not asserted. */
  readonly expectedArtifactDigest: string | null
  /** Asserted contract digest, to be re-checked locally. null ⇒ not asserted. */
  readonly expectedContractDigest: string | null
}

export type AdoptionUriParse =
  | { readonly ok: true; readonly request: AdoptionUriRequest }
  | { readonly ok: false; readonly reason: AdoptionUriRejection; readonly detail: string }

function reject(reason: AdoptionUriRejection, detail: string): AdoptionUriParse {
  return { ok: false, reason, detail }
}

/**
 * The only recognized query keys. An unknown key is a REJECTION rather than
 * something ignored: a future handler that grows a meaningful parameter must not
 * silently inherit today's leniency on a link an attacker already published.
 */
const ALLOWED_PARAMS = new Set(["artifact", "contract"])

/** Parse the query string with no URL/URLSearchParams dependency (total, no throw). */
function parseQuery(
  q: string,
): { readonly ok: true; readonly params: Map<string, string> } | AdoptionUriParse {
  const params = new Map<string, string>()
  if (q === "") return { ok: true, params }

  for (const pair of q.split("&")) {
    if (pair === "") continue
    const eq = pair.indexOf("=")
    const key = eq === -1 ? pair : pair.slice(0, eq)
    const value = eq === -1 ? "" : pair.slice(eq + 1)
    if (!ALLOWED_PARAMS.has(key)) return reject("UNKNOWN_QUERY_PARAM", key)
    // A repeated key is ambiguous (first-wins vs last-wins is a parser detail an
    // attacker can exploit against a differing reader), so refuse it outright.
    if (params.has(key)) return reject("DUPLICATE_QUERY_PARAM", key)
    params.set(key, value)
  }
  return { ok: true, params }
}

/**
 * Parse a deep link. Fails closed on anything unexpected — a malformed URI is never
 * repaired into a nearby valid one, because "nearby" is attacker-controlled.
 */
export function parseAdoptionUri(uri: string): AdoptionUriParse {
  if (!uri.startsWith(ADOPTION_URI_SCHEME)) return reject("NOT_AN_ADOPTION_URI", uri.slice(0, 40))

  let rest = uri.slice(ADOPTION_URI_SCHEME.length)

  // Strip a fragment before anything else: it is never meaningful here, and leaving
  // it attached would let `#` smuggle characters into the version or a digest.
  const hash = rest.indexOf("#")
  if (hash !== -1) rest = rest.slice(0, hash)

  const qmark = rest.indexOf("?")
  const target = qmark === -1 ? rest : rest.slice(0, qmark)
  const parsedQuery = parseQuery(qmark === -1 ? "" : rest.slice(qmark + 1))
  if (!("params" in parsedQuery)) return parsedQuery

  if (target === "") return reject("EMPTY_TARGET", uri)

  // Version pins at the LAST `@`, matching the MCP resource reader. `at > 0` so a
  // leading `@` stays part of the slug rather than producing an empty slug.
  let canonicalSlug = target
  let version: string | null = null
  const at = target.lastIndexOf("@")
  if (at > 0) {
    canonicalSlug = target.slice(0, at)
    version = target.slice(at + 1)
  }

  if (!SLUG_RE.test(canonicalSlug)) return reject("MALFORMED_SLUG", canonicalSlug)
  if (version !== null && !VERSION_RE.test(version)) return reject("MALFORMED_VERSION", version)

  const artifact = parsedQuery.params.get("artifact") ?? null
  const contract = parsedQuery.params.get("contract") ?? null
  if (artifact !== null && !DIGEST_RE.test(artifact)) return reject("MALFORMED_DIGEST", artifact)
  if (contract !== null && !DIGEST_RE.test(contract)) return reject("MALFORMED_DIGEST", contract)

  return {
    ok: true,
    request: {
      canonicalSlug,
      version,
      expectedArtifactDigest: artifact,
      expectedContractDigest: contract,
    },
  }
}

/**
 * Build the deep link for a page. Shares the parser's grammar so the emitted link
 * and the accepted link cannot drift; a test asserts round-tripping.
 *
 * Returns null when any input fails the same shapes the parser enforces, so an
 * un-parseable link is structurally impossible to emit.
 */
export function buildAdoptionUri(r: AdoptionUriRequest): string | null {
  if (!SLUG_RE.test(r.canonicalSlug)) return null
  if (r.version !== null && !VERSION_RE.test(r.version)) return null
  if (r.expectedArtifactDigest !== null && !DIGEST_RE.test(r.expectedArtifactDigest)) return null
  if (r.expectedContractDigest !== null && !DIGEST_RE.test(r.expectedContractDigest)) return null

  const target = r.version === null ? r.canonicalSlug : `${r.canonicalSlug}@${r.version}`
  const query: string[] = []
  if (r.expectedArtifactDigest !== null) query.push(`artifact=${r.expectedArtifactDigest}`)
  if (r.expectedContractDigest !== null) query.push(`contract=${r.expectedContractDigest}`)
  const suffix = query.length === 0 ? "" : `?${query.join("&")}`
  return `${ADOPTION_URI_SCHEME}${target}${suffix}`
}
