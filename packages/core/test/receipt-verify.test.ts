import { describe, it, expect } from "vitest"
import { scanConfigText, createReceipt, verifyReceipt } from "../src/index.js"
import type { CallLintReceipt } from "../src/receipt/index.js"

const OPTS = { now: Date.parse("2026-06-01T00:00:00Z"), generatedAt: "2026-06-01T00:00:00.000Z" }
const NOW = "2026-06-01T00:00:00.000Z"

/** A structurally valid receipt built from a real scan. */
function validReceipt(): CallLintReceipt {
  const text = JSON.stringify({
    mcpServers: { fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/"] } },
  })
  const summary = scanConfigText(text, "<inline>", OPTS)
  return createReceipt(
    {
      toolVersion: "0.8.0",
      subject: { type: "scan", target: "<inline>" },
      inputForHash: text,
      effectivePolicyForHash: { policy: "default" },
      scanReport: summary,
      rulesetForHash: { tool: "calllint", version: "0.8.0" },
    },
    NOW,
  )
}

/** Deep-clone so each mutation test starts from a pristine valid receipt. */
function clone(r: CallLintReceipt): CallLintReceipt {
  return JSON.parse(JSON.stringify(r))
}

describe("verifyReceipt — structural validation only", () => {
  it("accepts a valid unsigned local receipt", () => {
    const res = verifyReceipt(validReceipt())
    expect(res.valid).toBe(true)
    expect(res.errors).toEqual([])
    expect(res.signed).toBe(false)
  })

  it("rejects a non-object", () => {
    expect(verifyReceipt("nope").valid).toBe(false)
    expect(verifyReceipt(null).valid).toBe(false)
    expect(verifyReceipt([]).valid).toBe(false)
  })

  it("rejects a bad schema_version", () => {
    const r = clone(validReceipt())
    ;(r as unknown as Record<string, unknown>).schema_version = "calllint.receipt.v1"
    const res = verifyReceipt(r)
    expect(res.valid).toBe(false)
    expect(res.errors.some((e) => e.includes("schema_version"))).toBe(true)
  })

  it("rejects a malformed receipt_id", () => {
    const r = clone(validReceipt())
    r.receipt_id = "not-a-receipt-id"
    expect(verifyReceipt(r).valid).toBe(false)
  })

  it("rejects a bad hash format", () => {
    const r = clone(validReceipt())
    ;(r.hashes as Record<string, unknown>).report_hash = "sha256:tooshort"
    const res = verifyReceipt(r)
    expect(res.valid).toBe(false)
    expect(res.errors.some((e) => e.includes("report_hash"))).toBe(true)
  })

  it("rejects missing required fields", () => {
    const r = clone(validReceipt()) as unknown as Record<string, unknown>
    delete r.hashes
    expect(verifyReceipt(r).valid).toBe(false)
  })

  it("rejects negative or non-integer risk counts", () => {
    const neg = clone(validReceipt())
    neg.risk_counts.block = -1
    expect(verifyReceipt(neg).valid).toBe(false)

    const frac = clone(validReceipt())
    ;(frac.risk_counts as Record<string, unknown>).review = 1.5
    expect(verifyReceipt(frac).valid).toBe(false)
  })

  it("rejects a violated trust-boundary invariant", () => {
    const r = clone(validReceipt())
    ;(r.trust_boundaries as Record<string, unknown>).executed_target = true
    const res = verifyReceipt(r)
    expect(res.valid).toBe(false)
    expect(res.errors.some((e) => e.includes("executed_target"))).toBe(true)
  })

  it("rejects an invalid verdict token", () => {
    const r = clone(validReceipt())
    ;(r as unknown as Record<string, unknown>).verdict = "TOTALLY_SAFE"
    expect(verifyReceipt(r).valid).toBe(false)
  })

  it("shape-checks a reserved signature when present (never crypto-verifies)", () => {
    const good = clone(validReceipt())
    good.signature = { algorithm: "ed25519", key_id: "future", value: "future" }
    const okRes = verifyReceipt(good)
    expect(okRes.valid).toBe(true)
    expect(okRes.signed).toBe(true)

    const bad = clone(validReceipt())
    ;(bad as unknown as Record<string, unknown>).signature = { algorithm: "ed25519" }
    const badRes = verifyReceipt(bad)
    expect(badRes.valid).toBe(false)
    expect(badRes.signed).toBe(true)
  })
})
