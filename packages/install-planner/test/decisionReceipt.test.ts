import { describe, it, expect } from "vitest"
import { hashJson } from "@calllint/fingerprint"
import { generateKeypair, exportKeypair } from "@calllint/signature"
import {
  buildDecisionReceipt,
  signDecisionReceipt,
  verifyDecisionReceipt,
  receiptBodyDigest,
  buildInstallPlan,
  type InstallPlan,
  type PlanContext,
  type PlanUpstream,
  type ReceiptContext,
} from "../src/index.js"
import type { ApplyResult, AuthorityManifest, TrustDecision } from "@calllint/types"

/**
 * Locks the G7 decision receipt (calllint.receipt.v1, ADR 0039): a deterministic
 * builder, provenance binding (approvedDigest == installPlanDigest), tamper +
 * expiry detection, and an optional ed25519 sign/verify roundtrip that reuses
 * @calllint/signature. verify is proven read-only (returns a verdict, writes
 * nothing).
 */

const APPROVED = "2026-07-13T00:00:00.000Z"
const NOW_OK = "2026-07-13T00:30:00.000Z" // within 1h validity
const NOW_EXPIRED = "2026-07-13T02:00:00.000Z" // past expiry

const authority = { digest: "sha256:" + "c".repeat(64) } as AuthorityManifest
const decision = {
  digest: "sha256:" + "d".repeat(64),
  policyDigest: "sha256:" + "e".repeat(64),
  verdict: "SAFE",
} as TrustDecision
const upstream: PlanUpstream = {
  artifactDigest: "sha256:" + "a".repeat(64),
  authority,
  decision,
}

function planFixture(): InstallPlan {
  const bytes = JSON.stringify({ mcpServers: {} }, null, 2) + "\n"
  const ctx: PlanContext = {
    host: "claude-code",
    tier: "A",
    configPath: "/home/u/.claude.json",
    configDigest: hashJson(bytes) as `sha256:${string}`,
    currentConfig: JSON.parse(bytes),
    servers: [{ name: "demo", entry: { command: "node", args: ["s.js"] } }],
    backupPath: "/home/u/.claude.json.calllint-backup-x",
    expiresAt: "2026-07-13T01:00:00.000Z",
  }
  return buildInstallPlan(ctx, upstream)
}

function applyResultFor(plan: InstallPlan): ApplyResult {
  return {
    schema: "calllint.apply-result.v1",
    state: "VERIFIED",
    outcome: "applied",
    planId: plan.planId,
    planDigest: plan.planDigest,
    host: plan.host,
    configPath: plan.operations[0]!.target,
    configDigestBefore: ("sha256:" + "1".repeat(64)) as `sha256:${string}`,
    configDigestAfter: ("sha256:" + "2".repeat(64)) as `sha256:${string}`,
    backupPath: plan.backup.path,
    rolledBack: false,
    notes: ["applied + verified"],
    appliedAt: APPROVED,
  }
}

const ctx: ReceiptContext = {
  approvedAt: APPROVED,
  approver: "alice",
  scannerVersion: "1.3.0",
  evidenceDigests: [("sha256:" + "f".repeat(64)) as `sha256:${string}`, ("sha256:" + "b".repeat(64)) as `sha256:${string}`],
  policyVersion: "policy-2026h2",
}

describe("buildDecisionReceipt — deterministic + provenance-bound", () => {
  it("binds all six digests from the plan and the approval to the plan digest", () => {
    const plan = planFixture()
    const r = buildDecisionReceipt(applyResultFor(plan), plan, ctx)
    expect(r.schema).toBe("calllint.receipt.v1")
    expect(r.artifactDigest).toBe(plan.artifactDigest)
    expect(r.authorityDigest).toBe(plan.authorityDigest)
    expect(r.decisionDigest).toBe(plan.decisionDigest)
    expect(r.policyDigest).toBe(plan.policyDigest)
    expect(r.installPlanDigest).toBe(plan.planDigest)
    expect(r.approval.approvedDigest).toBe(plan.planDigest) // binding
    expect(r.result).toBe("applied")
    expect(r.expiration).toBe(plan.expiresAt)
  })

  it("is byte-identical on repeat (no Date.now/random in the body)", () => {
    const plan = planFixture()
    const a = buildDecisionReceipt(applyResultFor(plan), plan, ctx)
    const b = buildDecisionReceipt(applyResultFor(plan), plan, ctx)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(a.receiptId).toBe(b.receiptId) // id derived, not random
  })

  it("sorts + dedupes evidence digests", () => {
    const plan = planFixture()
    const dup = { ...ctx, evidenceDigests: ["sha256:" + "f".repeat(64), "sha256:" + "b".repeat(64), "sha256:" + "f".repeat(64)] as `sha256:${string}`[] }
    const r = buildDecisionReceipt(applyResultFor(plan), plan, dup)
    expect(r.evidenceDigests).toEqual(["sha256:" + "b".repeat(64), "sha256:" + "f".repeat(64)])
  })

  it("maps rolled_back/stale outcomes to receipt result", () => {
    const plan = planFixture()
    const rb = buildDecisionReceipt({ ...applyResultFor(plan), outcome: "rolled_back" }, plan, ctx)
    expect(rb.result).toBe("rolled-back")
    const stale = buildDecisionReceipt({ ...applyResultFor(plan), outcome: "stale" }, plan, ctx)
    expect(stale.result).toBe("prepared-only")
    const already = buildDecisionReceipt({ ...applyResultFor(plan), outcome: "already_applied" }, plan, ctx)
    expect(already.result).toBe("applied")
  })
})

describe("verifyDecisionReceipt — structure, expiry, tamper", () => {
  it("accepts a well-formed receipt within its validity window", () => {
    const plan = planFixture()
    const r = buildDecisionReceipt(applyResultFor(plan), plan, ctx)
    const v = verifyDecisionReceipt(r, { now: NOW_OK })
    expect(v.valid).toBe(true)
    expect(v.errors).toEqual([])
    expect(v.expired).toBe(false)
    expect(v.signed).toBe(false)
  })

  it("reports expiry without failing structural validity", () => {
    const plan = planFixture()
    const r = buildDecisionReceipt(applyResultFor(plan), plan, ctx)
    const v = verifyDecisionReceipt(r, { now: NOW_EXPIRED })
    expect(v.valid).toBe(true) // still a true record of a past approval
    expect(v.expired).toBe(true)
  })

  it("rejects a broken approval binding", () => {
    const plan = planFixture()
    const r = buildDecisionReceipt(applyResultFor(plan), plan, ctx)
    const tampered = { ...r, approval: { ...r.approval, approvedDigest: ("sha256:" + "9".repeat(64)) as `sha256:${string}` } }
    const v = verifyDecisionReceipt(tampered, { now: NOW_OK })
    expect(v.valid).toBe(false)
    expect(v.errors.some((e) => /approval binding/.test(e))).toBe(true)
  })

  it("rejects a non-object / wrong-schema input fail-closed", () => {
    expect(verifyDecisionReceipt(null, { now: NOW_OK }).valid).toBe(false)
    expect(verifyDecisionReceipt({ schema: "calllint.receipt.v0" }, { now: NOW_OK }).valid).toBe(false)
  })
})

describe("signDecisionReceipt + verify — ed25519 roundtrip", () => {
  it("signs and verifies with the matching public key", () => {
    const plan = planFixture()
    const kp = generateKeypair("test-key")
    const r = signDecisionReceipt(buildDecisionReceipt(applyResultFor(plan), plan, ctx), kp)
    const pub = exportKeypair(kp).public_key as string
    const v = verifyDecisionReceipt(r, { now: NOW_OK, publicKey: pub })
    expect(v.signed).toBe(true)
    expect(v.tampered).toBe(false)
    expect(v.valid).toBe(true)
  })

  it("detects a tampered body (signature no longer matches)", () => {
    const plan = planFixture()
    const kp = generateKeypair("test-key")
    const r = signDecisionReceipt(buildDecisionReceipt(applyResultFor(plan), plan, ctx), kp)
    const mutated = { ...r, host: "cursor" } // change a signed field
    const pub = exportKeypair(kp).public_key as string
    const v = verifyDecisionReceipt(mutated, { now: NOW_OK, publicKey: pub })
    expect(v.tampered).toBe(true)
    expect(v.valid).toBe(false)
  })

  it("signature covers body minus signature (bodyDigest stable across signing)", () => {
    const plan = planFixture()
    const unsigned = buildDecisionReceipt(applyResultFor(plan), plan, ctx)
    const kp = generateKeypair("test-key")
    const signed = signDecisionReceipt(unsigned, kp)
    expect(receiptBodyDigest(signed)).toBe(receiptBodyDigest(unsigned))
  })
})
