import { readFileSync } from "node:fs"
import { describe, it, expect } from "vitest"
import { resolveRuntimeBinding } from "@calllint/resolver"
import { analyzeServerConfig } from "@calllint/static-analyzer"
import { FP_EFFECTS, type NormalizedMcpServer } from "@calllint/types"
import { buildFingerprint, fingerprintHash } from "../src/extract/fingerprint.js"

// ---------------------------------------------------------------------------
// P1.1 — Capability Fingerprint extraction (ADR 0019). The central invariant:
// the same MCP capability expressed in different hosts hashes identically, and
// secret values never enter the fingerprint.
// ---------------------------------------------------------------------------

/** Minimal normalized server, as if parsed from any host's mcp.json. */
function server(
  overrides: Partial<NormalizedMcpServer> & { sourceConfigPath: string },
): NormalizedMcpServer {
  return {
    name: "demo",
    transport: "stdio",
    command: "npx",
    args: ["-y", "demo-mcp@1.2.3"],
    envKeys: [],
    env: {},
    providedTools: [],
    raw: {},
    ...overrides,
  }
}

function fingerprintFor(
  s: NormalizedMcpServer,
  origin?: "workspace" | "user" | "system" | "remote" | "unknown",
) {
  const binding = resolveRuntimeBinding(s)
  const findings = analyzeServerConfig(s)
  return buildFingerprint({ server: s, binding, findings, origin })
}

describe("cross-host fingerprint equality (ADR 0019)", () => {
  it("same npx MCP server in Cursor and VS Code yields the same hash", () => {
    // Cursor writes .cursor/mcp.json, VS Code writes .vscode/mcp.json — only the
    // path differs; the capability is identical.
    const cursor = server({ sourceConfigPath: ".cursor/mcp.json" })
    const vscode = server({ sourceConfigPath: ".vscode/mcp.json" })

    const fpCursor = fingerprintFor(cursor, "workspace")
    const fpVscode = fingerprintFor(vscode, "workspace")

    expect(fingerprintHash(fpCursor)).toBe(fingerprintHash(fpVscode))
    expect(fpCursor.source).toBe("npm:demo-mcp@1.2.3")
    expect(fpCursor.launch).toBe("local:npx")
    expect(fpCursor.transport).toBe("stdio")
  })

  it("array order in authority/effects does not change the hash", () => {
    const a = server({ sourceConfigPath: ".cursor/mcp.json", envKeys: ["B_TOKEN", "A_KEY"] })
    const b = server({ sourceConfigPath: ".cursor/mcp.json", envKeys: ["A_KEY", "B_TOKEN"] })
    expect(fingerprintHash(fingerprintFor(a))).toBe(fingerprintHash(fingerprintFor(b)))
  })
})

describe("fingerprint secret redaction (ADR 0019)", () => {
  it("authority carries env KEY NAMES only, never values", () => {
    const s = server({
      sourceConfigPath: ".cursor/mcp.json",
      envKeys: ["GITHUB_TOKEN"],
      env: { GITHUB_TOKEN: "ghp_supersecretvalue123" },
    })
    const fp = fingerprintFor(s, "workspace")
    expect(fp.authority).toEqual(["env:GITHUB_TOKEN"])
    const serialized = JSON.stringify(fp)
    expect(serialized).not.toContain("ghp_supersecretvalue123")
  })
})

describe("fingerprint scope derivation (ADR 0019 Decision 1)", () => {
  it("defaults to unknown when origin is ambiguous — never guesses workspace", () => {
    const s = server({ sourceConfigPath: "somewhere.json" })
    const fp = fingerprintFor(s) // no origin
    expect(fp.scope).toBe("unknown")
  })

  it("a remote launch is external even without an explicit origin", () => {
    const s = server({
      sourceConfigPath: "remote.json",
      command: undefined,
      args: [],
      transport: "http",
      url: "https://api.example.com/mcp",
    })
    const fp = fingerprintFor(s)
    expect(fp.scope).toBe("external")
  })
})

describe("fingerprint identity (ADR 0019)", () => {
  it("is never 'verified' in v0 — known or unknown only", () => {
    const known = fingerprintFor(server({ sourceConfigPath: ".cursor/mcp.json" }))
    expect(["known", "unknown"]).toContain(known.identity)
    expect(known.identity).not.toBe("verified")
  })
})

// ---------------------------------------------------------------------------
// FP_EFFECTS reachability (ADR 0005). FP_EFFECTS is the Effect layer of the
// Authority Model v2 — it normalizes "different tools, same consequence". One of
// its 9 members has no producer, and this pins that gap so it cannot be closed
// silently: `effects` feeds fingerprintHash(), so emitting `messaging` would
// change the L1 hash of every messaging server. That needs its own ADR.
// ---------------------------------------------------------------------------
describe("FP_EFFECTS reachability (ADR 0005)", () => {
  /** The members `deriveEffects()` can actually emit, read from its source. */
  const reachable = (): Set<string> => {
    const src = readFileSync(new URL("../src/extract/fingerprint.ts", import.meta.url), "utf8")
    const fn = src.slice(src.indexOf("function deriveEffects"))
    const body = fn.slice(0, fn.indexOf("\n}"))
    return new Set([...body.matchAll(/effects\.add\("([a-z_]+)"\)/g)].map((m) => m[1] ?? ""))
  }

  it("the reader observes its subject — it finds known emitters", () => {
    const got = reachable()
    expect(got.has("payment")).toBe(true)
    expect(got.has("network_egress")).toBe(true)
    expect(got.size).toBeGreaterThan(1)
  })

  it("8 of the 9 members are reachable; `messaging` is a KNOWN GAP, not correct", () => {
    const got = reachable()
    const unreachable = FP_EFFECTS.filter((e) => !got.has(e))
    // Not an endorsement. If you add the emitter, this test SHOULD fail — read
    // ADR 0005 first: closing it changes shipped L1 fingerprints.
    expect(unreachable).toEqual(["messaging"])
    expect(got.size).toBe(FP_EFFECTS.length - 1)
  })

  it("every reachable member is a declared FP_EFFECTS value (no invented effect)", () => {
    for (const e of reachable()) expect(FP_EFFECTS).toContain(e)
  })
})
