import { describe, it, expect } from "vitest"
import { verifyPlanDigest, validatePlan } from "../src/index.js"
import { cursorAdapter, cursorServerEntry, CURSOR_HOST_ID } from "../src/index.js"
import type { PlanContext, PlanUpstream } from "../src/index.js"
import type { AuthorityManifest, TrustDecision } from "@calllint/types"

/**
 * Cursor host adapter (C5 — Tier B, plan-only). Mirrors the G5 plan invariants
 * proven for Claude Code (ADR 0036/0037), plus the Tier-B safety property:
 *  - plan is sealed + digest-verifiable, bound to the upstream chain
 *  - same inputs ⇒ byte-identical plan; plan change ⇒ digest change
 *  - env values are never carried from the source (keys only)
 *  - TIER B: the adapter declares NO applyPlan → the type system forbids writing
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
    host: CURSOR_HOST_ID,
    tier: "A",
    configPath: ".cursor/mcp.json",
    configDigest: CFG_D,
    currentConfig: { mcpServers: {} },
    servers: [{ name: "demo", entry: { command: "node", args: ["s.js"] } }],
    backupPath: ".cursor/mcp.json.calllint-backup",
    expiresAt: "2026-07-16T01:00:00.000Z",
    ...over,
  }
}

describe("cursorAdapter — Tier B plan-only (C5)", () => {
  it("is registered as a Tier-A host that ships a writer (promoted from B)", () => {
    expect(cursorAdapter.id).toBe("cursor")
    expect(cursorAdapter.tier).toBe("A")
    // Promoted to Tier A: it now declares applyPlan (delegates to the audited engine).
    expect(typeof cursorAdapter.applyPlan).toBe("function")
  })

  it("createPlan assembles a sealed, digest-verifiable plan bound to the upstream chain", () => {
    const plan = cursorAdapter.createPlan(ctx(), upstream)
    expect(plan.schema).toBe("calllint.install-plan.v1")
    expect(plan.host).toBe("cursor")
    expect(plan.tier).toBe("A")
    expect(plan.artifactDigest).toBe(A)
    expect(plan.authorityDigest).toBe(AUTH_D)
    expect(plan.decisionDigest).toBe(DEC_D)
    expect(plan.policyDigest).toBe(POL_D)
    expect(verifyPlanDigest(plan)).toBe(true)
    expect(cursorAdapter.validatePlan(plan).ok).toBe(true)
  })

  it("is deterministic — same inputs yield byte-identical plans", () => {
    expect(JSON.stringify(cursorAdapter.createPlan(ctx(), upstream))).toBe(
      JSON.stringify(cursorAdapter.createPlan(ctx(), upstream)),
    )
  })

  it("plan change ⇒ digest change (add a server)", () => {
    const one = cursorAdapter.createPlan(ctx(), upstream)
    const two = cursorAdapter.createPlan(
      ctx({ servers: [...ctx().servers, { name: "extra", entry: { url: "https://x" } }] }),
      upstream,
    )
    expect(two.planDigest).not.toBe(one.planDigest)
  })

  it("tamper is detected: mutating an op breaks verifyPlanDigest", () => {
    const plan = cursorAdapter.createPlan(ctx(), upstream)
    expect(verifyPlanDigest({ ...plan, operations: [] })).toBe(false)
  })
})

describe("cursorServerEntry — known-schema, env keys only", () => {
  it("keeps command/args and reconstructs env from keys with empty values", () => {
    const entry = cursorServerEntry({
      command: "node",
      args: ["srv.js"],
      envKeys: ["GITHUB_TOKEN", "API_KEY"],
    })
    expect(entry["command"]).toBe("node")
    expect(entry["args"]).toEqual(["srv.js"])
    // keys sorted, values BLANK — a scanned secret value is never written.
    expect(entry["env"]).toEqual({ API_KEY: "", GITHUB_TOKEN: "" })
  })

  it("a url server stores url (not command/args)", () => {
    const entry = cursorServerEntry({ url: "https://api.example.com/mcp" })
    expect(entry["url"]).toBe("https://api.example.com/mcp")
    expect(entry["command"]).toBeUndefined()
    expect(entry["args"]).toBeUndefined()
  })

  it("never carries a raw value — no env when there are no keys", () => {
    const entry = cursorServerEntry({ command: "node", args: [] })
    expect(entry["env"]).toBeUndefined()
  })
})
