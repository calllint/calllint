import { describe, it, expect } from "vitest"
import {
  parseTargetSpec,
  serverNameForPackage,
  synthesizeNpmConfig,
  scanConfigText,
} from "../src/index.js"

const OPTS = { now: 0, generatedAt: "2026-06-01T00:00:00.000Z" }

describe("parseTargetSpec", () => {
  it("treats a bare path as a path", () => {
    expect(parseTargetSpec("./mcp.json").kind).toBe("path")
    expect(parseTargetSpec("C:/x/mcp.json").kind).toBe("path")
  })
  it("parses npm specs incl. scoped + version", () => {
    expect(parseTargetSpec("npm:mcp-weather@1.0.0")).toMatchObject({
      kind: "npm",
      packageSpec: "mcp-weather@1.0.0",
    })
    expect(parseTargetSpec("npm:@scope/pkg@2.0.0").packageSpec).toBe("@scope/pkg@2.0.0")
  })
  it("parses github specs with optional ref", () => {
    expect(parseTargetSpec("github:owner/repo")).toMatchObject({
      kind: "github",
      repo: "owner/repo",
    })
    expect(parseTargetSpec("github:owner/repo@main")).toMatchObject({
      kind: "github",
      repo: "owner/repo",
      ref: "main",
    })
  })
})

describe("serverNameForPackage", () => {
  it("strips version and normalizes scope", () => {
    expect(serverNameForPackage("mcp-weather@1.0.0")).toBe("mcp-weather")
    expect(serverNameForPackage("@scope/pkg@2.0.0")).toBe("scope-pkg")
    expect(serverNameForPackage("plain")).toBe("plain")
  })
})

describe("synthesizeNpmConfig", () => {
  it("produces a config the offline pipeline can scan", () => {
    const { text, configPath } = synthesizeNpmConfig("mcp-weather@latest")
    expect(configPath).toBe("npm:mcp-weather@latest")
    const summary = scanConfigText(text, configPath, OPTS)
    // unpinned (@latest) → SUPPLY finding → REVIEW
    expect(summary.verdict).toBe("REVIEW")
    expect(summary.reports[0]!.symbols).toContain("SUPPLY")
  })

  it("a pinned financial package surfaces MONEY", () => {
    const { text, configPath } = synthesizeNpmConfig("mcp-stripe-pay@1.2.0")
    const summary = scanConfigText(text, configPath, OPTS)
    expect(summary.reports[0]!.symbols).toContain("MONEY")
  })
})
