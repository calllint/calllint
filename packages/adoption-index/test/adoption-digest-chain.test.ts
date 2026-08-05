/**
 * adoption-digest-chain — the 8-digest set's coherence rules, as assertions rather than as the
 * schema's prose.
 *
 * WHAT IS ACTUALLY FALSIFIABLE HERE, stated first because the obvious reading of the schema is not
 * testable. `calllint.adoption-record.v1` says the `digests` order "encodes the dependency chain",
 * and for a JSON OBJECT that claim has no observable consequence: property order is not part of the
 * value, `hashJson` sorts keys before hashing, and `assertDigestChain` could read its input in any
 * order and behave identically. A test that "checked the order" would be checking a source literal
 * against a copy of itself.
 *
 * What the order MEANS is checkable, and it is a rule about ABSENCES: a digest cannot exist before
 * the thing it is derived from. That gives exactly one forbidden combination among the nullable
 * members (`evidenceDigest` present while `artifactDigest` is null — evidence is graded over verified
 * bytes, so a record cannot have graded bytes it never resolved) and one required presence in the
 * middle of the chain (`decisionDigest`, which the schema makes non-nullable because UNKNOWN is a
 * decision, and it is not SAFE). Both are asserted below, in both directions.
 *
 * WHY BOTH DIRECTIONS. A one-sided assertion on a refusal is the vacuity trap
 * ([[optional-field-defeats-source-guards]]): a guard that throws on everything passes every
 * "must reject" case and is useless. So each rule is measured twice — the incoherent set is refused
 * AND the coherent neighbour differing in exactly one field is accepted. Controls (d) and (e) are the
 * source-side mutations that make these fail.
 *
 * PURE FILE, no store and no driver: `assertDigestChain` reads nothing but its argument.
 * `adoption-record.test.ts` covers the compiler that calls it, `adoption-record-store.test.ts` the
 * boundary that re-checks it.
 */
import { describe, it, expect } from "vitest"
import {
  ADOPTION_DIGEST_CHAIN,
  NULLABLE_ADOPTION_DIGESTS,
  assertDigestChain,
  type AdoptionRecordDigests,
} from "../src/index.js"

const A = `sha256:${"a".repeat(64)}`
const B = `sha256:${"b".repeat(64)}`
const C = `sha256:${"c".repeat(64)}`
const D = `sha256:${"d".repeat(64)}`
const E = `sha256:${"e".repeat(64)}`
const F = `sha256:${"f".repeat(64)}`

/** A fully-populated, coherent set: every member present. The baseline each case mutates. */
function full(): AdoptionRecordDigests {
  return {
    sourcePayloadDigest: A,
    identityDigest: B,
    artifactDigest: C,
    evidenceDigest: D,
    decisionDigest: E,
    semanticContractDigest: F,
    presentationDigest: A,
    pageDigest: B,
  }
}

/** The other coherent extreme: nothing resolved past identity, and still a decision. */
function bare(): AdoptionRecordDigests {
  return {
    sourcePayloadDigest: A,
    identityDigest: B,
    artifactDigest: null,
    evidenceDigest: null,
    decisionDigest: E,
    semanticContractDigest: null,
    presentationDigest: A,
  }
}

describe("the chain is declared as data, and the declaration matches the type", () => {
  it("names all eight members, in the schema's order, with no repeats", () => {
    // SORTED-INDEPENDENT and EXACT: this is the one place the written order is pinned, so a reorder
    // in the source is at least VISIBLE here even though it is behaviourally inert. The comment in
    // `adoptionDigestSet.ts` says as much; this assertion is what makes the claim checkable at all.
    expect([...ADOPTION_DIGEST_CHAIN]).toEqual([
      "sourcePayloadDigest",
      "identityDigest",
      "artifactDigest",
      "evidenceDigest",
      "decisionDigest",
      "semanticContractDigest",
      "presentationDigest",
      "pageDigest",
    ])
    expect(new Set(ADOPTION_DIGEST_CHAIN).size).toBe(8)
  })

  it("marks exactly the three nullable members, and they are chain members", () => {
    expect([...NULLABLE_ADOPTION_DIGESTS].sort()).toEqual([
      "artifactDigest",
      "evidenceDigest",
      "semanticContractDigest",
    ])
    // A nullable name that is not a chain member would be a typo the type system permits (both are
    // string unions over the same keys, so a stale name compiles until it is compared to the chain).
    for (const name of NULLABLE_ADOPTION_DIGESTS) expect(ADOPTION_DIGEST_CHAIN).toContain(name)
    // VACUITY GUARD: an empty list would satisfy the loop above.
    expect(NULLABLE_ADOPTION_DIGESTS).toHaveLength(3)
  })

  it("freezes both declarations", () => {
    // Module-level arrays reachable from every caller. Without the freeze, one caller pushing a name
    // rewrites the rule for the whole process — the same argument `NO_REBUILD` makes in
    // `detectSourceChange.ts`.
    expect(Object.isFrozen(ADOPTION_DIGEST_CHAIN)).toBe(true)
    expect(Object.isFrozen(NULLABLE_ADOPTION_DIGESTS)).toBe(true)
  })
})

describe("both coherent extremes are accepted (the vacuity half)", () => {
  it("accepts a fully-populated set", () => {
    expect(() => assertDigestChain(full())).not.toThrow()
  })

  it("accepts a set with all three nullable members null", () => {
    // The UNKNOWN-verdict shape: identity resolved, no artifact, no evidence, no contract, and a
    // decision anyway. If this threw, every "must reject" case below would prove nothing.
    expect(() => assertDigestChain(bare())).not.toThrow()
  })

  it("accepts an absent pageDigest, and a present one", () => {
    const { pageDigest: _omitted, ...withoutPage } = full()
    expect(() => assertDigestChain(withoutPage)).not.toThrow()
    expect(() => assertDigestChain({ ...withoutPage, pageDigest: C })).not.toThrow()
  })
})

describe("evidence cannot precede the artifact it graded (control d)", () => {
  it("refuses evidence with a null artifact, naming the mis-ordering", () => {
    const digests = { ...full(), artifactDigest: null }
    // The message, not just the throw: a bare `toThrow()` would pass if the set failed the sha256
    // shape check instead, which is a different defect with the same symptom.
    expect(() => assertDigestChain(digests)).toThrow(/mis-ordered chain/)
  })

  it("accepts the reverse asymmetry — an artifact with no evidence yet", () => {
    // This is the ONE-FIELD NEIGHBOUR of the refusal above, and it must pass: bytes resolved but not
    // yet graded is the normal state between R-4 and R-5. A guard that refused both directions would
    // make the rule "evidence and artifact must agree", which is not what the chain says.
    expect(() => assertDigestChain({ ...full(), evidenceDigest: null })).not.toThrow()
  })
})

describe("a record always carries a decision (control e)", () => {
  it("refuses an empty decisionDigest even when artifact and evidence are both null", () => {
    // THE ORDERING TRAP INSIDE THE GUARD: the artifact/evidence rule is checked first, so if
    // `decisionDigest` were only validated on the "something resolved" path, this both-null case
    // would slip past. It is asserted from the BARE set for exactly that reason.
    expect(() => assertDigestChain({ ...bare(), decisionDigest: "" })).toThrow(/UNKNOWN is a decision/)
  })

  it("refuses a null decisionDigest passed through a widened caller", () => {
    // The schema forbids null here, so TypeScript forbids it too — and TypeScript is erased, which is
    // the whole reason this is a runtime assertion. The cast reproduces what a JSON-parsed row or a
    // JS caller can hand in.
    const digests = { ...bare(), decisionDigest: null } as unknown as AdoptionRecordDigests
    expect(() => assertDigestChain(digests)).toThrow(/decisionDigest/)
  })
})

describe("shape is enforced on every member, not only presence", () => {
  it("refuses a non-sha256 root", () => {
    expect(() => assertDigestChain({ ...full(), sourcePayloadDigest: "deadbeef" })).toThrow(
      /sourcePayloadDigest/,
    )
    expect(() => assertDigestChain({ ...full(), identityDigest: "sha256:short" })).toThrow(/identityDigest/)
  })

  it("refuses a malformed value in a NULLABLE member — null is allowed, garbage is not", () => {
    // The distinction the word "nullable" hides: these three may be ABSENT, which is not the same as
    // being allowed to hold anything. Both halves are asserted so the permission cannot widen.
    //
    // The null half uses a base that STAYS COHERENT once the member is nulled: nulling
    // `artifactDigest` on the full set also strands `evidenceDigest`, which the chain rule refuses for
    // a different and correct reason. Measured while writing this — the first version of this loop
    // asserted `not.toThrow()` over exactly that case and would have failed. Pairing the two nulls is
    // the fix; weakening the rule would have been the mistake.
    const coherentlyNull: Record<string, () => AdoptionRecordDigests> = {
      artifactDigest: () => ({ ...full(), artifactDigest: null, evidenceDigest: null }),
      evidenceDigest: () => ({ ...full(), evidenceDigest: null }),
      semanticContractDigest: () => ({ ...full(), semanticContractDigest: null }),
    }
    for (const name of NULLABLE_ADOPTION_DIGESTS) {
      expect(() => assertDigestChain(coherentlyNull[name]!()), `${name} may be null`).not.toThrow()
      expect(() => assertDigestChain({ ...full(), [name]: "nope" })).toThrow(new RegExp(name))
    }
  })

  it("refuses an empty presentationDigest", () => {
    // `minLength: 1` in the schema, and NOT the sha256 pattern: `emptyPresentationDigest()` is a real
    // value ("the honest digest of 'there is no content plane yet'"), so the rule is non-emptiness.
    expect(() => assertDigestChain({ ...full(), presentationDigest: "" })).toThrow(/presentationDigest/)
  })

  it("refuses a malformed pageDigest when one is present", () => {
    expect(() => assertDigestChain({ ...full(), pageDigest: "sha256:" })).toThrow(/pageDigest/)
  })
})
