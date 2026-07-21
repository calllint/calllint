import { describe, it, expect } from "vitest"
import { verifyPlanDigest } from "../src/index.js"
import { vscodeAdapter, vscodeServerEntry, VSCODE_HOST_ID } from "../src/index.js"
import type { PlanContext, PlanUpstream } from "../src/index.js"
import type { AuthorityManifest, TrustDecision } from "@calllint/types"

/**
 * VS Code host adapter (A2 net-new host — Tier A). Mirrors the plan invariants proven
 * for Claude Code / Cursor / Windsurf (ADR 0036/0037), plus the Tier-A property (ships
 * applyPlan → delegates to the audited engine). VS Code's `mcp.json` is the same
 * root-`mcpServers` map as Cursor / Claude Code, and a remote server is written as `url`.
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
    host: VSCODE_HOST_ID,
    tier: "A",
    configPath: "Code/User/mcp.json",
    configDigest: CFG_D,
    currentConfig: { mcpServers: {} },
    servers: [{ name: "demo", entry: { command: "node", args: ["s.js"] } }],
    backupPath: "Code/User/mcp.json.calllint-backup",
    expiresAt: "2026-07-21T01:00:00.000Z",
    ...over,
  }
}

describe("vscodeAdapter — Tier A (A2 net-new host)", () => {
  it("is registered as a Tier-A host that ships a writer", () => {
    expect(vscodeAdapter.id).toBe("vscode")
    expect(vscodeAdapter.tier).toBe("A")
    expect(typeof vscodeAdapter.applyPlan).toBe("function")
  })

  it("createPlan assembles a sealed, digest-verifiable plan bound to the upstream chain", () => {
    const plan = vscodeAdapter.createPlan(ctx(), upstream)
    expect(plan.schema).toBe("calllint.install-plan.v1")
    expect(plan.host).toBe("vscode")
    expect(plan.tier).toBe("A")
    expect(plan.artifactDigest).toBe(A)
    expect(plan.authorityDigest).toBe(AUTH_D)
    expect(verifyPlanDigest(plan)).toBe(true)
    expect(vscodeAdapter.validatePlan(plan).ok).toBe(true)
  })

  it("is deterministic — same inputs yield byte-identical plans", () => {
    expect(JSON.stringify(vscodeAdapter.createPlan(ctx(), upstream))).toBe(
      JSON.stringify(vscodeAdapter.createPlan(ctx(), upstream)),
    )
  })

  it("tamper is detected: mutating operations breaks verifyPlanDigest", () => {
    const plan = vscodeAdapter.createPlan(ctx(), upstream)
    expect(verifyPlanDigest({ ...plan, operations: [] })).toBe(false)
  })
})

describe("vscodeServerEntry — known-schema, env keys only, url for remote", () => {
  it("keeps command/args and reconstructs env from keys with empty values", () => {
    const entry = vscodeServerEntry({
      command: "node",
      args: ["srv.js"],
      envKeys: ["GITHUB_TOKEN", "API_KEY"],
    })
    expect(entry["command"]).toBe("node")
    expect(entry["args"]).toEqual(["srv.js"])
    expect(entry["env"]).toEqual({ API_KEY: "", GITHUB_TOKEN: "" })
  })

  it("a remote server stores url, no command/args", () => {
    const entry = vscodeServerEntry({ url: "https://api.example.com/mcp" })
    expect(entry["url"]).toBe("https://api.example.com/mcp")
    expect(entry["command"]).toBeUndefined()
    expect(entry["args"]).toBeUndefined()
  })

  it("never carries a raw value — no env when there are no keys", () => {
    const entry = vscodeServerEntry({ command: "node", args: [] })
    expect(entry["env"]).toBeUndefined()
  })
})
