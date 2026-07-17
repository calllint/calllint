/**
 * I2c-3 — the Partner API envelope surfaces the baked maintainer-claim overlay
 * (ADR 0048 §2/§6) verbatim, and ONLY when the sidecar carries a well-formed one.
 * The overlay is namespace control, never safety; its absence never implies unsafe.
 */
import { describe, it, expect } from "vitest"
import { toEnvelope } from "../src/lookup.js"

const base = {
  canonicalName: "mcp-registry/x",
  artifactDigest: "sha256:aa",
  pageDigest: "sha256:bb",
  verdict: "REVIEW",
  verdictLabel: "Review required",
  observedAt: "2026-07-17T00:00:00.000Z",
  completeness: "partial",
  correctionUrl: "https://example/correct",
}

describe("toEnvelope — verifiedPublisher overlay", () => {
  it("omits verifiedPublisher entirely when the sidecar has none", () => {
    const env = toEnvelope("resource", base, base)
    expect("verifiedPublisher" in env).toBe(false)
  })

  it("surfaces a well-formed publisher verbatim", () => {
    const sidecar = {
      ...base,
      verifiedPublisher: { owner: "octo-org", verifiedAt: "2026-07-17T00:00:00.000Z", observedArtifactDigest: "sha256:cc" },
    }
    const env = toEnvelope("resource", sidecar, sidecar)
    expect(env.verifiedPublisher).toEqual({
      owner: "octo-org",
      verifiedAt: "2026-07-17T00:00:00.000Z",
      observedArtifactDigest: "sha256:cc",
    })
  })

  it("drops a malformed publisher (no owner) — never a half-populated claim", () => {
    const sidecar = { ...base, verifiedPublisher: { verifiedAt: "t" } }
    expect("verifiedPublisher" in toEnvelope("resource", sidecar, sidecar)).toBe(false)
  })

  it("drops a publisher with an empty owner", () => {
    const sidecar = { ...base, verifiedPublisher: { owner: "" } }
    expect("verifiedPublisher" in toEnvelope("resource", sidecar, sidecar)).toBe(false)
  })
})
