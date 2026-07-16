import { describe, it, expect } from "vitest"
import type { ApprovedDriftReport, CompactDecision } from "@calllint/types"
import { verifyApproved } from "../src/state/verifyApproved.js"
import { buildApproved } from "../src/state/approve.js"
import { assessGuardDrift, guardFailClosed } from "../src/state/continuousGuard.js"

const AT = "2026-07-16T00:00:00.000Z"
const GEN = "2026-07-16T01:00:00.000Z"

function decision(
  surface: string,
  fingerprintHash: string,
  verdict: CompactDecision["verdict"] = "REVIEW",
): CompactDecision {
  return {
    schemaVersion: "calllint.decision.v0",
    verdict,
    surface,
    fingerprintHash,
    reasonCodes: [],
    nextAction: "ask_before_continue",
  }
}

/** A hand-built drift report, for exercising the severity mapping directly. */
function report(
  drifted: boolean,
  verdict: ApprovedDriftReport["verdict"],
  changed = 1,
): ApprovedDriftReport {
  const entries: ApprovedDriftReport["entries"] = []
  for (let i = 0; i < changed; i++) {
    entries.push({ surface: `s${i}.json`, status: "hash-changed", currentVerdict: verdict })
  }
  if (!drifted) entries.push({ surface: "stable.json", status: "unchanged" })
  return { schemaVersion: "calllint.approveddrift.v0", drifted, verdict, entries, generatedAt: GEN }
}

describe("assessGuardDrift — silent when nothing changed (ADR 0045 §2)", () => {
  it("no drift → silent, SAFE, exit-neutral (the retention promise)", () => {
    const current = [decision("a.json", "sha256:1"), decision("b.json", "sha256:2", "SAFE")]
    const r = verifyApproved(current, buildApproved(current, AT), GEN)
    const a = assessGuardDrift(r)
    expect(a.action).toBe("silent")
    expect(a.verdict).toBe("SAFE")
    expect(a.drifted).toBe(false)
  })

  it("silent path fires through the real verifyApproved composition, not a hand-built report", () => {
    // Same surface, byte-identical hash → verifyApproved says not-drifted → guard silent.
    const current = [decision("only.json", "sha256:same", "SAFE")]
    const a = assessGuardDrift(verifyApproved(current, buildApproved(current, AT), GEN))
    expect(a.action).toBe("silent")
  })
})

describe("assessGuardDrift — loud only on new authority (ADR 0045 §2)", () => {
  it("drifted BLOCK → refuse", () => {
    const a = assessGuardDrift(report(true, "BLOCK"))
    expect(a.action).toBe("refuse")
    expect(a.verdict).toBe("BLOCK")
    expect(a.drifted).toBe(true)
  })

  it("drifted UNKNOWN → request-evidence (never SAFE, I-04)", () => {
    const a = assessGuardDrift(report(true, "UNKNOWN"))
    expect(a.action).toBe("request-evidence")
    expect(a.verdict).toBe("UNKNOWN")
  })

  it("drifted REVIEW → prompt", () => {
    const a = assessGuardDrift(report(true, "REVIEW"))
    expect(a.action).toBe("prompt")
    expect(a.verdict).toBe("REVIEW")
  })

  it("end-to-end: a hash change that escalates to BLOCK drives refuse", () => {
    const approved = buildApproved([decision("a.json", "sha256:1", "REVIEW")], AT)
    const current = [decision("a.json", "sha256:CHANGED", "BLOCK")]
    const a = assessGuardDrift(verifyApproved(current, approved, GEN))
    expect(a.action).toBe("refuse")
    expect(a.verdict).toBe("BLOCK")
  })

  it("summary names how many surfaces moved", () => {
    expect(assessGuardDrift(report(true, "REVIEW", 1)).summary).toContain("1 surface;")
    expect(assessGuardDrift(report(true, "REVIEW", 3)).summary).toContain("3 surfaces;")
  })
})

describe("guardFailClosed — the guard's own failure never reads as a pass (ADR 0045 §3)", () => {
  it("fails closed to UNKNOWN, not SAFE", () => {
    const a = guardFailClosed("corrupt approved.json")
    expect(a.action).toBe("fail-closed")
    expect(a.verdict).toBe("UNKNOWN")
    expect(a.verdict).not.toBe("SAFE")
    expect(a.failure).toBe("corrupt approved.json")
  })

  it("a normal assessment never carries a failure string", () => {
    expect(assessGuardDrift(report(true, "BLOCK")).failure).toBeUndefined()
    expect(assessGuardDrift(report(false, "SAFE")).failure).toBeUndefined()
  })
})

describe("assessGuardDrift — pure and total", () => {
  it("same report → identical assessment (determinism)", () => {
    const r = report(true, "UNKNOWN", 2)
    expect(assessGuardDrift(r)).toEqual(assessGuardDrift(r))
  })

  it("every verdict maps to a defined action (no undefined fall-through)", () => {
    for (const v of ["SAFE", "REVIEW", "BLOCK", "UNKNOWN"] as const) {
      const a = assessGuardDrift(report(true, v))
      expect(a.action).toBeDefined()
      // A drifted surface is never silent — the surface moved.
      expect(a.action).not.toBe("silent")
    }
  })
})
