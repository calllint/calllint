import { describe, it, expect } from "vitest"
import { classifyReceiptDrift } from "../src/index.js"
import type { DecisionReceipt, ReceiptDriftInput } from "@calllint/types"

/**
 * Locks the G7 gateway drift taxonomy (ADR 0039 §4): 9 signals → 4 change
 * classes {artifact, authority, evidence, policy} + the `expired` integrity
 * flag. classifyReceiptDrift is PURE — it compares a receipt against a snapshot
 * of freshly-computed digests, does no I/O, and reports every fired signal.
 */

const S = (c: string) => ("sha256:" + c.repeat(64)) as `sha256:${string}`
const NOW = "2026-07-13T00:30:00.000Z"

const receipt: DecisionReceipt = {
  schema: "calllint.receipt.v1",
  receiptId: "clrec_test",
  artifactDigest: S("a"),
  evidenceDigests: [S("b"), S("f")],
  authorityDigest: S("c"),
  policyDigest: S("e"),
  decisionDigest: S("d"),
  installPlanDigest: S("1"),
  approval: { type: "local-human", approvedAt: "2026-07-13T00:00:00.000Z", approver: "alice", approvedDigest: S("1") },
  result: "applied",
  host: "claude-code",
  configPath: "/home/u/.claude.json",
  configDigestBefore: S("7"),
  configDigestAfter: S("8"),
  policyVersion: "p1",
  scannerVersion: "1.3.0",
  exceptionReason: null,
  expiration: "2026-07-13T01:00:00.000Z",
  supersedes: null,
  revocation: null,
  signature: null,
}

/** A snapshot that matches the receipt exactly ⇒ no drift. */
function matching(): ReceiptDriftInput {
  return {
    artifactDigest: S("a"),
    configDigest: S("8"),
    permissionDigest: S("c"),
    authorityDigest: S("c"),
    evidenceDigests: [S("b"), S("f")],
    policyDigest: S("e"),
    policyVersion: "p1",
    scannerVersion: "1.3.0",
    now: NOW,
  }
}

describe("classifyReceiptDrift — no drift", () => {
  it("reports no drift when the snapshot matches the receipt", () => {
    const d = classifyReceiptDrift(receipt, matching())
    expect(d.drifted).toBe(false)
    expect(d.classes).toEqual([])
    expect(d.changes).toEqual([])
    expect(d.expired).toBe(false)
    expect(d.schema).toBe("calllint.receipt-drift.v1")
  })

  it("never reports drift for a field left undefined (missing data is not drift)", () => {
    const d = classifyReceiptDrift(receipt, { now: NOW })
    expect(d.drifted).toBe(false)
  })
})

describe("classifyReceiptDrift — each signal maps to its class", () => {
  const cases: Array<[string, Partial<ReceiptDriftInput>, string, string]> = [
    ["artifact", { artifactDigest: S("9") }, "artifact", "artifact"],
    ["config", { configDigest: S("9") }, "config", "artifact"],
    ["permission", { permissionDigest: S("9") }, "permission", "authority"],
    ["authority", { authorityDigest: S("9") }, "authority", "authority"],
    ["evidence", { evidenceDigests: [S("b")] }, "evidence", "evidence"],
    ["policy (digest)", { policyDigest: S("9") }, "policy", "policy"],
    ["scanner-version", { scannerVersion: "1.2.9" }, "scanner-version", "policy"],
  ]
  for (const [name, over, signal, klass] of cases) {
    it(`${name} drift → signal ${signal}, class ${klass}`, () => {
      const d = classifyReceiptDrift(receipt, { ...matching(), ...over })
      expect(d.drifted).toBe(true)
      const c = d.changes.find((x) => x.signal === signal)
      expect(c, `expected a ${signal} change`).toBeDefined()
      expect(c!.class).toBe(klass)
      expect(d.classes).toContain(klass)
    })
  }

  it("policy-version drift fires when digest matches but version differs", () => {
    const d = classifyReceiptDrift(receipt, { ...matching(), policyVersion: "p2" })
    const c = d.changes.find((x) => x.signal === "policy")
    expect(c).toBeDefined()
    expect(c!.was).toBe("p1")
    expect(c!.now).toBe("p2")
  })

  it("evidence-expiry fires when attached evidence is past its expiry", () => {
    const d = classifyReceiptDrift(receipt, { ...matching(), evidenceExpiresAt: "2026-07-13T00:15:00.000Z" })
    const c = d.changes.find((x) => x.signal === "evidence-expiry")
    expect(c).toBeDefined()
    expect(c!.class).toBe("evidence")
  })
})

describe("classifyReceiptDrift — integrity + multi-class", () => {
  it("flags expired when now is past the receipt expiration", () => {
    const d = classifyReceiptDrift(receipt, { ...matching(), now: "2026-07-13T02:00:00.000Z" })
    expect(d.expired).toBe(true)
  })

  it("collects distinct classes, sorted, when several signals fire", () => {
    const d = classifyReceiptDrift(receipt, {
      ...matching(),
      artifactDigest: S("9"), // artifact
      authorityDigest: S("9"), // authority
      policyDigest: S("9"), // policy
    })
    expect(d.classes).toEqual(["artifact", "authority", "policy"])
    expect(d.drifted).toBe(true)
  })

  it("is pure — same inputs give the same report", () => {
    const input = { ...matching(), artifactDigest: S("9") }
    expect(JSON.stringify(classifyReceiptDrift(receipt, input))).toBe(
      JSON.stringify(classifyReceiptDrift(receipt, input)),
    )
  })
})
