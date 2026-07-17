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

/** The empty store — the committed default until a real claim flows through Actions. */
export const EMPTY_CLAIM_STORE: ClaimStore = {
  schema: "calllint.claim-store.v0",
  records: [],
}
