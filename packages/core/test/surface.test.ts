import { describe, it, expect } from "vitest"
import { classifySurface } from "../src/surface/detect.js"
import { extractPackageSpec, parseSnippet } from "../src/surface/snippet.js"
import { inferOrigin } from "../src/surface/load.js"

describe("classifySurface (P1.5 / L0 trigger)", () => {
  it("SCANs known MCP config paths", () => {
    expect(classifySurface("project/.cursor/mcp.json")).toBe("SCAN")
    expect(classifySurface("project/.vscode/mcp.json")).toBe("SCAN")
    expect(classifySurface(".mcp.json")).toBe("SCAN")
    expect(classifySurface("/home/u/claude_desktop_config.json")).toBe("SCAN")
  })

  it("NOOPs ordinary source and node_modules", () => {
    expect(classifySurface("src/index.ts")).toBe("NOOP")
    expect(classifySurface("README.md")).toBe("NOOP") // no install snippet content
    expect(classifySurface("node_modules/.cursor/mcp.json")).toBe("NOOP")
    expect(classifySurface("project/node_modules/pkg/mcp.json")).toBe("NOOP")
    expect(classifySurface("package-lock.json")).toBe("NOOP")
  })

  it("uses content to promote config.toml / settings.json / README", () => {
    expect(classifySurface("config.toml", "[mcp_servers.demo]\ncommand='npx'")).toBe("SCAN")
    expect(classifySurface("config.toml", "[tool.poetry]")).toBe("NOOP")
    expect(classifySurface("settings.json", '{"mcpServers":{}}')).toBe("SCAN")
    expect(classifySurface("settings.json", '{"editor.fontSize":12}')).toBe("NOOP")
    expect(classifySurface("README.md", "Run `npx -y demo-mcp`")).toBe("SCAN")
  })

  it("SCANs a stdin snippet with an install marker", () => {
    expect(classifySurface("-", "npx -y demo-mcp@1.0.0")).toBe("SCAN")
    expect(classifySurface("-", "just some text")).toBe("NOOP")
  })
})

describe("extractPackageSpec / parseSnippet (P1.6)", () => {
  it("extracts from npx / uvx / bunx and bare specs", () => {
    expect(extractPackageSpec("npx -y demo-mcp@1.2.3")).toBe("demo-mcp@1.2.3")
    expect(extractPackageSpec("uvx some-tool")).toBe("some-tool")
    expect(extractPackageSpec("@scope/pkg@2.0.0")).toBe("@scope/pkg@2.0.0")
  })

  it("extracts from a claude mcp add command", () => {
    expect(
      extractPackageSpec("claude mcp add demo -- npx -y @modelcontextprotocol/server-time@1.0.0"),
    ).toBe("@modelcontextprotocol/server-time@1.0.0")
  })

  it("parseSnippet yields a scannable config for a real spec", () => {
    const { parsed, packageSpec } = parseSnippet("npx -y demo-mcp@1.2.3")
    expect(packageSpec).toBe("demo-mcp@1.2.3")
    expect(parsed.servers.length).toBe(1)
    expect(parsed.servers[0]!.args).toContain("demo-mcp@1.2.3")
  })

  it("parseSnippet throws on an unrecognized snippet (caller reports UNKNOWN, not SAFE)", () => {
    expect(() => parseSnippet("please install my tool")).toThrow()
  })
})

describe("inferOrigin (P1.6 / ADR 0019 Decision 1)", () => {
  it("workspace dotfiles → workspace", () => {
    expect(inferOrigin("project/.cursor/mcp.json")).toBe("workspace")
    expect(inferOrigin(".mcp.json")).toBe("workspace")
  })

  it("npm/remote specs → remote", () => {
    expect(inferOrigin("npm:demo-mcp@1.0.0")).toBe("remote")
    expect(inferOrigin("https://example.com/mcp")).toBe("remote")
  })

  it("ambiguous → unknown (never guesses workspace)", () => {
    expect(inferOrigin("somewhere/random.json")).toBe("unknown")
  })
})
