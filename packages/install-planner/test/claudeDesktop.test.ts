import { describe, it, expect } from "vitest"
import { verifyPlanDigest } from "../src/index.js"
import { claudeDesktopAdapter, claudeDesktopServerEntry, CLAUDE_DESKTOP_HOST_ID } from "../src/index.js"
import type { PlanContext, PlanUpstream } from "../src/index.js"
import type { AuthorityManifest, TrustDecision } from "@calllint/types"

/**
 * Claude Desktop host adapter (A2 net-new host — Tier A). Mirrors the plan invariants
 * proven for Claude Code / Cursor / Windsurf (ADR 0036/0037), plus the Tier-A property
 * (ships applyPlan → delegates to the audited engine). Claude Desktop's config is the
 * same root-`mcpServers` map as Claude Code, and a remote server is written under `url`.
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
    host: CLAUDE_DESKTOP_HOST_ID,
    tier: "A",
    configPath: "Claude/claude_desktop_config.json",
    configDigest: CFG_D,
    currentConfig: { mcpServers: {} },
    servers: [{ name: "demo", entry: { command: "node", args: ["s.js"] } }],
    backupPath: "Claude/claude_desktop_config.json.calllint-backup",
    expiresAt: "2026-07-21T01:00:00.000Z",
    ...over,
  }
}

describe("claudeDesktopAdapter — Tier A (A2 net-new host)", () => {
  it("is registered as a Tier-A host that ships a writer", () => {
    expect(claudeDesktopAdapter.id).toBe("claude-desktop")
    expect(claudeDesktopAdapter.tier).toBe("A")
    expect(typeof claudeDesktopAdapter.applyPlan).toBe("function")
  })

  it("createPlan assembles a sealed, digest-verifiable plan bound to the upstream chain", () => {
    const plan = claudeDesktopAdapter.createPlan(ctx(), upstream)
    expect(plan.schema).toBe("calllint.install-plan.v1")
    expect(plan.host).toBe("claude-desktop")
    expect(plan.tier).toBe("A")
    expect(plan.artifactDigest).toBe(A)
    expect(plan.authorityDigest).toBe(AUTH_D)
    expect(verifyPlanDigest(plan)).toBe(true)
    expect(claudeDesktopAdapter.validatePlan(plan).ok).toBe(true)
  })

  it("is deterministic — same inputs yield byte-identical plans", () => {
    expect(JSON.stringify(claudeDesktopAdapter.createPlan(ctx(), upstream))).toBe(
      JSON.stringify(claudeDesktopAdapter.createPlan(ctx(), upstream)),
    )
  })

  it("tamper is detected: mutating operations breaks verifyPlanDigest", () => {
    const plan = claudeDesktopAdapter.createPlan(ctx(), upstream)
    expect(verifyPlanDigest({ ...plan, operations: [] })).toBe(false)
  })
})

describe("claudeDesktopServerEntry — known-schema, env keys only, url for remote", () => {
  it("keeps command/args and reconstructs env from keys with empty values", () => {
    const entry = claudeDesktopServerEntry({
      command: "node",
      args: ["srv.js"],
      envKeys: ["GITHUB_TOKEN", "API_KEY"],
    })
    expect(entry["command"]).toBe("node")
    expect(entry["args"]).toEqual(["srv.js"])
    // keys sorted, values BLANK — a scanned secret value is never written.
    expect(entry["env"]).toEqual({ API_KEY: "", GITHUB_TOKEN: "" })
  })

  it("a remote server stores url (same as Claude Code), no command/args", () => {
    const entry = claudeDesktopServerEntry({ url: "https://api.example.com/mcp" })
    expect(entry["url"]).toBe("https://api.example.com/mcp")
    expect(entry["command"]).toBeUndefined()
    expect(entry["args"]).toBeUndefined()
  })

  it("never carries a raw value — no env when there are no keys", () => {
    const entry = claudeDesktopServerEntry({ command: "node", args: [] })
    expect(entry["env"]).toBeUndefined()
  })
})
