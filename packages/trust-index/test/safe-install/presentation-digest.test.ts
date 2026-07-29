// ---------------------------------------------------------------------------
// Workstream P Batch 1 — digest-seam tests (new15 §6.2 PR P-1, §7; ADR 0058 §5).
//
// The claim under test is a DIFFERENCE between two digests, so every case is a
// pair. A test that only showed `semanticContractDigest` holding still would be
// satisfied by a constant; a test that only showed `contractDigest` moving would
// be satisfied by hashing a timestamp. The suite therefore pins both directions:
//
//   mutation                     contractDigest   semanticContractDigest
//   L1/L2 consequence copy       stable           stable
//   publicObservation.publicLabel  MOVES          stable      ← the reason the seam exists
//   agentGuidance.steps (L3)     MOVES            MOVES       ← negative control
//   authority token / verdict    MOVES            MOVES       ← still binds real semantics
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest"
import { hashJson } from "@calllint/fingerprint"
import {
  CANONICAL_FIXTURES,
  DISPLAY_GROUPS,
  EMPTY_PRESENTATION_CONTENT,
  PRESENTATION_CONTENT_VERSION,
  SEMANTIC_PREIMAGE_OMISSIONS,
  buildAgentAdoptionContract,
  canonicalProjectionInput,
  emptyPresentationDigest,
  presentationDigest,
  proseLeaves,
  safeInstallProjection,
  sealAgentAdoptionContract,
  selectDecisionAuthorities,
  semanticContractDigest,
  semanticPreimage,
  type PresentationContentV1,
} from "../../src/index.js"

const inputs = CANONICAL_FIXTURES.map((f) => canonicalProjectionInput(f, "Publisher marketing blurb here."))
const projections = inputs.map((i) => safeInstallProjection(i))

describe("presentationDigest", () => {
  it("is deterministic and key-order independent", () => {
    const a: PresentationContentV1 = {
      schema: PRESENTATION_CONTENT_VERSION,
      locale: "en-US",
      tokens: { tokensVersion: "v1" },
      sectionTitles: { provenance: "Provenance" },
    }
    const b = { locale: "en-US", sectionTitles: { provenance: "Provenance" }, tokens: { tokensVersion: "v1" }, schema: PRESENTATION_CONTENT_VERSION } as PresentationContentV1
    expect(presentationDigest(a).presentationDigest).toBe(presentationDigest(b).presentationDigest)
  })

  it("the empty document has a stable digest — greenfield has an honest predecessor", () => {
    const empty = emptyPresentationDigest()
    expect(empty.presentationDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(empty.sections).toEqual([])
    expect(emptyPresentationDigest().presentationDigest).toBe(empty.presentationDigest)
  })

  it("an L1 copy change moves l1Digest and the aggregate, but NOT l0Digest or l2Digest", () => {
    // This is the §7 dependency graph: a copy edit must not force a CSS redeploy,
    // and a CSS edit must not force the human pages to rebuild.
    const base: PresentationContentV1 = {
      schema: PRESENTATION_CONTENT_VERSION,
      locale: "en-US",
      sectionTitles: { provenance: "Provenance" },
      authorityCopy: { observedPhrases: { secret_access: "Requires access to configured secrets." } },
      tokens: { tokensVersion: "v1" },
    }
    const l1Changed: PresentationContentV1 = { ...base, sectionTitles: { provenance: "Where this came from" } }
    const before = presentationDigest(base)
    const after = presentationDigest(l1Changed)
    expect(after.l1Digest).not.toBe(before.l1Digest)
    expect(after.presentationDigest).not.toBe(before.presentationDigest)
    expect(after.l0Digest).toBe(before.l0Digest)
    expect(after.l2Digest).toBe(before.l2Digest)
  })

  it("an L0 token change moves ONLY l0Digest among the level digests", () => {
    const base: PresentationContentV1 = {
      schema: PRESENTATION_CONTENT_VERSION,
      locale: "en-US",
      sectionTitles: { provenance: "Provenance" },
      authorityCopy: { observedPhrases: { secret_access: "Requires access to configured secrets." } },
      tokens: { tokensVersion: "v1" },
    }
    const after = presentationDigest({ ...base, tokens: { tokensVersion: "v2" } })
    const before = presentationDigest(base)
    expect(after.l0Digest).not.toBe(before.l0Digest)
    expect(after.l1Digest).toBe(before.l1Digest)
    expect(after.l2Digest).toBe(before.l2Digest)
  })

  it("reports exactly the sections present, in declaration order", () => {
    const doc: PresentationContentV1 = {
      schema: PRESENTATION_CONTENT_VERSION,
      locale: "en-US",
      tokens: { tokensVersion: "v1" },
      layout: { groupOrder: [...DISPLAY_GROUPS] },
    }
    expect(presentationDigest(doc).sections).toEqual(["layout", "tokens"])
  })

  it("the digest is a pure function of the document, not of the object identity", () => {
    expect(presentationDigest(EMPTY_PRESENTATION_CONTENT).presentationDigest).toBe(
      hashJson({ schema: PRESENTATION_CONTENT_VERSION, locale: "en-US" }),
    )
  })
})

describe("semanticContractDigest — the omission set is measured, not asserted", () => {
  it("the semantic preimage of every canonical contract contains NO prose at all", () => {
    // The gate on the whole design: machine tokens have no whitespace, prose always
    // does. An empty result proves no copy is bound — for any input, not just these.
    for (const p of projections) {
      const r = semanticContractDigest(p.agentContract)
      expect(r.proseLeaves, `${p.canonicalSlug}: ${JSON.stringify(r.proseLeaves)}`).toEqual([])
    }
  })

  it("the UNOMITTED contract DOES contain prose — so the previous test is not vacuous", () => {
    // Without this, "no prose in the preimage" could pass because the probe cannot
    // see prose at all. Here it must find the three known leaves.
    const paths = projections.flatMap((p) => proseLeaves(p.agentContract).map((l) => l.path))
    expect(paths).toContain("agentGuidance.goal")
    expect(paths).toContain("publicObservation.publicLabel")
    expect(paths).toContain("untrustedPublisherContent.description")
  })

  it("every declared omission is present in at least one real contract", () => {
    // A stale omission would silently weaken the digest while looking deliberate.
    const applied = new Set(projections.flatMap((p) => semanticContractDigest(p.agentContract).omissionsApplied))
    for (const o of SEMANTIC_PREIMAGE_OMISSIONS) {
      expect([...applied], `unused omission: ${o.path}`).toContain(o.path)
    }
  })

  it("is deterministic and does not mutate the contract it reads", () => {
    const p = projections[0]!
    const before = JSON.stringify(p.agentContract)
    const first = semanticContractDigest(p.agentContract).semanticContractDigest
    const second = semanticContractDigest(p.agentContract).semanticContractDigest
    expect(first).toBe(second)
    expect(JSON.stringify(p.agentContract)).toBe(before)
  })

  it("differs from contractDigest (it is a different preimage, not an alias)", () => {
    for (const p of projections) {
      const r = semanticContractDigest(p.agentContract)
      expect(r.contractDigest).toBe(p.agentContract.contract.contractDigest)
      expect(r.semanticContractDigest).not.toBe(r.contractDigest)
      expect(r.semanticContractDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    }
  })

  it("is invariant under a publisher-description change (already true of contractDigest)", () => {
    const withDesc = safeInstallProjection(canonicalProjectionInput(CANONICAL_FIXTURES[0]!, "One blurb"))
    const withOther = safeInstallProjection(canonicalProjectionInput(CANONICAL_FIXTURES[0]!, "A totally different blurb"))
    expect(semanticContractDigest(withOther.agentContract).semanticContractDigest).toBe(
      semanticContractDigest(withDesc.agentContract).semanticContractDigest,
    )
  })
})

describe("semanticContractDigest — the difference that justifies the seam", () => {
  const fixture = CANONICAL_FIXTURES[1]! // REVIEW: a real verdict with real authorities
  const input = canonicalProjectionInput(fixture, "Blurb.")
  const baseline = safeInstallProjection(input)

  /** Reseal a contract from the shipped builder with one field perturbed. */
  const reseal = (patch: (c: Record<string, unknown>) => Record<string, unknown>) => {
    const built = buildAgentAdoptionContract({
      page: input.page,
      subject: input.subject,
      selection: selectDecisionAuthorities(input.page),
      snapshotDigest: input.snapshotDigest,
      registrySnapshotDigest: input.registrySnapshotDigest,
      evidenceDigest: input.evidenceDigest,
      engineVersion: input.engineVersion,
      unsupported: input.unsupported,
    })
    const patched = patch(JSON.parse(JSON.stringify(built)) as Record<string, unknown>)
    return sealAgentAdoptionContract(patched as never, hashJson)
  }

  it("L1/L2 consequence copy: BOTH digests stable (INV-P1)", () => {
    const sentinelSelection = (() => {
      const real = selectDecisionAuthorities(input.page)
      return {
        ...real,
        consequenceSummary: "REWORDED SUMMARY",
        facts: real.facts.map((f) => ({ ...f, consequence: "Reworded consequence sentence." })),
      }
    })()
    const resealed = sealAgentAdoptionContract(
      buildAgentAdoptionContract({
        page: input.page,
        subject: input.subject,
        selection: sentinelSelection,
        snapshotDigest: input.snapshotDigest,
        registrySnapshotDigest: input.registrySnapshotDigest,
        evidenceDigest: input.evidenceDigest,
        engineVersion: input.engineVersion,
        unsupported: input.unsupported,
      }),
      hashJson,
    )
    expect(resealed.contract.contractDigest).toBe(baseline.agentContract.contract.contractDigest)
    expect(semanticContractDigest(resealed).semanticContractDigest).toBe(
      semanticContractDigest(baseline.agentContract).semanticContractDigest,
    )
  })

  it("publicLabel: contractDigest MOVES, semanticContractDigest HOLDS — the whole point", () => {
    // new15 §7's motivating scenario: rewording human-facing text must not
    // invalidate a sealed plan. Under contractDigest today, it does.
    const relabelled = reseal((c) => {
      const po = c.publicObservation as Record<string, unknown>
      po.publicLabel = "Needs a closer look"
      return c
    })
    expect(relabelled.contract.contractDigest).not.toBe(baseline.agentContract.contract.contractDigest)
    expect(semanticContractDigest(relabelled).semanticContractDigest).toBe(
      semanticContractDigest(baseline.agentContract).semanticContractDigest,
    )
  })

  it("agentGuidance.goal: contractDigest MOVES, semanticContractDigest HOLDS", () => {
    const regoaled = reseal((c) => {
      const g = c.agentGuidance as Record<string, unknown>
      g.goal = "Add the requested Agent Tool with only locally approved authority (reworded)."
      return c
    })
    expect(regoaled.contract.contractDigest).not.toBe(baseline.agentContract.contract.contractDigest)
    expect(semanticContractDigest(regoaled).semanticContractDigest).toBe(
      semanticContractDigest(baseline.agentContract).semanticContractDigest,
    )
  })

  it("NEGATIVE CONTROL — agentGuidance.steps (L3 protocol): BOTH digests move", () => {
    // Without this the seam could be satisfied by a digest that never moves.
    const restepped = reseal((c) => {
      const g = c.agentGuidance as Record<string, unknown>
      g.steps = ["verify_contract", "apply_exact_plan"]
      return c
    })
    expect(restepped.contract.contractDigest).not.toBe(baseline.agentContract.contract.contractDigest)
    expect(semanticContractDigest(restepped).semanticContractDigest).not.toBe(
      semanticContractDigest(baseline.agentContract).semanticContractDigest,
    )
  })

  it("NEGATIVE CONTROL — an authority token and a mustStop trigger: BOTH digests move", () => {
    const retokened = reseal((c) => {
      const ad = c.authorityDelta as { adds: { authority: string }[] }
      ad.adds = [{ authority: "financial_action" }]
      return c
    })
    expect(semanticContractDigest(retokened).semanticContractDigest).not.toBe(
      semanticContractDigest(baseline.agentContract).semanticContractDigest,
    )

    const restopped = reseal((c) => {
      const g = c.agentGuidance as Record<string, unknown>
      g.mustStopWhen = ["artifact_digest_mismatch"]
      return c
    })
    expect(semanticContractDigest(restopped).semanticContractDigest).not.toBe(
      semanticContractDigest(baseline.agentContract).semanticContractDigest,
    )
  })

  it("NEGATIVE CONTROL — a different verdict yields a different semantic digest", () => {
    const byVerdict = new Map<string, string>()
    for (const p of projections) {
      byVerdict.set(p.publicObservation.verdict, semanticContractDigest(p.agentContract).semanticContractDigest)
    }
    expect(new Set(byVerdict.values()).size).toBe(byVerdict.size)
  })

  it("semanticPreimage removes exactly the declared paths and nothing else", () => {
    const { preimage, applied, notPresent } = semanticPreimage(baseline.agentContract)
    expect([...applied, ...notPresent].sort()).toEqual(SEMANTIC_PREIMAGE_OMISSIONS.map((o) => o.path).sort())
    // Structure is otherwise intact: the semantic sections all survive.
    for (const key of ["schema", "contract", "subject", "publicObservation", "authorityDelta", "trustedSources", "recommendedNextAction", "agentGuidance"]) {
      expect(Object.keys(preimage)).toContain(key)
    }
    expect((preimage.publicObservation as Record<string, unknown>).verdict).toBe(
      baseline.agentContract.publicObservation.verdict,
    )
  })
})
