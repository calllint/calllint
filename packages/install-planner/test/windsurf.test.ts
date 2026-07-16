import { describe, it, expect } from "vitest"
import { verifyPlanDigest } from "../src/index.js"
import { windsurfAdapter, windsurfServerEntry, WINDSURF_HOST_ID } from "../src/index.js"
import type { PlanContext, PlanUpstream } from "../src/index.js"
import type { AuthorityManifest, TrustDecision } from "@calllint/types"

/**
 * Windsurf host adapter (C5 host #3 — Tier A). Mirrors the G5 plan invariants
 * proven for Claude Code / Cursor (ADR 0036/0037), plus the Tier-A property
 * (ships applyPlan → delegates to the audited engine) and the ONE Windsurf-
 * specific shape: a remote server is written under `serverUrl`, not `url`.
 *  - plan is sealed + digest-verifiable, bound to the upstream chain
 *  - same inputs ⇒ byte-identical plan; plan change ⇒ digest change
 *  - env values are never carried from the source (keys only)
 *  - a remote server serialises to `serverUrl` (Windsurf Cascade field)
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
    host: WINDSURF_HOST_ID,
    tier: "A",
    configPath: ".codeium/mcp_config.json",
    configDigest: CFG_D,
    currentConfig: { mcpServers: {} },
    servers: [{ name: "demo", entry: { command: "node", args: ["s.js"] } }],
    backupPath: ".codeium/mcp_config.json.calllint-backup",
    expiresAt: "2026-07-16T01:00:00.000Z",
    ...over,
  }
}

describe("windsurfAdapter — Tier A (C5 host #3)", () => {
  it("is registered as a Tier-A host that ships a writer", () => {
    expect(windsurfAdapter.id).toBe("windsurf")
    expect(windsurfAdapter.tier).toBe("A")
    // Tier A: declares applyPlan (delegates to the audited engine).
    expect(typeof windsurfAdapter.applyPlan).toBe("function")
  })

  it("createPlan assembles a sealed, digest-verifiable plan bound to the upstream chain", () => {
    const plan = windsurfAdapter.createPlan(ctx(), upstream)
    expect(plan.schema).toBe("calllint.install-plan.v1")
    expect(plan.host).toBe("windsurf")
    expect(plan.tier).toBe("A")
    expect(plan.artifactDigest).toBe(A)
    expect(plan.authorityDigest).toBe(AUTH_D)
    expect(plan.decisionDigest).toBe(DEC_D)
    expect(plan.policyDigest).toBe(POL_D)
    expect(verifyPlanDigest(plan)).toBe(true)
    expect(windsurfAdapter.validatePlan(plan).ok).toBe(true)
  })

  it("is deterministic — same inputs yield byte-identical plans", () => {
    expect(JSON.stringify(windsurfAdapter.createPlan(ctx(), upstream))).toBe(
      JSON.stringify(windsurfAdapter.createPlan(ctx(), upstream)),
    )
  })

  it("plan change ⇒ digest change (add a server)", () => {
    const one = windsurfAdapter.createPlan(ctx(), upstream)
    const two = windsurfAdapter.createPlan(
      ctx({ servers: [...ctx().servers, { name: "extra", entry: { serverUrl: "https://x" } }] }),
      upstream,
    )
    expect(two.planDigest).not.toBe(one.planDigest)
  })

  it("tamper is detected: mutating an op breaks verifyPlanDigest", () => {
    const plan = windsurfAdapter.createPlan(ctx(), upstream)
    expect(verifyPlanDigest({ ...plan, operations: [] })).toBe(false)
  })
})

describe("windsurfServerEntry — known-schema, env keys only, serverUrl for remote", () => {
  it("keeps command/args and reconstructs env from keys with empty values", () => {
    const entry = windsurfServerEntry({
      command: "node",
      args: ["srv.js"],
      envKeys: ["GITHUB_TOKEN", "API_KEY"],
    })
    expect(entry["command"]).toBe("node")
    expect(entry["args"]).toEqual(["srv.js"])
    // keys sorted, values BLANK — a scanned secret value is never written.
    expect(entry["env"]).toEqual({ API_KEY: "", GITHUB_TOKEN: "" })
  })

  it("a remote server stores serverUrl (Windsurf field), NOT url, and no command/args", () => {
    const entry = windsurfServerEntry({ url: "https://api.example.com/mcp" })
    expect(entry["serverUrl"]).toBe("https://api.example.com/mcp")
    // The distinguishing Windsurf behaviour: never the Cursor/Claude `url` key.
    expect(entry["url"]).toBeUndefined()
    expect(entry["command"]).toBeUndefined()
    expect(entry["args"]).toBeUndefined()
  })

  it("never carries a raw value — no env when there are no keys", () => {
    const entry = windsurfServerEntry({ command: "node", args: [] })
    expect(entry["env"]).toBeUndefined()
  })
})
