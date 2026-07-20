import { describe, it, expect } from "vitest"
import {
  EVIDENCE_GAP_CODES,
  EVIDENCE_GAP_META,
  isMaintainerFixable,
  isNetworkRecoverable,
  makeGap,
  mergeResults,
  bundleState,
  isCleanlyResolved,
  hasBlockingGap,
  canTransition,
  isTerminal,
  stateFromResolverStatus,
  tierRank,
  type EvidenceSubject,
  type ResolverResult,
} from "../src/index.js"

/**
 * new11 PR-05 — evidence-model.v0 invariants. Mirrors the engine's fail-closed
 * posture: a missing/unreachable signal is a GAP, a lower tier never overrides a
 * higher one, equal-tier disagreement is CONFLICTING_EVIDENCE, and only COMPLETE
 * with zero blocking gaps reads as clean.
 */

const subject: EvidenceSubject = {
  schema: "calllint.evidence-subject.v0",
  subjectType: "npm-package",
  id: "npm:foo@1.2.3",
}

describe("evidence-gap reason codes", () => {
  it("freezes exactly 16 codes and each has complete metadata", () => {
    expect(EVIDENCE_GAP_CODES).toHaveLength(16)
    for (const code of EVIDENCE_GAP_CODES) {
      const m = EVIDENCE_GAP_META[code]
      expect(m.userMessage.length).toBeGreaterThan(0)
      expect(["blocking", "degrading"]).toContain(m.severity)
    }
  })

  it("derives maintainer-fixable and network-recoverable from metadata", () => {
    expect(isMaintainerFixable("PACKAGE_NOT_FOUND")).toBe(true)
    expect(isMaintainerFixable("NETWORK_UNAVAILABLE")).toBe(false)
    expect(isNetworkRecoverable("RATE_LIMITED")).toBe(true)
    expect(isNetworkRecoverable("PACKAGE_NOT_FOUND")).toBe(false)
  })
})

describe("makeGap is fail-closed", () => {
  it("throws on an off-vocabulary code rather than emitting noise", () => {
    // @ts-expect-error deliberately invalid code
    expect(() => makeGap("NOT_A_CODE", "x")).toThrow(/unknown evidence-gap code/)
  })
})

describe("priority ladder", () => {
  const base = (tier: any, value: string, source: string): ResolverResult => ({
    resolver: source,
    status: "complete",
    items: [{ field: "repo.url", value, tier, source }],
    gaps: [],
  })

  it("a higher tier shadows a lower tier for the same field", () => {
    const b = mergeResults(subject, [
      base("inferred", "github.com/guess/x", "R0"),
      base("artifact-bound", "github.com/real/x", "R1"),
    ])
    const item = b.items.find((i) => i.field === "repo.url")!
    expect(item.value).toBe("github.com/real/x")
    expect(item.tier).toBe("artifact-bound")
    expect(b.gaps).toHaveLength(0)
  })

  it("is order-independent (deterministic)", () => {
    const a = mergeResults(subject, [base("inferred", "g", "R0"), base("registry", "r", "R1")])
    const c = mergeResults(subject, [base("registry", "r", "R1"), base("inferred", "g", "R0")])
    expect(a.items).toEqual(c.items)
  })

  it("equal-tier disagreement raises CONFLICTING_EVIDENCE and drops the field", () => {
    const b = mergeResults(subject, [
      base("registry", "github.com/a/x", "R1"),
      base("registry", "github.com/b/x", "R2"),
    ])
    expect(b.items.find((i) => i.field === "repo.url")).toBeUndefined()
    expect(b.gaps.some((g) => g.code === "CONFLICTING_EVIDENCE")).toBe(true)
    expect(b.state).toBe("PARTIAL")
    expect(isCleanlyResolved(b)).toBe(false)
  })

  it("tierRank orders inferred < artifact-bound", () => {
    expect(tierRank("inferred")).toBeLessThan(tierRank("artifact-bound"))
  })
})

describe("bundle state + clean invariant", () => {
  it("COMPLETE with no blocking gap is the only clean state", () => {
    const clean = mergeResults(subject, [
      { resolver: "R1", status: "complete", items: [], gaps: [] },
    ])
    expect(clean.state).toBe("COMPLETE")
    expect(isCleanlyResolved(clean)).toBe(true)
  })

  it("a blocking gap forces PARTIAL and blocks clean", () => {
    const gap = makeGap("PACKAGE_NOT_FOUND", "no such package")
    const b = mergeResults(subject, [{ resolver: "R1", status: "complete", items: [], gaps: [gap] }])
    expect(hasBlockingGap(b.gaps)).toBe(true)
    expect(b.state).toBe("PARTIAL")
    expect(isCleanlyResolved(b)).toBe(false)
  })

  it("network failure never reads as clean (retryable-failure)", () => {
    const gap = makeGap("NETWORK_UNAVAILABLE", "npm registry unreachable")
    const b = mergeResults(subject, [
      { resolver: "R1", status: "retryable-failure", items: [], gaps: [gap] },
    ])
    expect(b.state).toBe("RETRYABLE_FAILURE")
    expect(isCleanlyResolved(b)).toBe(false)
  })

  it("no resolvers ⇒ UNRESOLVABLE, never clean", () => {
    expect(bundleState([], [])).toBe("UNRESOLVABLE")
  })
})

describe("state machine", () => {
  it("only COMPLETE and PARTIAL may reach PUBLISHED; failures may re-queue", () => {
    expect(canTransition("COMPLETE", "PUBLISHED")).toBe(true)
    expect(canTransition("PARTIAL", "PUBLISHED")).toBe(true)
    expect(canTransition("UNRESOLVABLE", "PUBLISHED")).toBe(false)
    expect(canTransition("RETRYABLE_FAILURE", "QUEUED")).toBe(true)
    expect(canTransition("DISCOVERED", "PUBLISHED")).toBe(false)
  })

  it("UNRESOLVABLE / PUBLISHED are terminal", () => {
    expect(isTerminal("UNRESOLVABLE")).toBe(true)
    expect(isTerminal("PUBLISHED")).toBe(true)
    expect(isTerminal("DISCOVERED")).toBe(false)
  })

  it("maps resolver status to post-RESOLVING state", () => {
    expect(stateFromResolverStatus("complete")).toBe("COMPLETE")
    expect(stateFromResolverStatus("retryable-failure")).toBe("RETRYABLE_FAILURE")
  })
})
