/**
 * Maintainer-claim records — the committed, PII-free Git store that the bake reads
 * to write a `verifiedPublisher` flag onto a Trust Page (ADR 0047 + ADR 0048 §2/§3).
 *
 * This module is the PURE half of I2c: types + deterministic verification over an
 * already-committed store. It performs NO GitHub API call, NO OAuth, NO clock, NO
 * network, NO filesystem read — those live in the Actions/ingestion plane (ADR 0048
 * §2) which mints an ephemeral installation token, verifies control, and *commits*
 * a record here. The serving plane never touches this file; it only reads the baked
 * flag off the static page (ADR 0046 §1, 0047 §6).
 *
 * A claim asserts NAMESPACE CONTROL, never safety (ADR 0047 §1). It never changes a
 * verdict. Verification here answers exactly one question: "for this canonical
 * namespace, is there exactly one currently-active claim record?" — and it FAILS
 * CLOSED (ADR 0047 §4): absent, revoked, or ambiguous (>1 active) ⇒ not verified.
 *
 * PII-free by construction (ADR 0038 §5, 0047 §7): a record holds only the public
 * GitHub handle of the controlling account, the installation id, the pinned artifact
 * digest observed at claim time (for drift transparency, NOT gating), a granted-scope
 * digest, and timestamps. No OAuth tokens, no emails, no personal names.
 */

/** The lifecycle state of a claim record (ADR 0048 §4 — revocation fails closed). */
export type ClaimStatus = "active" | "revoked"

/** One committed claim record — the minimum re-verification needs (ADR 0048 §3). */
export interface ClaimRecord {
  schema: "calllint.claim.v0"
  /** The canonical `{ns}/{name}` of the resource this claim covers. */
  canonicalName: string
  /** Public GitHub account/org that installed the App and controls the namespace. */
  owner: string
  /** GitHub App installation id — the durable, revocable control grant (ADR 0048 §1). */
  installationId: number
  /** Artifact digest observed when the claim was recorded — drift transparency only. */
  artifactDigest: `sha256:${string}`
  /** Digest of the granted installation scope, for auditability (no scope contents). */
  scopeDigest: `sha256:${string}`
  /** ISO-8601 UTC the Actions job recorded/last-verified this claim. */
  verifiedAt: string
  /** Lifecycle: `revoked` (uninstall / failed re-verification) drops the flag. */
  status: ClaimStatus
  /**
   * NEW, additive, optional (D6 namespace-claim inheritance, ADR 0047 §3 "the claim
   * covers the namespace's resources"). When PRESENT, this record is a NAMESPACE claim:
   * it covers every registry entry whose reverse-DNS namespace (the segment before the
   * first `/` of the ORIGINAL registry name) equals this value — e.g. `io.github.calllint`
   * covers `io.github.calllint/calllint`, `io.github.calllint/other`, and future children.
   * ABSENT ⇒ an exact-resource claim keyed on `canonicalName` (today's behavior, verbatim).
   *
   * It stores the reverse-DNS namespace DIRECTLY (not the lossy filesystem slug), because
   * `registryCanonicalName` flattens `/`→`-` and hyphens occur in both the namespace and
   * the server — so the boundary is unrecoverable from `canonicalName`. A reverse-DNS
   * namespace never contains `/`. On a namespace record, `canonicalName` is only an
   * audit-friendly label (`mcp-registry/<registryNamespace>`) and is NOT used for matching.
   */
  registryNamespace?: string
}

/** The committed claim store document (a single JSON file in the Git store). */
export interface ClaimStore {
  schema: "calllint.claim-store.v0"
  records: ClaimRecord[]
}

/**
 * The baked, serving-facing flag written onto a Trust Page sidecar (ADR 0048 §2 step
 * 4). Deliberately minimal and boundary-safe: it states WHO controls the namespace,
 * never a safety claim. `observedArtifactDigest` is the digest pinned at claim time,
 * surfaced only so a viewer can see whether the current page has drifted from it.
 */
export interface VerifiedPublisher {
  owner: string
  verifiedAt: string
  observedArtifactDigest: `sha256:${string}`
}

/** An email-like token — rejected in a record `owner` as defense-in-depth vs PII. */
const EMAIL_LIKE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/

/**
 * Parse + validate a committed claim store from its JSON text. Pure. Throws on a
 * wrong schema, a non-array `records`, or a record whose `owner` looks like an email
 * (a PII leak guard mirroring `check-public-copy.mjs` #17) so a malformed store fails
 * the bake loudly rather than baking a bad flag. An empty store is valid (the normal
 * state before any real claim exists) and yields zero flags.
 */
export function parseClaimStore(text: string): ClaimStore {
  const doc = JSON.parse(text) as Partial<ClaimStore>
  if (doc.schema !== "calllint.claim-store.v0") {
    throw new Error(`claim-store: unexpected schema ${JSON.stringify(doc.schema)}`)
  }
  if (!Array.isArray(doc.records)) {
    throw new Error("claim-store: records must be an array")
  }
  for (const r of doc.records) {
    if (typeof r?.owner !== "string" || r.owner.length === 0) {
      throw new Error("claim-store: every record needs a non-empty owner handle")
    }
    if (EMAIL_LIKE.test(r.owner)) {
      throw new Error("claim-store: owner must be a public handle, never an email (PII)")
    }
    // Presence-only guard (D6): a namespace record stores a reverse-DNS namespace, which
    // never contains "/". Fires ONLY when the optional field exists, so today's store
    // (no namespace records) parses byte-identically. Rejecting a "/" here is the schema
    // half of the boundary-safety invariant — the matcher splits on the first "/", so a
    // stored value containing one could never match a real segment anyway; fail loud.
    if (r.registryNamespace !== undefined) {
      if (typeof r.registryNamespace !== "string" || r.registryNamespace.length === 0) {
        throw new Error("claim-store: registryNamespace, when present, must be a non-empty string")
      }
      if (r.registryNamespace.includes("/")) {
        throw new Error("claim-store: registryNamespace is a reverse-DNS namespace and must not contain '/'")
      }
    }
  }
  return doc as ClaimStore
}

/**
 * Resolve the verified publisher for one canonical namespace, or `undefined`.
 *
 * FAILS CLOSED (ADR 0047 §4) — returns `undefined` (⇒ no baked flag ⇒ page reads as
 * unclaimed) unless there is EXACTLY ONE `active` record for the namespace:
 *   • zero active records            → unclaimed / revoked          → undefined
 *   • two or more active records     → ambiguous control, never guess → undefined
 * Only the sole active record yields a `VerifiedPublisher`. A `revoked` record is
 * inert. This is deliberately additive: callers spread the result and rely on
 * `JSON.stringify` dropping an `undefined` key, so an empty/all-unclaimed store bakes
 * byte-identically to today's pages (ADR 0046 §4 reproducibility gate).
 */
export function verifiedPublisherFor(
  store: ClaimStore,
  canonicalName: string,
): VerifiedPublisher | undefined {
  const active = store.records.filter(
    (r) => r.canonicalName === canonicalName && r.status === "active",
  )
  if (active.length !== 1) return undefined
  const r = active[0]!
  return {
    owner: r.owner,
    verifiedAt: r.verifiedAt,
    observedArtifactDigest: r.artifactDigest,
  }
}

/**
 * The reverse-DNS namespace of an Official-MCP-Registry name — the segment BEFORE the
 * first `/` — or `undefined` when the name has no boundary. Operates on the ORIGINAL
 * registry name (`io.github.calllint/calllint`), NEVER the flattened `canonicalName`
 * slug, because `registryCanonicalName` replaces `/`→`-` and hyphens occur legitimately
 * in both the namespace (`ai.agentic-news`) and the server (`atars-mcp`) — so the
 * boundary is unrecoverable from the slug.
 *
 *   "io.github.calllint/calllint"  → "io.github.calllint"
 *   "io.github.calllint-evil/tool" → "io.github.calllint-evil"   (a different account)
 *   "ai.aarna/atars-mcp"           → "ai.aarna"                    (hyphen in server ignored)
 *   "nofslash"                     → undefined                     (no boundary → fail closed)
 */
export function registryNamespaceOf(registryName: string): string | undefined {
  const slash = registryName.indexOf("/")
  return slash > 0 ? registryName.slice(0, slash) : undefined
}

/**
 * Does a NAMESPACE claim record cover the page with this original registry name? The
 * match is EXACT SEGMENT EQUALITY on the reverse-DNS namespace — deliberately NOT a
 * string prefix. A raw `startsWith` would let `io.github.calllint` wrongly cover a
 * foreign `io.github.calllint-evil/*` (a different GitHub account) — a privilege
 * escalation. Fails closed: a non-namespace record, or a page with no boundary
 * (fixtures / expansion, `registryName === undefined`), is never covered.
 */
export function namespaceCovers(record: ClaimRecord, registryName: string | undefined): boolean {
  if (record.registryNamespace === undefined) return false
  if (registryName === undefined) return false
  return registryNamespaceOf(registryName) === record.registryNamespace
}

/**
 * Where a page sits, from the resolver's point of view. `registryName` is the ORIGINAL
 * reverse-DNS name (from `sourceLabel`), `undefined` for fixtures/expansion that have no
 * registry namespace. `artifactDigest` is the CHILD page's own observed digest.
 */
export interface PageClaimCoords {
  canonicalName: string
  registryName?: string
  artifactDigest: `sha256:${string}`
}

/**
 * Resolve the verified publisher for one page, honoring BOTH exact-resource claims (as
 * today) AND namespace-inheritance claims (D6). A superset of `verifiedPublisherFor`
 * that adds namespace coverage; `verifiedPublisherFor` is left unchanged for its direct
 * callers.
 *
 * FAILS CLOSED (ADR 0047 §4): returns `undefined` unless there is unambiguous, single-
 * owner control. Specifically undefined when — no active record covers the page; the
 * covering set spans ≥2 distinct owners (never guess); or there are ≥2 exact records
 * (mirrors `verifiedPublisherFor`'s duplicate-exact strictness, so the committed page
 * stays byte-identical).
 *
 *   • An EXACT record wins and surfaces the record's pinned `artifactDigest` — identical
 *     to today, which is why the one committed exact record bakes byte-for-byte the same.
 *   • A NAMESPACE-only claim (single owner) surfaces the CHILD's OWN `artifactDigest`: a
 *     namespace claim verifies account-level control, not one artifact, so pinning the
 *     record's digest on a sibling would be a false drift signal and a cross-child leak.
 *     The child's own digest is the only boundary-safe, drift-transparent choice.
 *
 * A claim NEVER alters a verdict (ADR 0053 §3); this only resolves the revocable overlay.
 */
export function verifiedPublisherForNamespace(
  store: ClaimStore,
  coords: PageClaimCoords,
): VerifiedPublisher | undefined {
  const exactActive = store.records.filter(
    (r) =>
      r.status === "active" &&
      r.registryNamespace === undefined &&
      r.canonicalName === coords.canonicalName,
  )
  const nsActive = store.records.filter(
    (r) => r.status === "active" && namespaceCovers(r, coords.registryName),
  )
  const covering = [...exactActive, ...nsActive]
  if (covering.length === 0) return undefined

  const distinctOwners = new Set(covering.map((r) => r.owner))
  if (distinctOwners.size !== 1) return undefined

  // Exact record present → preserve today's exact semantics precisely.
  if (exactActive.length >= 2) return undefined
  if (exactActive.length === 1) {
    const r = exactActive[0]!
    return { owner: r.owner, verifiedAt: r.verifiedAt, observedArtifactDigest: r.artifactDigest }
  }

  // Namespace-only, single owner → surface the child's own digest. Deterministic
  // representative: earliest verifiedAt, tie-broken by installationId.
  const r = [...nsActive].sort(
    (a, b) => a.verifiedAt.localeCompare(b.verifiedAt) || a.installationId - b.installationId,
  )[0]!
  return { owner: r.owner, verifiedAt: r.verifiedAt, observedArtifactDigest: coords.artifactDigest }
}

/** The empty store — the committed default until a real claim flows through Actions. */
export const EMPTY_CLAIM_STORE: ClaimStore = {
  schema: "calllint.claim-store.v0",
  records: [],
}
