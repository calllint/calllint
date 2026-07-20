import { describe, it, expect } from "vitest"
import {
  mergeResults,
  evaluatePublishEligibility,
  completenessReport,
  explainUnknown,
  type EvidenceSubject,
  type ResolverResult,
} from "../src/index.js"

/**
 * new11 PR-09 — publish eligibility (§4.7), completeness (§4.3), and the §4.5
 * rule that a resolution failure is NOT an analysis UNKNOWN.
 */
const subject: EvidenceSubject = {
  schema: "calllint.evidence-subject.v0",
  subjectType: "npm-package",
  id: "npm:foo@1.2.3",
}

/** A fully-resolved bundle: identity name + version, no gaps. */
function cleanBundle() {
  const r: ResolverResult = {
    resolver: "R1:npm",
    status: "complete",
    items: [
      { field: "identity.name", value: "foo", tier: "registry", source: "R1:npm" },
      { field: "identity.version", value: "1.2.3", tier: "registry", source: "R1:npm" },
    ],
    gaps: [],
  }
  return mergeResults(subject, [r])
}

describe("evaluatePublishEligibility (§4.7)", () => {
  it("clean bundle + bound verdict → eligible, no blockers", () => {
    const rep = evaluatePublishEligibility(cleanBundle(), { verdictBound: true })
    expect(rep.eligible).toBe(true)
    expect(rep.blockers).toEqual([])
  })

  it("fails CLOSED when verdict is not bound (default)", () => {
    const rep = evaluatePublishEligibility(cleanBundle())
    expect(rep.eligible).toBe(false)
    expect(rep.blockers).toContain("verdict-bound")
  })

  it("no version and no digest → exact-version-or-digest blocker", () => {
    const r: ResolverResult = {
      resolver: "R1:npm",
      status: "complete",
      items: [{ field: "identity.name", value: "foo", tier: "registry", source: "R1:npm" }],
      gaps: [],
    }
    const rep = evaluatePublishEligibility(mergeResults(subject, [r]), { verdictBound: true })
    expect(rep.blockers).toContain("exact-version-or-digest")
    expect(rep.eligible).toBe(false)
  })

  it("a PII field blocks publication (no-private-info)", () => {
    const r: ResolverResult = {
      resolver: "R2:github",
      status: "complete",
      items: [
        { field: "identity.name", value: "foo", tier: "registry", source: "R1:npm" },
        { field: "identity.version", value: "1.2.3", tier: "registry", source: "R1:npm" },
        { field: "publisher.email", value: "a@b.com", tier: "repository", source: "R2:github" },
      ],
      gaps: [],
    }
    const rep = evaluatePublishEligibility(mergeResults(subject, [r]), { verdictBound: true })
    expect(rep.blockers).toContain("no-private-info")
  })
})

/** A bundle that resolved identity but has a degrading gap. */
function partialBundle() {
  const r: ResolverResult = {
    resolver: "R1:npm",
    status: "partial",
    items: [
      { field: "identity.name", value: "foo", tier: "registry", source: "R1:npm" },
      { field: "identity.version", value: "1.2.3", tier: "registry", source: "R1:npm" },
    ],
    gaps: [makeGapProvenance()],
  }
  return mergeResults(subject, [r])
}
function makeGapProvenance() {
  return {
    schema: "calllint.evidence-gap.v0" as const,
    code: "PROVENANCE_UNAVAILABLE" as const,
    detail: "no provenance attestation",
    missingFields: ["provenance.attestation"],
    triedResolvers: ["R1:npm"],
  }
}

describe("completenessReport (§4.3)", () => {
  it("lists resolved + missing fields and explains every gap", () => {
    const rep = completenessReport(partialBundle())
    expect(rep.clean).toBe(false)
    expect(rep.resolvedFields).toContain("identity.name")
    expect(rep.missingFields).toContain("provenance.attestation")
    expect(rep.gaps).toHaveLength(1)
    const gap = rep.gaps[0]!
    expect(gap.userMessage.length).toBeGreaterThan(0)
    expect(gap.category).toBe("provenance")
  })

  it("clean bundle reports clean + zero gaps", () => {
    const rep = completenessReport(cleanBundle())
    expect(rep.clean).toBe(true)
    expect(rep.gaps).toEqual([])
    expect(rep.missingFields).toEqual([])
  })
})

describe("explainUnknown (§4.5 — failure is not analysis-UNKNOWN)", () => {
  it("clean bundle → cause 'clean'", () => {
    expect(explainUnknown(cleanBundle()).cause).toBe("clean")
  })

  it("network failure → 'resolution-failure', retryable (NOT analysis UNKNOWN)", () => {
    const r: ResolverResult = {
      resolver: "R1:npm",
      status: "retryable-failure",
      items: [],
      gaps: [
        {
          schema: "calllint.evidence-gap.v0",
          code: "NETWORK_UNAVAILABLE",
          detail: "npm unreachable",
          missingFields: ["identity.version"],
          triedResolvers: ["R1:npm"],
        },
      ],
    }
    const ex = explainUnknown(mergeResults(subject, [r]))
    expect(ex.cause).toBe("resolution-failure")
    expect(ex.retryable).toBe(true)
  })

  it("equal-tier disagreement → 'conflicting-evidence', not retryable", () => {
    const mk = (src: string, val: string): ResolverResult => ({
      resolver: src,
      status: "complete",
      items: [{ field: "repo.url", value: val, tier: "registry", source: src }],
      gaps: [],
    })
    const ex = explainUnknown(mergeResults(subject, [mk("A", "x"), mk("B", "y")]))
    expect(ex.cause).toBe("conflicting-evidence")
    expect(ex.retryable).toBe(false)
  })

  it("degrading-only partial → 'incomplete'", () => {
    expect(explainUnknown(partialBundle()).cause).toBe("incomplete")
  })
})
