import { describe, it, expect } from "vitest"
import { resolveRuntimeBinding } from "@calllint/resolver"
import { analyzeServerConfig } from "@calllint/static-analyzer"
import type { NormalizedMcpServer } from "@calllint/types"
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
