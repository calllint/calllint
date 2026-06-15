import { describe, it, expect } from "vitest"
import { parseNpmSpec, isPinnedVersion, resolveRuntimeBinding } from "../src/index.js"
import { parseConfigFile } from "@mcpguard/config-parser"
import { goldenPath } from "@mcpguard/fixtures"

describe("parseNpmSpec", () => {
  it("parses scoped package with version", () => {
    expect(parseNpmSpec("@modelcontextprotocol/server-filesystem@1.0.0")).toEqual({
      name: "@modelcontextprotocol/server-filesystem",
      versionSpec: "1.0.0",
    })
  })
  it("parses scoped package without version", () => {
    expect(parseNpmSpec("@modelcontextprotocol/server-filesystem")).toEqual({
      name: "@modelcontextprotocol/server-filesystem",
    })
  })
  it("parses unscoped with latest", () => {
    expect(parseNpmSpec("weather-mcp@latest")).toEqual({
      name: "weather-mcp",
      versionSpec: "latest",
    })
  })
  it("ignores flags and paths", () => {
    expect(parseNpmSpec("-y")).toBeUndefined()
    expect(parseNpmSpec("/Users/lucas")).toBeUndefined()
  })
})

describe("isPinnedVersion", () => {
  it("treats exact versions as pinned", () => {
    expect(isPinnedVersion("1.0.0")).toBe(true)
  })
  it("treats latest/range/absent as unpinned", () => {
    expect(isPinnedVersion("latest")).toBe(false)
    expect(isPinnedVersion("^1.0.0")).toBe(false)
    expect(isPinnedVersion(undefined)).toBe(false)
  })
})

function bindingFor(file: string) {
  const cfg = parseConfigFile(goldenPath(file))
  return resolveRuntimeBinding(cfg.servers[0]!)
}

describe("resolveRuntimeBinding", () => {
  it("resolves npx package as the real subject", () => {
    const b = bindingFor("safe-time.json")
    expect(b.packageName).toBe("@modelcontextprotocol/server-time")
    expect(b.isVersionPinned).toBe(true)
    expect(b.runtimeExecutable).toBe(true)
    expect(b.sourceKnown).toBe(true)
  })

  it("flags unpinned npx package", () => {
    const b = bindingFor("review-unpinned-package.json")
    expect(b.packageName).toBe("weather-mcp")
    expect(b.isVersionPinned).toBe(false)
  })

  it("marks remote url as not source-known and not executable on host", () => {
    const b = bindingFor("unknown-remote.json")
    expect(b.remoteUrl).toContain("https://")
    expect(b.sourceKnown).toBe(false)
    expect(b.runtimeExecutable).toBe(false)
  })

  it("marks shell command as executable, source unknown", () => {
    const b = bindingFor("block-dangerous-command.json")
    expect(b.runtimeExecutable).toBe(true)
    expect(b.sourceKnown).toBe(false)
    expect(b.packageName).toBeUndefined()
  })
})
