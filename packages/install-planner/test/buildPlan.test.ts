import { describe, it, expect } from "vitest"
import { buildInstallPlan, buildServerOps, verifyPlanDigest, validatePlan } from "../src/index.js"
import { claudeCodeAdapter, claudeCodeServerEntry } from "../src/index.js"
import type { PlanContext, PlanUpstream } from "../src/index.js"
import type { AuthorityManifest, TrustDecision } from "@calllint/types"

/**
 * Locks the G5 plan invariants (ADR 0036/0037):
 *  - plan change ⇒ digest change; same inputs ⇒ byte-identical plan
 *  - every operation is typed json-patch with a preconditionDigest
 *  - new server rolls back with remove; replaced server rolls back to prior value
 *  - env values are never carried from the source (keys only)
 */

const A = ("sha256:" + "a".repeat(64)) as `sha256:${string}`
const AUTH_D = ("sha256:" + "c".repeat(64)) as `sha256:${string}`
const DEC_D = ("sha256:" + "d".repeat(64)) as `sha256:${string}`
const POL_D = ("sha256:" + "e".repeat(64)) as `sha256:${string}`
const CFG_D = ("sha256:" + "f".repeat(64)) as `sha256:${string}`

const authority = { digest: AUTH_D } as AuthorityManifest
const decision = { digest: DEC_D, policyDigest: POL_D, verdict: "SAFE" } as TrustDecision
const upstream: PlanUpstream = { artifactDigest: A, authority, decision }

function ctx(over: Partial<PlanContext> = {}): PlanContext {
  return {
    host: "claude-code",
    tier: "B",
    configPath: "~/.claude.json",
    configDigest: CFG_D,
    currentConfig: { mcpServers: {} },
    servers: [{ name: "demo", entry: { command: "node", args: ["s.js"] } }],
    backupPath: "~/.claude.json.calllint-backup",
    expiresAt: "2026-07-13T01:00:00.000Z",
    ...over,
  }
}

describe("buildInstallPlan (G5)", () => {
  it("assembles a sealed, digest-verifiable plan bound to the upstream chain", () => {
    const plan = buildInstallPlan(ctx(), upstream)
    expect(plan.schema).toBe("calllint.install-plan.v1")
    expect(plan.artifactDigest).toBe(A)
    expect(plan.authorityDigest).toBe(AUTH_D)
    expect(plan.decisionDigest).toBe(DEC_D)
    expect(plan.policyDigest).toBe(POL_D)
    expect(verifyPlanDigest(plan)).toBe(true)
    expect(validatePlan(plan).ok).toBe(true)
  })

  it("is deterministic — same inputs yield byte-identical plans", () => {
    expect(JSON.stringify(buildInstallPlan(ctx(), upstream))).toBe(
      JSON.stringify(buildInstallPlan(ctx(), upstream)),
    )
  })

  it("plan change ⇒ digest change (add a server)", () => {
    const one = buildInstallPlan(ctx(), upstream)
    const two = buildInstallPlan(
      ctx({ servers: [...ctx().servers, { name: "extra", entry: { url: "https://x" } }] }),
      upstream,
    )
    expect(two.planDigest).not.toBe(one.planDigest)
  })

  it("tamper is detected: mutating an op breaks verifyPlanDigest", () => {
    const plan = buildInstallPlan(ctx(), upstream)
    const tampered = { ...plan, operations: [] }
    expect(verifyPlanDigest(tampered)).toBe(false)
  })
})

describe("buildServerOps rollback correctness", () => {
  it("new server (existing container) → rollback removes it", () => {
    const { rollback } = buildServerOps(ctx({ currentConfig: { mcpServers: {} } }))
    expect(rollback[0]!.patch.some((p) => p.op === "remove" && p.path === "/mcpServers/demo")).toBe(true)
  })

  it("replaced server → rollback restores prior value", () => {
    const prior = { command: "old" }
    const { rollback } = buildServerOps(ctx({ currentConfig: { mcpServers: { demo: prior } } }))
    const restore = rollback[0]!.patch.find((p) => p.op === "replace" && p.path === "/mcpServers/demo")
    expect(restore?.value).toEqual(prior)
  })

  it("absent config → forward creates the container, rollback removes it", () => {
    const { operations, rollback } = buildServerOps(
      ctx({ currentConfig: null, configDigest: "absent" }),
    )
    expect(operations[0]!.patch[0]).toEqual({ op: "add", path: "/mcpServers", value: {} })
    expect(rollback[0]!.patch.some((p) => p.op === "remove" && p.path === "/mcpServers")).toBe(true)
    expect(operations[0]!.preconditionDigest).toBe("absent")
  })
})

describe("claudeCodeServerEntry (known-schema, no secret carry)", () => {
  it("stdio server → command+args; env keys only, values blanked", () => {
    const e = claudeCodeServerEntry({ command: "node", args: ["s.js"], envKeys: ["API_KEY", "TOKEN"] })
    expect(e).toEqual({ command: "node", args: ["s.js"], env: { API_KEY: "", TOKEN: "" } })
  })
  it("remote server → url only", () => {
    expect(claudeCodeServerEntry({ url: "https://mcp.example" })).toEqual({ url: "https://mcp.example" })
  })
})

describe("adapter registry", () => {
  it("claude-code adapter is Tier B and validates its own plan", () => {
    expect(claudeCodeAdapter.tier).toBe("B")
    const plan = claudeCodeAdapter.createPlan(ctx(), upstream)
    expect(claudeCodeAdapter.validatePlan(plan).ok).toBe(true)
    expect(plan.host).toBe("claude-code")
  })
})
