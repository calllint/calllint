import { describe, it, expect } from "vitest"
import type { ApprovedDriftReport } from "@calllint/types"
import { renderApprovedDrift, renderApprovedDriftJson } from "../src/renderApprovedDrift.js"

const clean: ApprovedDriftReport = {
  schemaVersion: "calllint.approveddrift.v0",
  drifted: false,
  verdict: "SAFE",
  entries: [
    { surface: "a.json", status: "unchanged", approvedHash: "sha256:1", currentHash: "sha256:1" },
  ],
  generatedAt: "2026-06-29T00:00:00.000Z",
}

const drifted: ApprovedDriftReport = {
  schemaVersion: "calllint.approveddrift.v0",
  drifted: true,
  verdict: "REVIEW",
  entries: [
    {
      surface: "a.json",
      status: "hash-changed",
      approvedHash: "sha256:1",
      currentHash: "sha256:2",
      approvedVerdict: "REVIEW",
      currentVerdict: "REVIEW",
    },
  ],
  generatedAt: "2026-06-29T00:00:00.000Z",
}

describe("renderApprovedDrift", () => {
  it("renders a no-drift headline for a clean report", () => {
    const out = renderApprovedDrift(clean)
    expect(out).toContain("no drift")
    expect(out).not.toContain("DRIFT —")
  })

  it("renders a DRIFT headline carrying the verdict, never SAFE", () => {
    const out = renderApprovedDrift(drifted)
    expect(out).toContain("DRIFT")
    expect(out).toContain("REVIEW")
    expect(out).toContain("sha256:1 → sha256:2")
  })

  it("stays compact (short, plain text)", () => {
    const out = renderApprovedDrift(drifted)
    expect(out.split("\n").length).toBeLessThanOrEqual(30)
  })

  it("renderApprovedDriftJson is the stable JSON contract", () => {
    expect(JSON.parse(renderApprovedDriftJson(drifted))).toEqual(drifted)
  })
})
