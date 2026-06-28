import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import {
  defaultPolicy,
  validatePolicy,
  PolicyValidationError,
  applyPolicy,
  shouldFailCi,
} from "../src/index.js"
import type { Finding, Policy } from "@calllint/types"

const FUTURE = "2999-01-01T00:00:00Z"
const PAST = "2000-01-01T00:00:00Z"
const NOW = Date.parse("2026-06-01T00:00:00Z")

// packages/policy/test → up three → repo root → examples/policies
const examplesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "examples", "policies")


function blocker(symbol: Finding["symbol"]): Finding {
  return {
    id: "b",
    title: "b",
    severity: "critical",
    blocker: true,
    symbol,
    riskClass: "S2",
    mode: "OBSERVED",
    confidence: "high",
    detectionMethod: "config-analysis",
    evidence: [],
    impact: "",
    fix: "",
  }
}

describe("default policy", () => {
  it("validates", () => {
    expect(() => validatePolicy(defaultPolicy())).not.toThrow()
  })
  it("CI fails on BLOCK and UNKNOWN by default", () => {
    const p = defaultPolicy()
    expect(shouldFailCi("BLOCK", p)).toBe(true)
    expect(shouldFailCi("UNKNOWN", p)).toBe(true)
    expect(shouldFailCi("REVIEW", p)).toBe(false)
    expect(shouldFailCi("SAFE", p)).toBe(false)
  })
})

describe("policy validation", () => {
  it("rejects override without reason", () => {
    const p = { ...defaultPolicy(), overrides: [{ target: "x", expiresAt: FUTURE }] }
    expect(() => validatePolicy(p)).toThrow(PolicyValidationError)
  })
  it("rejects override without expiry", () => {
    const p = { ...defaultPolicy(), overrides: [{ target: "x", reason: "r" }] }
    expect(() => validatePolicy(p)).toThrow(PolicyValidationError)
  })
  it("rejects EXEC allow without dangerousOverride", () => {
    const p = {
      ...defaultPolicy(),
      overrides: [{ target: "x", reason: "r", expiresAt: FUTURE, allow: ["EXEC"] }],
    }
    expect(() => validatePolicy(p)).toThrow(PolicyValidationError)
  })
  it("accepts EXEC allow with dangerousOverride", () => {
    const p = {
      ...defaultPolicy(),
      overrides: [
        { target: "x", reason: "r", expiresAt: FUTURE, allow: ["EXEC"], dangerousOverride: true },
      ],
    }
    expect(() => validatePolicy(p)).not.toThrow()
  })
})

describe("applyPolicy", () => {
  function policyWithOverride(allow: string[], expiresAt = FUTURE): Policy {
    return {
      ...defaultPolicy(),
      overrides: [
        { target: "fs", reason: "local only", expiresAt, allow: allow as never[] },
      ],
    }
  }

  it("downgrades BLOCK to REVIEW when override covers all blocking symbols", () => {
    const d = applyPolicy("BLOCK", "fs", [blocker("FILES")], policyWithOverride(["FILES"]), NOW)
    expect(d.verdict).toBe("REVIEW")
    expect(d.changed).toBe(true)
    expect(d.note).toMatch(/Policy decision/)
  })

  it("does not downgrade when override misses a blocking symbol", () => {
    const d = applyPolicy(
      "BLOCK",
      "fs",
      [blocker("FILES"), blocker("EXEC")],
      policyWithOverride(["FILES"]),
      NOW,
    )
    expect(d.verdict).toBe("BLOCK")
    expect(d.changed).toBe(false)
  })

  it("ignores expired overrides", () => {
    const d = applyPolicy("BLOCK", "fs", [blocker("FILES")], policyWithOverride(["FILES"], PAST), NOW)
    expect(d.verdict).toBe("BLOCK")
  })

  it("never downgrades UNKNOWN", () => {
    const d = applyPolicy("UNKNOWN", "fs", [], policyWithOverride(["FILES"]), NOW)
    expect(d.verdict).toBe("UNKNOWN")
    expect(d.changed).toBe(false)
  })
})

describe("shipped example policies (docs/policy.md, S5)", () => {
  const files = readdirSync(examplesDir).filter((f) => f.endsWith(".json"))

  it("there is at least one example policy", () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    it(`examples/policies/${file} is valid calllint.policy.v0`, () => {
      const parsed = JSON.parse(readFileSync(join(examplesDir, file), "utf8"))
      expect(() => validatePolicy(parsed)).not.toThrow()
    })
  }
})
