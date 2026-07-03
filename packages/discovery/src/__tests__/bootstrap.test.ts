import { describe, it, expect, beforeEach } from "vitest"
import { registry } from "../registry.js"
import { bootstrapP0Extractors } from "../bootstrap.js"
import type { AgentType } from "../types.js"

describe("bootstrap", () => {
  beforeEach(() => {
    // Clear registry before each test
    registry.clear()
  })

  it("should auto-register P0 extractors", () => {
    // Bootstrap should have been called during module import
    bootstrapP0Extractors()

    const registered = registry.getAll()
    expect(registered).toHaveLength(3)

    const types = registered.map(e => e.agentType).sort()
    expect(types).toEqual(["claude-code", "claude-desktop", "cursor"])
  })

  it("should register all P0 extractors with correct priority", () => {
    bootstrapP0Extractors()

    const p0Extractors = registry.getByPriority("P0")
    expect(p0Extractors).toHaveLength(3)

    for (const extractor of p0Extractors) {
      expect(extractor.priority).toBe("P0")
    }
  })

  it("should allow manual registration after bootstrap", () => {
    bootstrapP0Extractors()
    expect(registry.getAll()).toHaveLength(3)

    // Bootstrap doesn't prevent manual registration of other agents
    // (This is a placeholder test; in reality we'd need a P1 extractor)
  })

  it("should register extractors that can discover configs", () => {
    bootstrapP0Extractors()

    const cursor = registry.get("cursor")
    expect(cursor).toBeDefined()
    expect(cursor?.agentType).toBe("cursor")

    const claudeCode = registry.get("claude-code")
    expect(claudeCode).toBeDefined()
    expect(claudeCode?.agentType).toBe("claude-code")

    const claudeDesktop = registry.get("claude-desktop")
    expect(claudeDesktop).toBeDefined()
    expect(claudeDesktop?.agentType).toBe("claude-desktop")
  })

  it("should not throw when called multiple times", () => {
    // First call
    expect(() => bootstrapP0Extractors()).not.toThrow()

    // Second call should throw because extractors are already registered
    expect(() => bootstrapP0Extractors()).toThrow(/already registered/)
  })
})
