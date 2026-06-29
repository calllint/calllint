import { describe, it, expect } from "vitest"
import { renderCiGate, CI_GATE_MODES } from "../src/distribution/ciGate.js"

describe("renderCiGate", () => {
  it("drift mode emits a verify --approved --ci gate", () => {
    const out = renderCiGate({ mode: "drift" })
    expect(out).toContain("name: calllint")
    expect(out).toContain("on:")
    expect(out).toContain("pull_request:")
    expect(out).toContain("verify --approved --ci")
    expect(out).toContain("permissions:")
    expect(out).toContain("contents: read")
  })

  it("scan-all mode is report-only (never gates, no verify)", () => {
    const out = renderCiGate({ mode: "scan-all" })
    expect(out).toContain("scan-all")
    expect(out).not.toContain("verify --approved")
  })

  it("defaults to drift mode", () => {
    expect(renderCiGate()).toBe(renderCiGate({ mode: "drift" }))
  })

  it("uses npx so consumer repos need no install", () => {
    expect(renderCiGate()).toContain("npx -y calllint")
  })

  it("declares the static / never-executes guarantee in a comment", () => {
    expect(renderCiGate()).toMatch(/never executes a scanned server/i)
  })

  it("exposes exactly the two supported modes", () => {
    expect([...CI_GATE_MODES]).toEqual(["drift", "scan-all"])
  })
})
