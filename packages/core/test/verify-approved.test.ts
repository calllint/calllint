import { describe, it, expect } from "vitest"
import type { ApprovedState, CompactDecision } from "@calllint/types"
import { verifyApproved } from "../src/state/verifyApproved.js"
import { buildApproved } from "../src/state/approve.js"

const AT = "2026-06-29T00:00:00.000Z"
const GEN = "2026-06-29T01:00:00.000Z"

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

function approve(decisions: CompactDecision[]): ApprovedState {
  return buildApproved(decisions, AT)
}

describe("verifyApproved", () => {
  it("reports no drift when the current surface matches approved (negative case)", () => {
    const current = [decision("a.json", "sha256:1"), decision("b.json", "sha256:2", "SAFE")]
    const report = verifyApproved(current, approve(current), GEN)
    expect(report.drifted).toBe(false)
    expect(report.verdict).toBe("SAFE")
    expect(report.entries.every((e) => e.status === "unchanged")).toBe(true)
  })

  it("flags a changed capability hash as drift, never SAFE (positive case)", () => {
    const approved = approve([decision("a.json", "sha256:1")])
    const current = [decision("a.json", "sha256:CHANGED")]
    const report = verifyApproved(current, approved, GEN)
    expect(report.drifted).toBe(true)
    expect(report.entries[0]!.status).toBe("hash-changed")
    expect(report.verdict).not.toBe("SAFE")
    expect(report.verdict).toBe("REVIEW")
  })

  it("a drifted BLOCK surface escalates the report verdict to BLOCK", () => {
    const approved = approve([decision("a.json", "sha256:1", "REVIEW")])
    const current = [decision("a.json", "sha256:CHANGED", "BLOCK")]
    const report = verifyApproved(current, approved, GEN)
    expect(report.verdict).toBe("BLOCK")
  })

  it("a drifted UNKNOWN surface never collapses to SAFE", () => {
    const approved = approve([decision("a.json", "sha256:1", "REVIEW")])
    const current = [decision("a.json", "sha256:CHANGED", "UNKNOWN")]
    const report = verifyApproved(current, approved, GEN)
    expect(report.verdict).toBe("UNKNOWN")
    expect(report.drifted).toBe(true)
  })

  it("detects a verdict-only change at the same hash", () => {
    const approved = approve([decision("a.json", "sha256:1", "SAFE")])
    const current = [decision("a.json", "sha256:1", "REVIEW")]
    const report = verifyApproved(current, approved, GEN)
    expect(report.entries[0]!.status).toBe("verdict-changed")
    expect(report.drifted).toBe(true)
  })

  it("flags a new surface as added", () => {
    const approved = approve([decision("a.json", "sha256:1")])
    const current = [decision("a.json", "sha256:1"), decision("new.json", "sha256:9")]
    const report = verifyApproved(current, approved, GEN)
    const added = report.entries.find((e) => e.surface === "new.json")
    expect(added?.status).toBe("added")
    expect(report.drifted).toBe(true)
  })

  it("flags a removed surface", () => {
    const approved = approve([decision("a.json", "sha256:1"), decision("gone.json", "sha256:2")])
    const current = [decision("a.json", "sha256:1")]
    const report = verifyApproved(current, approved, GEN)
    const removed = report.entries.find((e) => e.surface === "gone.json")
    expect(removed?.status).toBe("removed")
    expect(report.drifted).toBe(true)
  })

  it("carries the schema version and generatedAt", () => {
    const report = verifyApproved([], approve([]), GEN)
    expect(report.schemaVersion).toBe("calllint.approveddrift.v0")
    expect(report.generatedAt).toBe(GEN)
  })
})
