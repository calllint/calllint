import { describe, it, expect, beforeEach } from "vitest"
import { registry } from "../src/registry.js"
import type { AgentExtractor, DiscoveredConfig } from "../src/types.js"

// Mock extractor for testing
class MockExtractor implements AgentExtractor {
  constructor(
    public readonly agentType: any,
    public readonly priority: any,
    private configs: DiscoveredConfig[] = []
  ) {}

  async discover(_cwd: string): Promise<DiscoveredConfig[]> {
    return this.configs
  }
}

describe("ExtractorRegistry", () => {
  beforeEach(() => {
    registry.clear()
  })

  it("registers and retrieves extractors", () => {
    const extractor = new MockExtractor("cursor", "P0")
    registry.register(extractor)

    const retrieved = registry.get("cursor")
    expect(retrieved).toBe(extractor)
  })

  it("throws when registering duplicate agent type", () => {
    const extractor1 = new MockExtractor("cursor", "P0")
    const extractor2 = new MockExtractor("cursor", "P0")

    registry.register(extractor1)
    expect(() => registry.register(extractor2)).toThrow(/already registered/)
  })

  it("returns undefined for unknown agent type", () => {
    const retrieved = registry.get("unknown" as any)
    expect(retrieved).toBeUndefined()
  })

  it("getAll returns all registered extractors", () => {
    const e1 = new MockExtractor("cursor", "P0")
    const e2 = new MockExtractor("claude-code", "P0")
    const e3 = new MockExtractor("vscode", "P1")

    registry.register(e1)
    registry.register(e2)
    registry.register(e3)

    const all = registry.getAll()
    expect(all).toHaveLength(3)
    expect(all).toContain(e1)
    expect(all).toContain(e2)
    expect(all).toContain(e3)
  })

  it("getByTypes filters by agent types", () => {
    const e1 = new MockExtractor("cursor", "P0")
    const e2 = new MockExtractor("claude-code", "P0")
    const e3 = new MockExtractor("vscode", "P1")

    registry.register(e1)
    registry.register(e2)
    registry.register(e3)

    const filtered = registry.getByTypes(["cursor", "vscode"])
    expect(filtered).toHaveLength(2)
    expect(filtered).toContain(e1)
    expect(filtered).toContain(e3)
  })

  it("getByPriority filters by priority tier", () => {
    const e1 = new MockExtractor("cursor", "P0")
    const e2 = new MockExtractor("claude-code", "P0")
    const e3 = new MockExtractor("vscode", "P1")
    const e4 = new MockExtractor("codex", "P2")

    registry.register(e1)
    registry.register(e2)
    registry.register(e3)
    registry.register(e4)

    const p0 = registry.getByPriority("P0")
    expect(p0).toHaveLength(2)
    expect(p0).toContain(e1)
    expect(p0).toContain(e2)

    const p1 = registry.getByPriority("P1")
    expect(p1).toHaveLength(1)
    expect(p1).toContain(e3)
  })

  it("getAllSortedByPriority sorts P0 first, P3 last", () => {
    const e1 = new MockExtractor("codex", "P2")
    const e2 = new MockExtractor("cursor", "P0")
    const e3 = new MockExtractor("openclaw", "P3")
    const e4 = new MockExtractor("vscode", "P1")

    // Register in random order
    registry.register(e1)
    registry.register(e2)
    registry.register(e3)
    registry.register(e4)

    const sorted = registry.getAllSortedByPriority()
    expect(sorted).toHaveLength(4)
    expect(sorted[0]).toBe(e2) // P0
    expect(sorted[1]).toBe(e4) // P1
    expect(sorted[2]).toBe(e1) // P2
    expect(sorted[3]).toBe(e3) // P3
  })

  it("clear removes all extractors", () => {
    const e1 = new MockExtractor("cursor", "P0")
    const e2 = new MockExtractor("claude-code", "P0")

    registry.register(e1)
    registry.register(e2)
    expect(registry.getAll()).toHaveLength(2)

    registry.clear()
    expect(registry.getAll()).toHaveLength(0)
  })
})
