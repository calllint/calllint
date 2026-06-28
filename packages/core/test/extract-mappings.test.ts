import { describe, it, expect } from "vitest"
import {
  extractGenericMcpJson,
  extractGenericMcpToml,
  parseCodexToml,
  extractInstallSnippet,
  extractVscode,
  extractCursor,
  extractClaude,
  extractCodex,
  extractGemini,
  extractWindsurf,
  extractCline,
  buildFingerprint,
  fingerprintHash,
} from "../src/index.js"
import { resolveRuntimeBinding } from "@calllint/resolver"
import { analyzeServerConfig } from "@calllint/static-analyzer"
import type { NormalizedMcpServer } from "@calllint/types"

const NPX_DEMO = {
  mcpServers: { demo: { command: "npx", args: ["-y", "demo-mcp@1.2.3"] } },
}

function hashOf(server: NormalizedMcpServer): string {
  return fingerprintHash(
    buildFingerprint({
      server,
      binding: resolveRuntimeBinding(server),
      findings: analyzeServerConfig(server),
      origin: "workspace",
    }),
  )
}

describe("genericMcpJson (P2.1)", () => {
  it("normalizes the common mcpServers shape", () => {
    const servers = extractGenericMcpJson(NPX_DEMO, ".cursor/mcp.json")
    expect(servers).toHaveLength(1)
    expect(servers[0]!.command).toBe("npx")
    expect(servers[0]!.args).toContain("demo-mcp@1.2.3")
  })
})

describe("genericMcpToml — Codex (P2.2)", () => {
  it("parses [mcp_servers.NAME] tables with args + env", () => {
    const toml = `
# Codex config
[mcp_servers.demo]
command = "npx"
args = ["-y", "demo-mcp@1.2.3"]
env = { API_KEY = "redacted" }

[mcp_servers.remote]
url = "https://api.example.com/mcp"
type = "http"
`
    const parsed = parseCodexToml(toml)
    expect(Object.keys(parsed)).toEqual(["demo", "remote"])
    expect(parsed.demo!.args).toEqual(["-y", "demo-mcp@1.2.3"])
    expect(parsed.demo!.env).toEqual({ API_KEY: "redacted" })
    expect(parsed.remote!.url).toBe("https://api.example.com/mcp")

    const servers = extractGenericMcpToml(toml, ".codex/config.toml")
    expect(servers).toHaveLength(2)
    expect(servers[0]!.command).toBe("npx")
    expect(servers[0]!.envKeys).toEqual(["API_KEY"])
  })

  it("returns no servers for a toml with no mcp_servers tables", () => {
    expect(extractGenericMcpToml("[tool.poetry]\nname='x'")).toEqual([])
  })
})

describe("installSnippet (P2.3)", () => {
  it("extracts servers and yields the SAME fingerprint as the config file", () => {
    const fromSnippet = extractInstallSnippet("npx -y demo-mcp@1.2.3")
    expect(fromSnippet.servers).toHaveLength(1)

    const fromConfig = extractGenericMcpJson(NPX_DEMO, "npm:demo-mcp@1.2.3")
    // Same capability → same hash, regardless of how it was declared.
    expect(hashOf(fromSnippet.servers[0]!)).toBe(hashOf(fromConfig[0]!))
  })

  it("throws on an unrecognized snippet (caller → UNKNOWN)", () => {
    expect(() => extractInstallSnippet("please install my tool")).toThrow()
  })
})

describe("cross-host fingerprint equality (P2.4 / ADR 0019)", () => {
  it("the same npx server from 6 JSON hosts yields one identical hash", () => {
    const jsonHosts = [
      extractVscode(NPX_DEMO),
      extractCursor(NPX_DEMO),
      extractClaude(NPX_DEMO),
      extractGemini(NPX_DEMO),
      extractWindsurf(NPX_DEMO),
      extractCline(NPX_DEMO),
    ]
    const hashes = jsonHosts.map((h) => hashOf(h.servers[0]!))
    expect(new Set(hashes).size).toBe(1)
  })

  it("Codex (TOML) produces the same hash as the JSON hosts", () => {
    const toml = `[mcp_servers.demo]\ncommand = "npx"\nargs = ["-y", "demo-mcp@1.2.3"]\n`
    const codex = extractCodex(toml)
    const cursor = extractCursor(NPX_DEMO)
    expect(hashOf(codex.servers[0]!)).toBe(hashOf(cursor.servers[0]!))
  })

  it("every host carries its scope hint", () => {
    expect(extractVscode(NPX_DEMO).origin).toBe("workspace")
    expect(extractCodex("[mcp_servers.demo]\ncommand=\"npx\"\n").host).toBe("codex")
  })
})
