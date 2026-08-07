/**
 * adoption-index-projection — `projectAdoptionIndex`, the IDENTITY projection of the canonical records.
 *
 * WHY THE ABSENCE ASSERTIONS ARE NOT VACUOUS HERE, stated first because it is what makes this file
 * worth reading. `StoredAdoptionRecord` **carries `decisionDigest`** as a non-nullable column, and the
 * fixtures below set it to a digest that appears nowhere else. So "the projection has no
 * `decisionDigest`" is a claim about a value that is genuinely present on the input and genuinely
 * dropped — not a claim about a field the input never had. A forbidden-name scan over an input that
 * never carried the forbidden value proves nothing; that is the failure mode
 * [[negative-control-validity-checklist]] calls a no-op assertion.
 *
 * The scan runs over the SERIALIZED bytes as well as the parsed keys, at every depth, because a
 * nested object is exactly where a later edit would put `{ decision: { verdict } }` and a top-level
 * `Object.keys` check would not see it.
 *
 * SUBJECTS DRIVE THE PROJECTION; A RECORD IS OPTIONAL — and this file tests BOTH branches, because
 * the production branch today is the one WITHOUT a record. Nothing in `src/` compiles a record yet
 * (the projection's docblock states the four measurements), so a suite that only fed record-bearing
 * fixtures would be green over a code path production never takes, while the path it does take went
 * unmeasured. `pair()` carries records; `bare()` carries none.
 *
 * Negative controls this file is the measurement for:
 *   #110  add `decisionDigest` to the projection
 *   #111  replace the literal comparator with `localeCompare`
 *   #115  delete a field from the frozen positive set (WITH a vacuity guard, so an emptied list fails)
 *   #118  emit the record fields as `undefined` instead of omitting them (an entry that claims a
 *         record digest it does not have)
 */
import { describe, it, expect } from "vitest"
import {
  ADOPTION_INDEX_ENTRY_FIELDS,
  ADOPTION_INDEX_RECORD_FIELDS,
  ADOPTION_INDEX_SCHEMA,
  FORBIDDEN_PROJECTION_FIELDS,
  projectAdoptionIndex,
  serializeAdoptionIndex,
  type StoredAdoptionRecord,
  type StoredSubject,
} from "../src/index.js"

const PROJECTED_AT = "2026-08-06T00:00:00.000Z"
const UPDATED_AT = "2026-08-05T12:00:00.000Z"
const FIRST_SEEN = "2026-08-01T00:00:00.000Z"

const IDENTITY = `sha256:${"1".repeat(64)}`
const RECORD = `sha256:${"2".repeat(64)}`
/** Present on every input row; must appear in NO output byte. The whole point of control #110. */
const DECISION = `sha256:${"d".repeat(64)}`
const CONTRACT = `sha256:${"c".repeat(64)}`
const PRESENTATION = `sha256:${"e".repeat(64)}`

function subject(overrides: Partial<StoredSubject> = {}): StoredSubject {
  return {
    subjectId: `sha256:${"9".repeat(64)}`,
    canonicalName: "io.example/alpha",
    canonicalSlug: "mcp-registry/io.example-alpha",
    displayName: "Alpha",
    identityStatus: "RESOLVED",
    identityDigest: IDENTITY,
    firstSeenAt: FIRST_SEEN,
    lastSeenAt: UPDATED_AT,
    // Before `...overrides`, so a test that wants a withdrawn subject can still say so.
    lifecycleStatus: "ACTIVE",
    withdrawnAt: null,
    ...overrides,
  }
}

/**
 * A row whose `recordJson` holds a FULL record body — verdict, evidence findings, policy digest.
 *
 * Hand-authored rather than compiled, because the point is the opposite of fidelity: this is the
 * hostile input. If the projection ever serialized `recordJson`, or parsed it and re-emitted any part
 * of it, every forbidden token below would appear in the output bytes at once.
 */
function record(overrides: Partial<StoredAdoptionRecord> = {}): StoredAdoptionRecord {
  return {
    subjectId: subject().subjectId,
    selectedArtifactVersionId: `sha256:${"a".repeat(64)}`,
    adoptionRecordDigest: RECORD,
    decisionDigest: DECISION,
    semanticContractDigest: CONTRACT,
    presentationDigest: PRESENTATION,
    lifecycleStatus: "ACTIVE",
    recordJson: JSON.stringify({
      decision: { verdict: "BLOCK", decisionDigest: DECISION, policyDigest: `sha256:${"5".repeat(64)}` },
      evidence: { evidenceDigest: `sha256:${"3".repeat(64)}`, findingCount: 7 },
    }),
    updatedAt: UPDATED_AT,
    ...overrides,
  }
}

/** Two subjects whose raw names sort the OPPOSITE way from their slugs — see the sort test. */
function pair(): { subjects: StoredSubject[]; records: StoredAdoptionRecord[] } {
  const a = subject({ subjectId: "sub-a", canonicalName: "io.example/alpha", canonicalSlug: "mcp-registry/zzz-alpha" })
  const b = subject({ subjectId: "sub-b", canonicalName: "io.example/zulu", canonicalSlug: "mcp-registry/aaa-zulu" })
  return {
    subjects: [a, b],
    records: [record({ subjectId: "sub-a" }), record({ subjectId: "sub-b" })],
  }
}

/**
 * The SAME two subjects with no records at all — the shape production takes today.
 *
 * Returned as `{subjects}` only, so a test that forgets to pass `records` still compiles: the point
 * is that omitting them is legal and produces entries, not zero.
 */
function bare(): { subjects: StoredSubject[] } {
  return { subjects: pair().subjects }
}

describe("the projection carries identity and nothing else", () => {
  it("emits exactly the frozen field set, in both directions, with a record", () => {
    const doc = projectAdoptionIndex({ ...pair(), projectedAt: PROJECTED_AT })
    expect(doc.entries).toHaveLength(2)

    // VACUITY GUARDS for control #115: an emptied list would make the set comparisons below pass
    // over nothing. Pinned as counts so a deletion fails here even before the sets diverge.
    expect(ADOPTION_INDEX_ENTRY_FIELDS).toHaveLength(6)
    expect(ADOPTION_INDEX_RECORD_FIELDS).toHaveLength(3)

    const expected = [...ADOPTION_INDEX_ENTRY_FIELDS, ...ADOPTION_INDEX_RECORD_FIELDS].sort()
    for (const entry of doc.entries) {
      // Sorted equality, so an ADDED key fails as loudly as a missing one.
      expect(Object.keys(entry).sort()).toEqual(expected)
    }
  })

  it("emits exactly the REQUIRED set — no more, no fewer — when no record exists", () => {
    // The production shape today. `records` is omitted entirely, not passed as `[]`, because the
    // caller that has no records will omit it and that is the path worth measuring.
    const doc = projectAdoptionIndex({ ...bare(), projectedAt: PROJECTED_AT })

    // Not skipped: a subject without a record is still a subject. Zero entries here is the exact
    // failure the R-8 inversion was about, so it is asserted before the key sets.
    expect(doc.entries).toHaveLength(2)
    expect(doc.count).toBe(2)

    for (const entry of doc.entries) {
      expect(Object.keys(entry).sort()).toEqual([...ADOPTION_INDEX_ENTRY_FIELDS].sort())
    }
  })

  it("OMITS the record fields rather than emitting undefined (control #118)", () => {
    const doc = projectAdoptionIndex({ ...bare(), projectedAt: PROJECTED_AT })
    const entry = doc.entries[0]!

    // `in` distinguishes absent from present-and-undefined; `Object.keys` above would too, but the
    // bytes are what a consumer joins on, so both are pinned.
    for (const field of ADOPTION_INDEX_RECORD_FIELDS) {
      expect(field in entry, `${field} must be ABSENT, not undefined, when no record was compiled`).toBe(false)
    }
    expect(serializeAdoptionIndex(doc)).not.toContain("adoptionRecordDigest")

    // Vacuity guard: the same fields ARE present on the record-bearing branch, so this test is a
    // claim about omission and not about a field the projection never emits at all.
    const withRecord = projectAdoptionIndex({ ...pair(), projectedAt: PROJECTED_AT })
    expect("adoptionRecordDigest" in withRecord.entries[0]!).toBe(true)
  })

  it("enriches only the subjects that have a record, in one mixed document", () => {
    const { subjects } = pair()
    // One record, two subjects — the transitional state the decision port will pass through.
    const doc = projectAdoptionIndex({ subjects, records: [record({ subjectId: "sub-a" })], projectedAt: PROJECTED_AT })
    const bySubject = new Map(doc.entries.map((e) => [e.subjectId, e]))
    expect(bySubject.get("sub-a")?.adoptionRecordDigest).toBe(RECORD)
    expect("adoptionRecordDigest" in bySubject.get("sub-b")!).toBe(false)
    // Both still addressable — enrichment is additive and never a filter.
    expect(doc.entries).toHaveLength(2)
  })

  it("drops a record whose subject row is absent, since nothing addresses it", () => {
    const doc = projectAdoptionIndex({
      subjects: [subject({ subjectId: "sub-a", canonicalSlug: "mcp-registry/a" })],
      records: [record({ subjectId: "sub-a" }), record({ subjectId: "ghost" })],
      projectedAt: PROJECTED_AT,
    })
    expect(doc.entries.map((e) => e.subjectId)).toEqual(["sub-a"])
  })

  it("drops `decisionDigest` even though every input row carries one", () => {
    const doc = projectAdoptionIndex({ ...pair(), projectedAt: PROJECTED_AT })
    const bytes = serializeAdoptionIndex(doc)

    // The input's own digest, asserted present on the input first: without this line the assertion
    // below could pass because the fixture forgot to set it.
    expect(record().decisionDigest).toBe(DECISION)
    expect(bytes, "a record's decision must never reach a served projection (ADR 0061 §4)").not.toContain(DECISION)
  })

  it("carries no forbidden field name at any depth", () => {
    const doc = projectAdoptionIndex({ ...pair(), projectedAt: PROJECTED_AT })

    // Vacuity guard for the scan.
    expect(FORBIDDEN_PROJECTION_FIELDS.length).toBeGreaterThanOrEqual(9)

    const keys = new Set<string>()
    const walk = (value: unknown): void => {
      if (value === null || typeof value !== "object") return
      if (Array.isArray(value)) {
        for (const item of value) walk(item)
        return
      }
      for (const [k, v] of Object.entries(value)) {
        keys.add(k)
        walk(v)
      }
    }
    walk(doc)
    // The walk found something — otherwise `keys` is empty and every `not.toContain` is vacuous.
    expect(keys.size).toBeGreaterThan(0)

    for (const forbidden of FORBIDDEN_PROJECTION_FIELDS) {
      expect(
        [...keys],
        `${forbidden} is a decision or evidence field; this projection resolves identity only (ADR 0061 §4)`,
      ).not.toContain(forbidden)
    }
  })

  it("never emits the record body, whose every token is forbidden", () => {
    const bytes = serializeAdoptionIndex(projectAdoptionIndex({ ...pair(), projectedAt: PROJECTED_AT }))
    // `recordJson` would smuggle all of the above through ONE key, which is the shape a name-only
    // scan on the top level misses.
    for (const token of ["BLOCK", "policyDigest", "findingCount", "evidenceDigest"]) {
      expect(bytes).not.toContain(token)
    }
  })
})

describe("ordering is byte-stable and locale-independent", () => {
  it("sorts by canonicalName with a literal comparator, not by slug", () => {
    const doc = projectAdoptionIndex({ ...pair(), projectedAt: PROJECTED_AT })
    // The fixture's slugs sort the OPPOSITE way (`aaa-zulu` < `zzz-alpha`), so this assertion
    // distinguishes the two sort keys instead of passing under either.
    expect(doc.entries.map((e) => e.canonicalName)).toEqual(["io.example/alpha", "io.example/zulu"])
    expect(doc.entries.map((e) => e.canonicalSlug)).toEqual([
      "mcp-registry/zzz-alpha",
      "mcp-registry/aaa-zulu",
    ])
  })

  it("is independent of input row order", () => {
    const { subjects, records } = pair()
    const forward = serializeAdoptionIndex(projectAdoptionIndex({ subjects, records, projectedAt: PROJECTED_AT }))
    const reversed = serializeAdoptionIndex(
      projectAdoptionIndex({
        subjects: [...subjects].reverse(),
        records: [...records].reverse(),
        projectedAt: PROJECTED_AT,
      }),
    )
    // The store's ORDER BY is not part of the contract; the projection's own sort is.
    expect(reversed).toBe(forward)
  })

  it("orders by code unit, which is where `localeCompare` diverges (control #111)", () => {
    // THE DIVERGENCE IS CASE, NOT PUNCTUATION, AND THAT IS A MEASUREMENT THAT CORRECTED THIS TEST.
    //
    // This assertion previously used `_` vs `a` on the stated premise that ICU ignores punctuation
    // at the primary level. On Node 20 with full ICU (locale `zh-CN`) that premise is FALSE: `_a`/`aa`,
    // `a-b`/`ab`, `a.b`/`ab` and `_under`/`alpha` all give -1 from BOTH comparators, so a
    // `localeCompare` swap left the suite green and the control proved nothing. Case diverges on every
    // pair measured: `B` (U+0042) sorts before `a` (U+0061) by code unit, while ICU orders `alpha`
    // first — the two names swap places outright, rather than merely tying differently.
    //
    // AND IT IS REACHABLE, which is why this is a real guard and not a synthetic one. `canonicalSlug`
    // lowercases (`resolveIdentity.ts`), and its docblock already lists `{a.b/c, a.b-c, A.B/C}` as a
    // measured collision bucket — upstream treats an uppercase registry name as real input. But the
    // sort key here is `canonicalName`, which comes from `claimedName` and is NEVER case-folded: it is
    // the identity. So the one thing that diverges is exactly the thing this key preserves. Today's
    // committed cohort is 19/19 lowercase, so no live byte depends on this yet — the guard is here so
    // the first uppercase subject cannot reorder the committed document on one machine only.
    const s = [
      subject({ subjectId: "s1", canonicalName: "io.example/Beta", canonicalSlug: "mcp-registry/beta" }),
      subject({ subjectId: "s2", canonicalName: "io.example/alpha", canonicalSlug: "mcp-registry/alpha" }),
    ]
    const r = [record({ subjectId: "s1" }), record({ subjectId: "s2" })]
    const doc = projectAdoptionIndex({ subjects: s, records: r, projectedAt: PROJECTED_AT })
    expect(doc.entries.map((e) => e.canonicalName)).toEqual(["io.example/Beta", "io.example/alpha"])
    // Both halves stated directly, so the REASON survives a fixture edit: code unit puts `Beta`
    // first, and this platform's `localeCompare` disagrees. If the second ever stops holding, this
    // fails loudly instead of quietly becoming a no-op the way the punctuation fixture did.
    expect("io.example/Beta" < "io.example/alpha").toBe(true)
    expect(Math.sign("io.example/Beta".localeCompare("io.example/alpha"))).toBe(1)
  })
})

describe("a subject without a concluded address is skipped, never substituted", () => {
  it("skips a CONFLICT subject whose canonicalSlug is null — the ONE skip rule", () => {
    const s = [
      subject({ subjectId: "ok" }),
      subject({ subjectId: "bad", canonicalName: "io.example/conflict", canonicalSlug: null, identityStatus: "CONFLICT" }),
    ]
    const doc = projectAdoptionIndex({
      subjects: s,
      records: [record({ subjectId: "ok" }), record({ subjectId: "bad" })],
      projectedAt: PROJECTED_AT,
    })
    // One in, one out — a substituted slug would advertise a page at a URL the identity layer
    // refused to conclude (`store.ts`'s `subjectSlugRow`). Note the CONFLICT subject HAS a record
    // here: the skip is decided by the missing address, never by the record's presence.
    expect(doc.entries.map((e) => e.subjectId)).toEqual(["ok"])
    expect(doc.count).toBe(1)
  })

  it("returns an honest empty document rather than throwing", () => {
    const doc = projectAdoptionIndex({ subjects: [], records: [], projectedAt: PROJECTED_AT })
    expect(doc.count).toBe(0)
    expect(doc.entries).toEqual([])
    expect(doc.schema).toBe(ADOPTION_INDEX_SCHEMA)
  })

  it("is empty for zero SUBJECTS even when records exist, and non-empty for the reverse", () => {
    // The asymmetry, asserted in both directions, because it is what the R-8 inversion turned on:
    // subjects are the driver. Records without subjects project nothing; subjects without records
    // project everything.
    expect(projectAdoptionIndex({ subjects: [], records: pair().records, projectedAt: PROJECTED_AT }).count).toBe(0)
    expect(projectAdoptionIndex({ ...bare(), projectedAt: PROJECTED_AT }).count).toBe(2)
  })
})

describe("the serialized bytes are the contract", () => {
  it("pins 2-space indentation and a trailing newline", () => {
    const bytes = serializeAdoptionIndex(projectAdoptionIndex({ ...pair(), projectedAt: PROJECTED_AT }))
    expect(bytes.endsWith("}\n")).toBe(true)
    expect(bytes).toContain('\n  "schema": "calllint.adoption-index.v1"')
    expect(bytes).not.toContain("\r\n")
  })

  it("recomputes `count` from the array, so a hand-edited count cannot survive", () => {
    const doc = projectAdoptionIndex({ ...pair(), projectedAt: PROJECTED_AT })
    const tampered = { ...doc, count: 999 }
    expect(JSON.parse(serializeAdoptionIndex(tampered)).count).toBe(2)
  })

  it("carries `projectedAt` verbatim and reads no clock", () => {
    const odd = "1999-12-31T23:59:59.000Z"
    const doc = projectAdoptionIndex({ ...pair(), projectedAt: odd })
    expect(doc.projectedAt).toBe(odd)
    // Purity, in the form the reproducibility gate asks about: same inputs, same bytes, twice.
    expect(serializeAdoptionIndex(projectAdoptionIndex({ ...pair(), projectedAt: odd }))).toBe(
      serializeAdoptionIndex(doc),
    )
  })

  it("copies the digests it carries, byte for byte", () => {
    const doc = projectAdoptionIndex({ ...pair(), projectedAt: PROJECTED_AT })
    // A digest that could not be derived from the entry's own fields must survive verbatim — the
    // same data-dependence form `adoption-record.test.ts` uses for control (c).
    expect(doc.entries[0]?.identityDigest).toBe(IDENTITY)
    expect(doc.entries[0]?.adoptionRecordDigest).toBe(RECORD)
  })
})
