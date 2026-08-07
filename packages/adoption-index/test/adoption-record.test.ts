/**
 * adoption-record — `compileAdoptionRecord`, the projection that makes THE canonical asset.
 *
 * PURE FUNCTION, REAL ROWS. The function reads no clock and no database, so this file needs no
 * driver — but the rows it consumes are the store's own interfaces, and hand-authoring them is how a
 * projection comes to depend on a shape the store never produces. So the fixtures are built from
 * `StoredSubject`/`StoredArtifactVersion`/`StoredEvidenceRecord` literals whose fields are the
 * store's, and the record is compared to what a subsequent store round-trip yields in
 * `adoption-record-store.test.ts`. The two files split along the same line as R-6's:
 * `job-state-machine` was pure, `job-lease` drove a driver.
 *
 * THE FOUR CLAIMS ONLY THIS FILE CAN MEASURE:
 *
 *   - EVERY DIGEST IS COPIED, NONE RECOMPUTED. Eight digests, eight producers, all upstream. The
 *     checkable form is a DATA DEPENDENCE: change the input digest, and the output must change with
 *     it byte-for-byte. Asserting "the function does not call `hashJson`" is not available to a test,
 *     and asserting a reordering (R-3's control #16) proved unfalsifiable for a pure function. So
 *     control (c) — recomputing `decisionDigest` from the record's own fields — is measured by feeding
 *     a digest that could not possibly be derived from the record and requiring it to survive verbatim.
 *   - THE RECORD IS ORDER-STABLE OVER ITS INPUTS. `sourcePayloads` arrives in whatever order the
 *     caller resolved rows, and `sourcePayloadDigest` is taken from the first AFTER sorting. Two
 *     permutations of one cohort must produce deep-equal records and one digest.
 *   - THE EVIDENCE PROJECTION CANNOT WIDEN. Four fields, `additionalProperties: false` in the schema.
 *     `StoredEvidenceRecord` carries the document as an opaque `evidenceJson` string, so control (f)
 *     has to try to smuggle findings in and be refused by the schema — measured in
 *     `adoption-record-schema.test.ts`, and here by asserting the projection's exact key set.
 *   - REFUSALS ARE REFUSALS, NOT SUBSTITUTIONS. A CONFLICT subject has no slug, and the schema
 *     requires one. Compiling a placeholder would publish a page at a URL that is not this subject's,
 *     so the function throws. Same for an empty cohort (a chain root cannot be synthesized) and for a
 *     lifecycle status outside the four.
 *
 * Negative controls this file is the measurement for:
 *   (c)  recompute `decisionDigest` instead of copying `TrustDecision.digest`
 *   (d)  emit an `evidenceDigest` with a null `artifactDigest`
 *   (e)  null the `decisionDigest` when nothing resolved
 *   (h)  widen `AdoptionLifecycleStatus` to INV-10's seven
 *   (i)  remove a status from the frozen four
 */
import { describe, it, expect } from "vitest"
import {
  ADOPTION_LIFECYCLE_STATUSES,
  ADOPTION_RECORD_SCHEMA,
  adoptionRecordDigest,
  compileAdoptionRecord,
  compileAdoptionRecordWithDigest,
  isAdoptionLifecycleStatus,
  OFFICIAL_REGISTRY_SOURCE_ID,
  toSourceRecord,
  type AdoptionRecordHostCompatibility,
  type CompileAdoptionRecordInput,
  type SourceRecordV1,
  type StoredArtifactVersion,
  type StoredEvidenceRecord,
  type StoredSubject,
} from "../src/index.js"

const OFFICIAL_META = "io.modelcontextprotocol.registry/official"
const RETRIEVED = "2026-08-04T00:00:00.000Z"
const FIRST_SEEN = "2026-08-01T00:00:00.000Z"
const LAST_SEEN = "2026-08-04T00:00:00.000Z"

const IDENTITY = `sha256:${"1".repeat(64)}`
const ARTIFACT = `sha256:${"2".repeat(64)}`
const EVIDENCE = `sha256:${"3".repeat(64)}`
const DECISION = `sha256:${"4".repeat(64)}`
const POLICY = `sha256:${"5".repeat(64)}`
const CONTRACT = `sha256:${"6".repeat(64)}`
const PRESENTATION = `sha256:${"7".repeat(64)}`
const PAGE = `sha256:${"8".repeat(64)}`

/**
 * A `SourceRecordV1` through the SHIPPED adapter, never hand-authored.
 *
 * The same decision `evidence-compilation.test.ts` records: a literal would let this file's idea of a
 * payload drift from what `officialRegistry.ts` actually mirrors, and `sourcePayloadDigest` is read
 * straight off it — so a fixture-shaped digest would be measuring nothing.
 */
function record(name: string, version = "1.0.0"): SourceRecordV1 {
  const built = toSourceRecord(
    {
      server: { name, version },
      _meta: { [OFFICIAL_META]: { status: "active", isLatest: true } },
    } as never,
    RETRIEVED,
  )
  if (built === null) throw new Error(`fixture "${name}" was rejected by the shipped adapter`)
  return built
}

function subject(overrides: Partial<StoredSubject> = {}): StoredSubject {
  return {
    subjectId: `sha256:${"9".repeat(64)}`,
    canonicalName: "io.example/alpha",
    canonicalSlug: "io-example-alpha",
    displayName: "Alpha",
    identityStatus: "RESOLVED",
    identityDigest: IDENTITY,
    firstSeenAt: FIRST_SEEN,
    lastSeenAt: LAST_SEEN,
    lifecycleStatus: "ACTIVE",
    withdrawnAt: null,
    ...overrides,
  }
}

function artifact(overrides: Partial<StoredArtifactVersion> = {}): StoredArtifactVersion {
  return {
    artifactVersionId: `sha256:${"a".repeat(64)}`,
    subjectId: subject().subjectId,
    packageType: "npm",
    packageIdentifier: "@example/alpha",
    version: "1.0.0",
    sourceLocator: "https://registry.npmjs.org/@example/alpha",
    immutableDigest: ARTIFACT,
    registryIntegrity: null,
    artifactStatus: "FETCHED",
    cacheKey: ARTIFACT,
    firstSeenAt: FIRST_SEEN,
    lastVerifiedAt: LAST_SEEN,
    ...overrides,
  }
}

function evidence(overrides: Partial<StoredEvidenceRecord> = {}): StoredEvidenceRecord {
  return {
    evidenceDigest: EVIDENCE,
    artifactVersionId: artifact().artifactVersionId,
    engineVersion: "1.7.2",
    policyDigest: POLICY,
    verdict: "UNKNOWN",
    // The document as the store holds it: an OPAQUE STRING. Nothing in `compileAdoptionRecord` parses
    // it, which is what makes the findings structurally unreachable from the public record.
    evidenceJson: JSON.stringify({ findings: [{ id: "MCP-EXEC-01", severity: "high" }] }),
    createdAt: LAST_SEEN,
    ...overrides,
  }
}

const HOSTS: readonly AdoptionRecordHostCompatibility[] = [
  { host: "cursor", tier: "A", installability: "REVIEW_REQUIRED" },
  { host: "claude-code", tier: "A", installability: "PREPARE_AVAILABLE" },
]

function input(overrides: Partial<CompileAdoptionRecordInput> = {}): CompileAdoptionRecordInput {
  return {
    subject: subject(),
    selectedArtifact: artifact(),
    sourcePayloads: [record("io.example/alpha")],
    evidence: evidence(),
    findingCount: 1,
    decision: { verdict: "REVIEW", decisionDigest: DECISION, policyDigest: POLICY },
    presentation: {
      presentationDigest: PRESENTATION,
      semanticContractDigest: CONTRACT,
      pageDigest: PAGE,
    },
    hostCompatibility: HOSTS,
    lifecycleStatus: "ACTIVE",
    ...overrides,
  }
}

describe("the lifecycle vocabulary is closed, and is NOT INV-10's seven (controls h, i)", () => {
  it("declares exactly four uppercase statuses", () => {
    // SORTED EQUALITY, so an ADDITION fails as loudly as a removal — the half `toContain` cannot see.
    // Control (h) adds INV-10's seven here; control (i) removes one.
    expect([...ADOPTION_LIFECYCLE_STATUSES].sort()).toEqual([
      "ACTIVE",
      "DEPRECATED",
      "TOMBSTONED",
      "WITHDRAWN",
    ])
    // The count, pinned independently: this is the vacuity guard for the forbidden-value scan below,
    // which would pass over an emptied array.
    expect(ADOPTION_LIFECYCLE_STATUSES).toHaveLength(4)
    expect(Object.isFrozen(ADOPTION_LIFECYCLE_STATUSES)).toBe(true)
  })

  it("excludes the five INV-10 states that are not ours, and admits the two that collide", () => {
    // THE LAYER BOUNDARY, stated precisely rather than as "the seven are forbidden" — which would be
    // FALSE and is exactly the confusion R-6 fell into. `DEPRECATED` and `TOMBSTONED` are legitimately
    // in both vocabularies; the other five are not, and their absence is what proves this column is a
    // fifth vocabulary rather than INV-10's seven wearing a different name.
    const notOurs = [
      "SUPPORTED",
      "LOCAL_PREFLIGHT_REQUIRED",
      "UNSUPPORTED",
      "IDENTITY_CONFLICT",
      "PROCESSING_FAILED",
    ] as const
    expect(notOurs).toHaveLength(5)
    for (const forbidden of notOurs) {
      expect(
        ADOPTION_LIFECYCLE_STATUSES as readonly string[],
        `${forbidden} is INV-10's conclusion layer (adrs/0061 §8), not adoption_records.lifecycle_status`,
      ).not.toContain(forbidden)
      expect(isAdoptionLifecycleStatus(forbidden)).toBe(false)
    }
    // The two that DO overlap, asserted as members so a later reader cannot "fix" the boundary by
    // deleting them.
    expect(isAdoptionLifecycleStatus("DEPRECATED")).toBe(true)
    expect(isAdoptionLifecycleStatus("TOMBSTONED")).toBe(true)
  })

  it("rejects the lowercase source vocabulary", () => {
    // `sources[].lifecycleStatus` is lowercase and source-claimed; `lifecycle.status` is uppercase and
    // ours. Both live in one document, so a case-insensitive membership test would fuse two layers.
    for (const lower of ["active", "deprecated", "deleted", "unknown"]) {
      expect(isAdoptionLifecycleStatus(lower)).toBe(false)
    }
  })
})

describe("every digest is copied from its one producer (control c)", () => {
  it("carries all eight through verbatim", () => {
    const rec = compileAdoptionRecord(input())
    expect(rec.digests).toEqual({
      sourcePayloadDigest: record("io.example/alpha").source.payloadDigest,
      identityDigest: IDENTITY,
      artifactDigest: ARTIFACT,
      evidenceDigest: EVIDENCE,
      decisionDigest: DECISION,
      semanticContractDigest: CONTRACT,
      presentationDigest: PRESENTATION,
      pageDigest: PAGE,
    })
  })

  it("preserves a decisionDigest that could not have been derived from the record", () => {
    // THE DATA-DEPENDENCE FORM, chosen because a pure function's internals are not observable and
    // R-3's control #16 proved a reordering unfalsifiable. This digest is a fixed literal with no
    // relationship to any field of the record, so ANY recomputation — over the record, over the
    // decision object, over the digest set — produces a different value. Control (c) does exactly
    // that, and this is what refuses it.
    const alien = `sha256:${"b".repeat(64)}`
    const rec = compileAdoptionRecord(input({ decision: { verdict: "BLOCK", decisionDigest: alien, policyDigest: POLICY } }))
    expect(rec.digests.decisionDigest).toBe(alien)
    expect(rec.decision.decisionDigest).toBe(alien)
    // And the two copies agree: the record's `decision` block and its `digests` set are the same fact
    // written twice, so a recomputation in either place would split them.
    expect(rec.decision.decisionDigest).toBe(rec.digests.decisionDigest)
  })

  it("takes artifactDigest from the VERIFIED BYTES, not the row id", () => {
    // A row exists as soon as the version is known; the digest exists only once bytes are pinned. An
    // implementation reaching for `artifactVersionId` would look correct and publish a record claiming
    // verified bytes for an artifact that was never fetched.
    const rec = compileAdoptionRecord(
      input({ selectedArtifact: artifact({ immutableDigest: null, artifactStatus: "UNAVAILABLE" }), evidence: null, findingCount: null }),
    )
    expect(rec.digests.artifactDigest).toBeNull()
    expect(rec.selectedArtifact?.artifactVersionId).toBe(artifact().artifactVersionId)
  })
})

describe("the record is stable over input order", () => {
  it("produces deep-equal records from two permutations of one cohort", () => {
    const a = record("io.example/alpha")
    const b = record("io.example/beta")
    const c = record("io.example/gamma")
    const forward = compileAdoptionRecordWithDigest(input({ sourcePayloads: [a, b, c] }))
    const reversed = compileAdoptionRecordWithDigest(input({ sourcePayloads: [c, b, a] }))
    expect(reversed.record).toEqual(forward.record)
    expect(reversed.adoptionRecordDigest).toBe(forward.adoptionRecordDigest)
    // And `sourcePayloadDigest` specifically: it is read off the FIRST payload after sorting, so this
    // is the field a pre-sort implementation would make order-dependent.
    expect(reversed.record.digests.sourcePayloadDigest).toBe(forward.record.digests.sourcePayloadDigest)
  })

  it("sorts hostCompatibility by host", () => {
    const rec = compileAdoptionRecord(input())
    expect(rec.hostCompatibility.map((h) => h.host)).toEqual(["claude-code", "cursor"])
  })

  it("names the record with hashJson, and the name follows the content", () => {
    const { record: rec, adoptionRecordDigest: named } = compileAdoptionRecordWithDigest(input())
    expect(named).toBe(adoptionRecordDigest(rec))
    expect(named).toMatch(/^sha256:[0-9a-f]{64}$/)
    const moved = compileAdoptionRecordWithDigest(input({ lifecycleStatus: "DEPRECATED" }))
    expect(moved.adoptionRecordDigest).not.toBe(named)
  })
})

describe("the evidence projection is exactly four fields (control f)", () => {
  it("publishes the count and not the findings", () => {
    const rec = compileAdoptionRecord(input())
    expect(Object.keys(rec.evidence ?? {}).sort()).toEqual([
      "engineVersion",
      "evidenceDigest",
      "findingCount",
      "policyDigest",
    ])
    expect(rec.evidence?.findingCount).toBe(1)
    // The findings ARE in the fixture's `evidenceJson`, and they are absent from the record. Asserted
    // over the serialized form because that is what a page or a partner response would carry.
    expect(JSON.stringify(rec)).not.toContain("MCP-EXEC-01")
  })

  it("defaults a missing findingCount to 0 rather than omitting the field", () => {
    // `findingCount` is required by the schema. A null from the caller means "not counted", and the
    // honest projection of that is 0 findings published — not a missing key that makes the document
    // invalid.
    const rec = compileAdoptionRecord(input({ findingCount: null }))
    expect(rec.evidence?.findingCount).toBe(0)
  })

  it("emits a null evidence block when nothing is graded", () => {
    const rec = compileAdoptionRecord(input({ evidence: null, findingCount: null }))
    expect(rec.evidence).toBeNull()
    expect(rec.digests.evidenceDigest).toBeNull()
  })
})

describe("refusals are refusals, never substitutions", () => {
  it("refuses a subject with no canonicalSlug", () => {
    // A CONFLICT subject's slug is null in the row and required by the schema. Substituting the
    // subjectId or the canonicalName would publish a page at a URL that is not this subject's.
    expect(() =>
      compileAdoptionRecord(input({ subject: subject({ canonicalSlug: null, identityStatus: "CONFLICT" }) })),
    ).toThrow(/no canonicalSlug/)
  })

  it("refuses an empty source cohort", () => {
    expect(() => compileAdoptionRecord(input({ sourcePayloads: [] }))).toThrow(/chain ROOT/)
  })

  it("refuses a lifecycle status outside the four, naming the vocabulary it derived", () => {
    // TypeScript is erased, so this is the runtime half. The cast is what a JSON-parsed row or a JS
    // caller hands in — control (b)'s shape, measured here on the pure side.
    const bad = "WITHDRAWNN" as never
    // The expectation is BUILT from the frozen set, not spelled out. Measured while running control
    // (i): the literal form of this line passed with `WITHDRAWN` removed from the frozen set, because
    // the compiler's message was a literal too and the two agreed with each other while both
    // disagreeing with the vocabulary. Deriving both ends means the only way to satisfy this is for
    // the refusal to quote the set that is actually enforced.
    expect(() => compileAdoptionRecord(input({ lifecycleStatus: bad }))).toThrow(
      ADOPTION_LIFECYCLE_STATUSES.join("|"),
    )
    expect(ADOPTION_LIFECYCLE_STATUSES.join("|")).toBe("ACTIVE|DEPRECATED|WITHDRAWN|TOMBSTONED")
  })

  it("refuses an incoherent digest chain before returning (controls d, e)", () => {
    // `assertDigestChain` runs inside the compiler, so an incoherent set cannot reach the store even
    // if a caller skips the store's own check. (d): evidence with no artifact.
    expect(() =>
      compileAdoptionRecord(
        input({ selectedArtifact: artifact({ immutableDigest: null }), evidence: evidence() }),
      ),
    ).toThrow(/mis-ordered chain/)
    // (e): a record with nothing resolved still needs a decision.
    expect(() =>
      compileAdoptionRecord(
        input({
          selectedArtifact: null,
          evidence: null,
          findingCount: null,
          decision: { verdict: "UNKNOWN", decisionDigest: "", policyDigest: POLICY },
        }),
      ),
    ).toThrow(/UNKNOWN is a decision/)
  })
})

describe("the UNKNOWN shape — nothing resolved, and still a record", () => {
  it("compiles a record with no artifact, no evidence and no contract", () => {
    const rec = compileAdoptionRecord(
      input({
        selectedArtifact: null,
        evidence: null,
        findingCount: null,
        decision: { verdict: "UNKNOWN", decisionDigest: DECISION, policyDigest: POLICY },
        presentation: { presentationDigest: PRESENTATION, semanticContractDigest: null },
        hostCompatibility: [{ host: "cursor", tier: "A", installability: "LOCAL_PREFLIGHT_REQUIRED" }],
      }),
    )
    expect(rec.schema).toBe(ADOPTION_RECORD_SCHEMA)
    expect(rec.selectedArtifact).toBeNull()
    expect(rec.evidence).toBeNull()
    expect(rec.digests.artifactDigest).toBeNull()
    expect(rec.digests.semanticContractDigest).toBeNull()
    expect(rec.digests.decisionDigest).toBe(DECISION)
    // `pageDigest` OMITTED, not null: the schema lists it as a property but not in `required`, and
    // `additionalProperties: false` plus a `type: string` means an explicit null would be invalid.
    expect("pageDigest" in rec.digests).toBe(false)
    expect(rec.decision.verdict).toBe("UNKNOWN")
  })

  it("projects the sources block from the mirrored payloads", () => {
    const rec = compileAdoptionRecord(input())
    expect(rec.sources).toHaveLength(1)
    expect(rec.sources[0]).toMatchObject({
      sourceId: OFFICIAL_REGISTRY_SOURCE_ID,
      retrievedAt: RETRIEVED,
      // LOWERCASE: what the source claims about itself, mirrored unchanged beside our uppercase
      // conclusion in the same document.
      lifecycleStatus: "active",
    })
    expect(rec.lifecycle.status).toBe("ACTIVE")
  })
})
