/**
 * integrityClaim — parse a registry's integrity claim, and verify bytes on the claim's OWN terms.
 *
 * This module exists because of one defect that a naive artifact verifier always has. npm states
 * integrity as Subresource Integrity — `sha512-<base64>` — while this repo's digest convention is
 * `sha256:<hex>` (`@calllint/fingerprint`). Those two strings never compare equal, for any bytes.
 * An implementation that compares them directly either rejects every artifact in the corpus, or
 * (worse) "verifies" by comparing something incidental like length. So verification cannot be
 * string equality against our own digest: it must read the claim, take *its* algorithm, compute
 * that algorithm over the bytes, and compare in the claim's own encoding. Negative control #22
 * replaces this module's comparison with string equality and observes every artifact `REJECTED`.
 *
 * Two claim shapes are accepted, because the mapping this batch reuses emits both. The mapping in
 * `packages/resolver/src/evidence/npmResolver.ts` prefers `dist.integrity` (SRI, `<alg>-<base64>`)
 * and falls back to `` `sha1:${dist.shasum}` `` (`<alg>:<hex>`, a shape it synthesizes itself).
 * Reusing that mapping — which §10 requires, rather than forking a second one — means a parser
 * that only understood SRI would fail on exactly the fallback the reuse introduces.
 *
 * Pure: no I/O, no clock, no randomness. `verifyBytesAgainstClaim` is the only function that
 * hashes, and it hashes only what it is handed.
 */
import { createHash } from "node:crypto"
import { sha256Bytes } from "@calllint/fingerprint"

/**
 * The algorithms this repo will verify against.
 *
 * `sha1` is included deliberately, and it is the one entry worth arguing about. It is weak, and
 * it is also what npm's `dist.shasum` fallback offers for older publishes. The alternative to
 * accepting it is discarding a claim the registry actually made, which would leave those bytes
 * unverifiable — strictly less information, not more safety. What the claim establishes is
 * agreement with the registry's own metadata, not trust in the publisher; R-4 moves no verdict,
 * so accepting a weak claim cannot upgrade anything. The honest handling is to verify against it
 * and mark it `weak`, and to record the claim string verbatim in `registry_integrity` so a later
 * batch can grade the algorithm without re-fetching. `md5` is absent: it is not a claim npm makes
 * for tarballs, so supporting it would be speculative surface.
 */
export const SUPPORTED_INTEGRITY_ALGORITHMS = Object.freeze({
  sha1: 20,
  sha256: 32,
  sha384: 48,
  sha512: 64,
} as const)

export type IntegrityAlgorithm = keyof typeof SUPPORTED_INTEGRITY_ALGORITHMS

/** Strength order, strongest last. Used to choose among multiple SRI entries. */
const ALGORITHM_STRENGTH: readonly IntegrityAlgorithm[] = Object.freeze(["sha1", "sha256", "sha384", "sha512"])

export interface IntegrityClaim {
  /**
   * The claim exactly as the registry stated it, including any entries this parser did not
   * select. This is what `artifact_versions.registry_integrity` stores: the observed input,
   * not our interpretation of it (Product Principle 8).
   */
  raw: string
  /** The algorithm the selected entry names — the algorithm verification must compute. */
  algorithm: IntegrityAlgorithm
  /** The selected entry's expected digest, normalized to lowercase hex whatever its wire encoding. */
  expectedHex: string
  /** True for `sha1`. Recorded rather than acted on; R-4 grades nothing. */
  weak: boolean
}

/**
 * Why a claim could not be used. `MALFORMED` and `UNSUPPORTED_ALGORITHM` are distinguished
 * because they mean different things about the registry: the first is a broken claim, the second
 * is a claim this build cannot check yet. Both leave the artifact unverifiable, and neither is a
 * refusal of bytes, so both resolve to `UNAVAILABLE` rather than `REJECTED` upstream.
 */
export type IntegrityClaimRejection = "EMPTY" | "MALFORMED" | "UNSUPPORTED_ALGORITHM"

export type IntegrityClaimParse =
  | { readonly ok: true; readonly claim: IntegrityClaim }
  | { readonly ok: false; readonly reason: IntegrityClaimRejection }

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/
const HEX_RE = /^[0-9a-fA-F]+$/

/**
 * Parse an integrity claim, selecting the strongest supported entry.
 *
 * SRI permits several space-separated entries and an optional `?options` suffix per entry. The
 * spec's rule is that a client verifies against the strongest metadata it understands, so that
 * is what this does: unsupported entries are skipped, and if any supported entry survives, the
 * strongest wins. Skipping is not the same as failing — a claim of
 * `"sha512-… sha3-512-…"` is fully checkable even though the second entry is unknown here.
 * `UNSUPPORTED_ALGORITHM` is returned only when *no* entry is supported.
 */
export function parseIntegrityClaim(raw: string): IntegrityClaimParse {
  if (typeof raw !== "string" || raw.trim().length === 0) return { ok: false, reason: "EMPTY" }

  const entries = raw.trim().split(/\s+/)
  let best: IntegrityClaim | null = null
  let sawUnsupported = false
  let sawMalformed = false

  for (const entry of entries) {
    const parsed = parseEntry(entry, raw)
    if (parsed === "UNSUPPORTED_ALGORITHM") {
      sawUnsupported = true
      continue
    }
    if (parsed === "MALFORMED") {
      sawMalformed = true
      continue
    }
    if (best === null || isStronger(parsed.algorithm, best.algorithm)) best = parsed
  }

  if (best !== null) return { ok: true, claim: best }
  // A malformed entry is the more specific complaint, so it wins the report when both occurred:
  // "the registry sent us something broken" is more actionable than "we don't know that one".
  if (sawMalformed) return { ok: false, reason: "MALFORMED" }
  if (sawUnsupported) return { ok: false, reason: "UNSUPPORTED_ALGORITHM" }
  return { ok: false, reason: "MALFORMED" }
}

function isStronger(a: IntegrityAlgorithm, b: IntegrityAlgorithm): boolean {
  return ALGORITHM_STRENGTH.indexOf(a) > ALGORITHM_STRENGTH.indexOf(b)
}

/**
 * Parse ONE entry, in either accepted shape.
 *
 * The two shapes are disambiguated by their separator, and the separator is looked for before
 * the encoding is guessed: `-` for SRI base64, `:` for the `<alg>:<hex>` shape. Guessing from the
 * payload instead would be ambiguous, since a short hex string is also valid base64.
 */
function parseEntry(entry: string, raw: string): IntegrityClaim | "MALFORMED" | "UNSUPPORTED_ALGORITHM" {
  // SRI allows `?opt=val` after the digest; it carries no verification material.
  const withoutOptions = entry.split("?")[0] ?? ""
  if (withoutOptions.length === 0) return "MALFORMED"

  const dash = withoutOptions.indexOf("-")
  const colon = withoutOptions.indexOf(":")
  const sepIndex = dash === -1 ? colon : colon === -1 ? dash : Math.min(dash, colon)
  if (sepIndex <= 0) return "MALFORMED"

  const algorithmText = withoutOptions.slice(0, sepIndex).toLowerCase()
  const payload = withoutOptions.slice(sepIndex + 1)
  if (payload.length === 0) return "MALFORMED"

  if (!isSupportedAlgorithm(algorithmText)) return "UNSUPPORTED_ALGORITHM"
  const expectedBytes = SUPPORTED_INTEGRITY_ALGORITHMS[algorithmText]

  const expectedHex =
    withoutOptions[sepIndex] === "-" ? decodeBase64Digest(payload, expectedBytes) : decodeHexDigest(payload, expectedBytes)
  if (expectedHex === null) return "MALFORMED"

  return { raw, algorithm: algorithmText, expectedHex, weak: algorithmText === "sha1" }
}

function isSupportedAlgorithm(value: string): value is IntegrityAlgorithm {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_INTEGRITY_ALGORITHMS, value)
}

/**
 * Strict base64 → hex, or null.
 *
 * `Buffer.from(s, "base64")` is lenient: it silently discards characters outside the alphabet,
 * so `"sha512-!!!!"` would decode to empty and a length check alone would be the only thing
 * standing between us and treating a garbage claim as a real one. Three checks instead: the
 * alphabet is validated first, the decoded length must equal the algorithm's digest length, and
 * the decode must round-trip. The round-trip is what catches trailing-bit sloppiness that the
 * alphabet and length both accept.
 */
function decodeBase64Digest(payload: string, expectedBytes: number): string | null {
  if (!BASE64_RE.test(payload)) return null
  const decoded = Buffer.from(payload, "base64")
  if (decoded.length !== expectedBytes) return null
  if (decoded.toString("base64") !== payload) return null
  return decoded.toString("hex")
}

/** Strict hex → lowercase hex, or null. */
function decodeHexDigest(payload: string, expectedBytes: number): string | null {
  if (!HEX_RE.test(payload)) return null
  if (payload.length !== expectedBytes * 2) return null
  return payload.toLowerCase()
}

export interface IntegrityVerification {
  /** True only when the claim's own algorithm, over these bytes, produces the claim's digest. */
  verified: boolean
  /** What the claim's algorithm actually produced, lowercase hex. Recorded on mismatch. */
  observedHex: string
  /**
   * This repo's digest of the same bytes, `sha256:<hex>`, independent of the claim's algorithm.
   *
   * Computed here (rather than by the caller) so that the value written to `immutable_digest`
   * and the value verified are provably over the same buffer. Keeping the two digests separate
   * is the Observed-vs-Inferred line: `immutable_digest` is what WE measured, `registry_integrity`
   * is what THEY claimed, and collapsing them into one column would make "the registry says
   * sha512-…" and "we hold bytes hashing to it" indistinguishable.
   */
  immutableDigest: string
}

/**
 * Hash `bytes` with the claim's algorithm and compare to the claim.
 *
 * Plain equality on lowercase hex is correct here: both sides are public values, so there is no
 * secret for a timing side channel to leak, and a constant-time compare would only obscure that.
 */
export function verifyBytesAgainstClaim(bytes: Uint8Array, claim: IntegrityClaim): IntegrityVerification {
  const observedHex = createHash(claim.algorithm).update(bytes).digest("hex")
  return {
    verified: observedHex === claim.expectedHex,
    observedHex,
    immutableDigest: sha256Bytes(bytes),
  }
}
