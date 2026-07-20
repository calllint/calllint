/**
 * new11 PR-04 — tier defaults + anonymous installation id contract.
 */
import { describe, it, expect } from "vitest"
import {
  TIER_POLICY,
  isEnabledByDefault,
  SOURCES,
  makeInstallationId,
  isValidInstallationId,
  assertNotFingerprint,
  INSTALLATION_ID_PREFIX,
} from "../src/index.js"

describe("tier policy (ADR 0049 §2.6)", () => {
  it("local CLI is the ONLY default-off tier and requires notice", () => {
    expect(isEnabledByDefault("cli")).toBe(false)
    expect(TIER_POLICY.cli.requiresNotice).toBe(true)
  })

  it("server / install / ci are on by default", () => {
    expect(isEnabledByDefault("server")).toBe(true)
    expect(isEnabledByDefault("install")).toBe(true)
    expect(isEnabledByDefault("ci")).toBe(true)
  })

  it("ci is on-by-default but carries a documented notice", () => {
    expect(TIER_POLICY.ci.defaultEnabled).toBe(true)
    expect(TIER_POLICY.ci.requiresNotice).toBe(true)
  })

  it("every source has a policy with a rationale", () => {
    for (const s of SOURCES) {
      expect(TIER_POLICY[s]).toBeDefined()
      expect(TIER_POLICY[s].rationale.length).toBeGreaterThan(0)
    }
  })
})

describe("anonymousInstallationId contract", () => {
  const uuid = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"

  it("builds a prefixed, resettable id from an injected random UUID", () => {
    const id = makeInstallationId(uuid)
    expect(id).toBe(`${INSTALLATION_ID_PREFIX}${uuid}`)
    expect(isValidInstallationId(id)).toBe(true)
  })

  it("rejects a non-UUID seed (no ambient/derived entropy)", () => {
    expect(() => makeInstallationId("not-a-uuid")).toThrow(/UUID/)
  })

  it("assertNotFingerprint blocks a hardware/capability-style id", () => {
    expect(() => assertNotFingerprint("a1b2c3d4e5f6")).toThrow(/fingerprint/)
    expect(() => assertNotFingerprint(makeInstallationId(uuid))).not.toThrow()
  })

  it("two installs produce different ids (resettable / non-cross-product)", () => {
    const a = makeInstallationId("11111111-1111-4111-8111-111111111111")
    const b = makeInstallationId("22222222-2222-4222-8222-222222222222")
    expect(a).not.toBe(b)
  })
})
