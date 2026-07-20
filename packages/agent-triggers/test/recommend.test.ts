/**
 * new11 P2 PR-10 — recommend-policy contract, bound by ADR 0051.
 *
 * The invariants under test are the whole point of the ADR: display-only,
 * non-blocking, and UNKNOWN/absent is never SAFE.
 */
import { describe, it, expect } from "vitest"
import { VERDICTS, type Verdict } from "@calllint/types"
import { RECOMMENDATIONS, recommendFromVerdict } from "../src/index.js"

describe("recommendFromVerdict — verdict → non-blocking recommendation", () => {
  it("maps each verdict to a recommendation and carries the verdict verbatim", () => {
    const expected: Record<Verdict, string> = {
      SAFE: "proceed",
      REVIEW: "review",
      UNKNOWN: "gather-evidence",
      BLOCK: "stop-and-confirm",
    }
    for (const v of VERDICTS) {
      const r = recommendFromVerdict(v)
      expect(r.verdict).toBe(v)
      expect(r.recommendation).toBe(expected[v])
      expect(r.guidance.length).toBeGreaterThan(0)
    }
  })
})

describe("ADR 0051 INVARIANT — never blocking", () => {
  it("every verdict, and the null case, yields blocking:false", () => {
    for (const v of VERDICTS) {
      expect(recommendFromVerdict(v).blocking).toBe(false)
    }
    expect(recommendFromVerdict(null).blocking).toBe(false)
  })

  it("no recommendation member is a deny/block enforcement verb", () => {
    // The strongest is advisory 'stop-and-confirm'; there is no 'deny'/'block'.
    expect(RECOMMENDATIONS).not.toContain("deny")
    expect(RECOMMENDATIONS).not.toContain("block")
  })
})

describe("ADR 0010 INVARIANT — UNKNOWN / absent is never SAFE", () => {
  it("UNKNOWN maps to gather-evidence, not proceed", () => {
    expect(recommendFromVerdict("UNKNOWN").recommendation).toBe("gather-evidence")
  })

  it("a null (not-yet-scanned) verdict is treated as UNKNOWN, never proceed", () => {
    const r = recommendFromVerdict(null)
    expect(r.verdict).toBeNull()
    expect(r.recommendation).toBe("gather-evidence")
    expect(r.recommendation).not.toBe("proceed")
  })

  it("only SAFE ever yields proceed (negative fixture across the vocab)", () => {
    for (const v of VERDICTS) {
      const isProceed = recommendFromVerdict(v).recommendation === "proceed"
      expect(isProceed).toBe(v === "SAFE")
    }
  })
})
