import { describe, it, expect } from "vitest"
import type { AuthorityCapability } from "@calllint/types"
import { classifyFlow } from "../src/index.js"

/**
 * Locks the CL-FLOW rule catalog (F3, ADR 0040). Every rule that can produce a BLOCK or
 * an ALLOW ships a PAIRED positive + negative case here (CallLint contract: no rule
 * without a positive AND negative fixture). The overarching invariant: no dangerous
 * composition ever resolves to ALLOW, and an unclassifiable source never reads as trusted
 * (I-04, and the ADR 0040 §4 dangerous-flow-never-SAFE gate).
 */

function cap(partial: Partial<AuthorityCapability>): AuthorityCapability {
  return {
    action: "read",
    resource: "filesystem",
    scope: null,
    destination: null,
    mutability: "read-only",
    reversibility: "n/a",
    monetaryLimit: null,
    approvalRequirement: "none",
    evidenceSource: "<test>",
    confidence: "high",
    completeness: "complete",
    ...partial,
  }
}

const secretSource = cap({ action: "read", resource: "secret", trustSource: "sensitive.secret" })
const publicSource = cap({ action: "read", resource: "filesystem", trustSource: "untrusted.public_content" })
const trustedSource = cap({ action: "read", resource: "filesystem", trustSource: "trusted.user_explicit" })

const netSinkPinned = cap({ action: "send", resource: "network", destination: "evil.example.com" })
const netSinkUnpinned = cap({ action: "send", resource: "network", destination: null })
const financialSink = cap({ action: "spend", resource: "financial" })
const messageSink = cap({ action: "send", resource: "message" })

describe("CL-FLOW-001 — untrusted/sensitive → external network (pinned dest) = BLOCK", () => {
  it("positive: secret → send×network with a concrete host is BLOCK/critical", () => {
    const o = classifyFlow(secretSource, netSinkPinned)
    expect(o.ruleId).toBe("CL-FLOW-001")
    expect(o.decisionHint).toBe("BLOCK")
    expect(o.riskClass).toBe("critical")
  })
  it("positive: injected public content → external network is also BLOCK", () => {
    expect(classifyFlow(publicSource, netSinkPinned).decisionHint).toBe("BLOCK")
  })
  it("negative: a TRUSTED source to the same pinned network sink is NOT BLOCK", () => {
    const o = classifyFlow(trustedSource, netSinkPinned)
    expect(o.decisionHint).not.toBe("BLOCK")
    expect(o.decisionHint).toBe("ALLOW")
  })
  it("negative: same untrusted source but NO pinned destination falls to CL-FLOW-003, not 001", () => {
    expect(classifyFlow(secretSource, netSinkUnpinned).ruleId).toBe("CL-FLOW-003")
  })
})

describe("CL-FLOW-002 — untrusted/sensitive → financial = BLOCK", () => {
  it("positive: secret → spend×financial is BLOCK/critical", () => {
    const o = classifyFlow(secretSource, financialSink)
    expect(o.ruleId).toBe("CL-FLOW-002")
    expect(o.decisionHint).toBe("BLOCK")
  })
  it("negative: a trusted source → financial is ALLOW, not BLOCK", () => {
    expect(classifyFlow(trustedSource, financialSink).decisionHint).toBe("ALLOW")
  })
})

describe("CL-FLOW-003 — untrusted/sensitive → network (no pinned dest) = REVIEW", () => {
  it("positive: secret → send×network with null destination is REVIEW/high", () => {
    const o = classifyFlow(secretSource, netSinkUnpinned)
    expect(o.ruleId).toBe("CL-FLOW-003")
    expect(o.decisionHint).toBe("REVIEW")
    expect(o.riskClass).toBe("high")
  })
  it("negative: WITH a pinned destination it escalates to BLOCK (CL-FLOW-001)", () => {
    expect(classifyFlow(secretSource, netSinkPinned).decisionHint).toBe("BLOCK")
  })
})

describe("CL-FLOW-004 — untrusted/sensitive → messaging = REVIEW", () => {
  it("positive: secret → send×message is REVIEW/high", () => {
    const o = classifyFlow(secretSource, messageSink)
    expect(o.ruleId).toBe("CL-FLOW-004")
    expect(o.decisionHint).toBe("REVIEW")
  })
  it("negative: a trusted source → messaging is ALLOW", () => {
    expect(classifyFlow(trustedSource, messageSink).decisionHint).toBe("ALLOW")
  })
})

describe("CL-FLOW-ALLOW-001 — trusted source → egress = ALLOW", () => {
  it("positive: trusted.user_explicit → send×network is ALLOW/none", () => {
    const o = classifyFlow(trustedSource, netSinkPinned)
    expect(o.ruleId).toBe("CL-FLOW-ALLOW-001")
    expect(o.decisionHint).toBe("ALLOW")
    expect(o.riskClass).toBe("none")
  })
  it("negative: an untrusted source to the same sink is NEVER ALLOW", () => {
    expect(classifyFlow(publicSource, netSinkPinned).decisionHint).not.toBe("ALLOW")
  })
})

describe("CL-FLOW-REVIEW-000 — fail-safe catch-all (dangerous-flow-never-SAFE, §4)", () => {
  it("a source whose trust is unknown never resolves to ALLOW", () => {
    // unknown trustSource shouldn't even reach classifyFlow via buildFlows, but the
    // classifier must still fail safe if handed one directly.
    const unknownSrc = cap({ action: "read", resource: "secret" }) // no trustSource
    const o = classifyFlow(unknownSrc, netSinkPinned)
    expect(o.decisionHint).not.toBe("ALLOW")
    expect(o.decisionHint).toBe("REVIEW")
    expect(o.ruleId).toBe("CL-FLOW-REVIEW-000")
  })
  it("is deterministic — same pair in, same outcome out", () => {
    expect(classifyFlow(secretSource, netSinkPinned)).toEqual(
      classifyFlow(secretSource, netSinkPinned),
    )
  })
})
