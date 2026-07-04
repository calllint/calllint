import { describe, it, expect, beforeEach } from "vitest"
import { registry } from "../registry.js"
import { bootstrapExtractors } from "../bootstrap.js"
import type { AgentType } from "../types.js"

describe("bootstrap", () => {
  beforeEach(() => {
    // Clear registry before each test
    registry.clear()
  })

  it("should auto-register P0 + P1 extractors", () => {
    // Bootstrap should have been called during module import
    bootstrapExtractors()

    const registered = registry.getAll()
    expect(registered).toHaveLength(5)

    const types = registered.map(e => e.agentType).sort()
    expect(types).toEqual(["claude-code", "claude-desktop", "cursor", "vscode", "windsurf"])
  })

  it("should register all P0 extractors with correct priority", () => {
    bootstrapExtractors()

    const p0Extractors = registry.getByPriority("P0")
    expect(p0Extractors).toHaveLength(3)

    for (const extractor of p0Extractors) {
      expect(extractor.priority).toBe("P0")
    }
  })

  it("should register all P1 extractors with correct priority", () => {
    bootstrapExtractors()

    const p1Extractors = registry.getByPriority("P1")
    expect(p1Extractors).toHaveLength(2)

    for (const extractor of p1Extractors) {
      expect(extractor.priority).toBe("P1")
    }
  })

  it("should register extractors that can discover configs", () => {
    bootstrapExtractors()

    // P0
    const cursor = registry.get("cursor")
    expect(cursor).toBeDefined()
    expect(cursor?.agentType).toBe("cursor")

    const claudeCode = registry.get("claude-code")
    expect(claudeCode).toBeDefined()
    expect(claudeCode?.agentType).toBe("claude-code")

    const claudeDesktop = registry.get("claude-desktop")
    expect(claudeDesktop).toBeDefined()
    expect(claudeDesktop?.agentType).toBe("claude-desktop")

    // P1
    const vscode = registry.get("vscode")
    expect(vscode).toBeDefined()
    expect(vscode?.agentType).toBe("vscode")

    const windsurf = registry.get("windsurf")
    expect(windsurf).toBeDefined()
    expect(windsurf?.agentType).toBe("windsurf")
  })

  it("should not throw when called multiple times", () => {
    // First call
    expect(() => bootstrapExtractors()).not.toThrow()

    // Second call should throw because extractors are already registered
    expect(() => bootstrapExtractors()).toThrow(/already registered/)
  })
})
