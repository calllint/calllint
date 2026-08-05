/**
 * The AdoptionDigestSet and the ORDER that makes it a chain.
 *
 * The schema says the 8 fields' order "encodes the dependency chain … A batch that needs a digest
 * its predecessors have not produced is mis-ordered". That sentence is prose, and prose is not a
 * guard: a `digests` object is a JSON object, whose members have no order at runtime and whose keys
 * `hashJson` sorts alphabetically anyway. So the chain is restated here as a frozen array plus an
 * assertion over it, and the two are checked against each other.
 *
 * WHAT THE CHAIN ACTUALLY CONSTRAINS. Not "these keys appear in this sequence" — that is unfalsifiable
 * for an object literal. It constrains WHICH ABSENCES ARE COHERENT: a link may be null only if it is
 * downstream of something that is also null, so the null suffix pattern below is the checkable form
 * of "mis-ordered". Concretely, from the schema's own reasoning:
 *
 *   - `artifactDigest === null ⇒ evidenceDigest === null` — "an artifact that could not be resolved
 *     has no artifactDigest and therefore no evidenceDigest". Evidence is graded over verified bytes;
 *     with no bytes there is nothing to grade. The converse is allowed: bytes can be resolved and not
 *     yet graded.
 *   - `decisionDigest` is NON-NULL EVEN THEN — "yet still has a decision (UNKNOWN is a decision, and
 *     it is not SAFE)". This is product principle 2 in the type system's terms, and it is why
 *     `decisionDigest` is the one mid-chain field the schema does not make nullable. The code path
 *     that produces it is real: `decideOverAuthority` pushes an `UNKNOWN` contribution and the
 *     unknown "decision made over an unpinned artifact (no digest)" when `artifactDigest` is null.
 *   - `sourcePayloadDigest` and `identityDigest` are the two roots and are never null: a record with
 *     no source payload and no identity is not a record of anything.
 *   - `semanticContractDigest` is nullable independently — a contract may not have been sealed yet —
 *     and being downstream of the decision, it may be null while everything before it is present.
 *   - `pageDigest` is the only member the schema does not require. A record exists before its page is
 *     baked; that is the whole point of R-7 landing before the projection wiring.
 */
import type { AdoptionRecordDigests } from "./adoptionRecord.js"

/**
 * The dependency chain, in order, as a value.
 *
 * Frozen so a caller cannot reorder the chain it is being checked against, and typed against
 * `AdoptionRecordDigests` so a field renamed in the record cannot silently fall out of the chain —
 * it becomes a compile error here instead.
 */
export const ADOPTION_DIGEST_CHAIN = Object.freeze([
  "sourcePayloadDigest",
  "identityDigest",
  "artifactDigest",
  "evidenceDigest",
  "decisionDigest",
  "semanticContractDigest",
  "presentationDigest",
  "pageDigest",
] as const satisfies readonly (keyof AdoptionRecordDigests)[])

export type AdoptionDigestName = (typeof ADOPTION_DIGEST_CHAIN)[number]

/**
 * The members that may be null, and the ONLY ones. Frozen for the same reason as the chain.
 *
 * `pageDigest` is absent from this set because it is optional rather than nullable — it may be
 * missing, and when present it must be a digest. A member that is neither in this set nor optional
 * is required to be a non-empty string, which is what `assertDigestChain` enforces.
 */
export const NULLABLE_ADOPTION_DIGESTS = Object.freeze([
  "artifactDigest",
  "evidenceDigest",
  "semanticContractDigest",
] as const satisfies readonly AdoptionDigestName[])

/** Every digest in the set is `sha256:<64 hex>`, except `presentationDigest` (`minLength: 1`). */
const SHA256 = /^sha256:[0-9a-f]{64}$/

/**
 * Reject a digest set whose absences contradict the chain.
 *
 * Throws rather than returning a boolean: this runs on the write path of THE canonical asset, and a
 * record whose chain is incoherent must not reach the table at all. The messages name the claim they
 * enforce, so a negative control that breaks one fails on that claim rather than on a shape check.
 */
export function assertDigestChain(digests: AdoptionRecordDigests): void {
  // Roots first: without these there is no record, so their absence is not a "chain" problem.
  if (!SHA256.test(digests.sourcePayloadDigest)) {
    throw new Error(
      `adoption digest chain: sourcePayloadDigest is a chain ROOT and must be sha256:<hex>, got ${JSON.stringify(digests.sourcePayloadDigest)}`,
    )
  }
  if (!SHA256.test(digests.identityDigest)) {
    throw new Error(
      `adoption digest chain: identityDigest is a chain ROOT and must be sha256:<hex>, got ${JSON.stringify(digests.identityDigest)}`,
    )
  }

  for (const name of ["artifactDigest", "evidenceDigest", "semanticContractDigest"] as const) {
    const value = digests[name]
    if (value !== null && !SHA256.test(value)) {
      throw new Error(
        `adoption digest chain: ${name} is nullable but not free-form; expected null or sha256:<hex>, got ${JSON.stringify(value)}`,
      )
    }
  }

  // The chain's one real ordering constraint (schema: an unresolved artifact "has no artifactDigest
  // and therefore no evidenceDigest").
  if (digests.artifactDigest === null && digests.evidenceDigest !== null) {
    throw new Error(
      "adoption digest chain: evidenceDigest is present while artifactDigest is null — evidence is graded over verified bytes, so this record claims to have graded bytes it never resolved (mis-ordered chain)",
    )
  }

  // Product principle 2, as a runtime refusal. Deliberately checked AFTER the artifact/evidence rule
  // so the "both null" case still reaches it.
  if (!SHA256.test(digests.decisionDigest)) {
    throw new Error(
      `adoption digest chain: decisionDigest must be present even when artifactDigest and evidenceDigest are null — UNKNOWN is a decision, and it is not SAFE; got ${JSON.stringify(digests.decisionDigest)}`,
    )
  }

  if (typeof digests.presentationDigest !== "string" || digests.presentationDigest.length === 0) {
    throw new Error(
      `adoption digest chain: presentationDigest is required and non-empty, got ${JSON.stringify(digests.presentationDigest)}`,
    )
  }

  if (digests.pageDigest !== undefined && !SHA256.test(digests.pageDigest)) {
    throw new Error(
      `adoption digest chain: pageDigest is optional (a record exists before its page is baked) but must be sha256:<hex> when present, got ${JSON.stringify(digests.pageDigest)}`,
    )
  }
}
