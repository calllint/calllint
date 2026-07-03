import { describe, it, expect, beforeEach } from "vitest"
import { discoverConfigs, discoverAgent } from "../src/discovery-engine.js"
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

// Failing extractor for error handling tests
class FailingExtractor implements AgentExtractor {
  constructor(
    public readonly agentType: any,
    public readonly priority: any
  ) {}

  async discover(_cwd: string): Promise<DiscoveredConfig[]> {
    throw new Error("Simulated extractor failure")
  }
}

describe("discovery-engine", () => {
  beforeEach(() => {
    registry.clear()
  })

  describe("discoverConfigs", () => {
    it("discovers configs from all registered extractors", async () => {
      const config1: DiscoveredConfig = {
        agentType: "cursor",
        configPath: "/project/.cursor/mcp.json",
        exists: true,
        kind: "cursor-mcp-config",
        priority: "P0",
      }

      const config2: DiscoveredConfig = {
        agentType: "claude-code",
        configPath: "/project/.claude/settings.json",
        exists: true,
        kind: "claude-settings",
        priority: "P0",
      }

      const e1 = new MockExtractor("cursor", "P0", [config1])
      const e2 = new MockExtractor("claude-code", "P0", [config2])

      registry.register(e1)
      registry.register(e2)

      const result = await discoverConfigs({ cwd: "/project" })

      expect(result.cwd).toBe("/project")
      expect(result.discovered).toHaveLength(2)
      expect(result.discovered).toContainEqual(config1)
      expect(result.discovered).toContainEqual(config2)
      expect(result.searchedPaths).toHaveLength(2)
    })

    it("filters to specific agent types when requested", async () => {
      const config1: DiscoveredConfig = {
        agentType: "cursor",
        configPath: "/project/.cursor/mcp.json",
        exists: true,
        kind: "cursor-mcp-config",
        priority: "P0",
      }

      const config2: DiscoveredConfig = {
        agentType: "claude-code",
        configPath: "/project/.claude/settings.json",
        exists: true,
        kind: "claude-settings",
        priority: "P0",
      }

      const e1 = new MockExtractor("cursor", "P0", [config1])
      const e2 = new MockExtractor("claude-code", "P0", [config2])

      registry.register(e1)
      registry.register(e2)

      const result = await discoverConfigs({
        cwd: "/project",
        agentTypes: ["cursor"],
      })

      expect(result.discovered).toHaveLength(1)
      expect(result.discovered[0]).toEqual(config1)
    })

    it("excludes non-existent configs by default", async () => {
      const existing: DiscoveredConfig = {
        agentType: "cursor",
        configPath: "/project/.cursor/mcp.json",
        exists: true,
        kind: "cursor-mcp-config",
        priority: "P0",
      }

      const missing: DiscoveredConfig = {
        agentType: "claude-code",
        configPath: "/project/.claude/settings.json",
        exists: false,
        kind: "claude-settings",
        priority: "P0",
      }

      const extractor = new MockExtractor("cursor", "P0", [existing, missing])
      registry.register(extractor)

      const result = await discoverConfigs({ cwd: "/project" })

      expect(result.discovered).toHaveLength(1)
      expect(result.discovered[0]).toEqual(existing)
      expect(result.searchedPaths).toHaveLength(2) // Both paths searched
    })

    it("includes non-existent configs when includeMissing=true", async () => {
      const existing: DiscoveredConfig = {
        agentType: "cursor",
        configPath: "/project/.cursor/mcp.json",
        exists: true,
        kind: "cursor-mcp-config",
        priority: "P0",
      }

      const missing: DiscoveredConfig = {
        agentType: "claude-code",
        configPath: "/project/.claude/settings.json",
        exists: false,
        kind: "claude-settings",
        priority: "P0",
      }

      const extractor = new MockExtractor("cursor", "P0", [existing, missing])
      registry.register(extractor)

      const result = await discoverConfigs({
        cwd: "/project",
        includeMissing: true,
      })

      expect(result.discovered).toHaveLength(2)
      expect(result.discovered).toContainEqual(existing)
      expect(result.discovered).toContainEqual(missing)
    })

    it("handles extractor failures gracefully", async () => {
      const goodConfig: DiscoveredConfig = {
        agentType: "cursor",
        configPath: "/project/.cursor/mcp.json",
        exists: true,
        kind: "cursor-mcp-config",
        priority: "P0",
      }

      const goodExtractor = new MockExtractor("cursor", "P0", [goodConfig])
      const badExtractor = new FailingExtractor("claude-code", "P0")

      registry.register(goodExtractor)
      registry.register(badExtractor)

      // Should not throw, should return results from working extractor
      const result = await discoverConfigs({ cwd: "/project" })

      expect(result.discovered).toHaveLength(1)
      expect(result.discovered[0]).toEqual(goodConfig)
    })

    it("returns empty when no extractors registered", async () => {
      const result = await discoverConfigs({ cwd: "/project" })

      expect(result.discovered).toHaveLength(0)
      expect(result.searchedPaths).toHaveLength(0)
    })

    it("runs all extractors in parallel", async () => {
      const config1: DiscoveredConfig = {
        agentType: "cursor",
        configPath: "/project/.cursor/mcp.json",
        exists: true,
        kind: "cursor-mcp-config",
        priority: "P0",
      }

      const config2: DiscoveredConfig = {
        agentType: "claude-code",
        configPath: "/project/.claude/settings.json",
        exists: true,
        kind: "claude-settings",
        priority: "P0",
      }

      const e1 = new MockExtractor("cursor", "P0", [config1])
      const e2 = new MockExtractor("claude-code", "P0", [config2])

      registry.register(e1)
      registry.register(e2)

      const startTime = Date.now()
      await discoverConfigs({ cwd: "/project" })
      const duration = Date.now() - startTime

      // Should complete quickly if parallel (mock extractors are instant)
      expect(duration).toBeLessThan(100)
    })
  })

  describe("discoverAgent", () => {
    it("discovers configs for specific agent type", async () => {
      const config: DiscoveredConfig = {
        agentType: "cursor",
        configPath: "/project/.cursor/mcp.json",
        exists: true,
        kind: "cursor-mcp-config",
        priority: "P0",
      }

      const extractor = new MockExtractor("cursor", "P0", [config])
      registry.register(extractor)

      const result = await discoverAgent("cursor", "/project")

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(config)
    })

    it("throws for unknown agent type", async () => {
      await expect(
        discoverAgent("unknown" as any, "/project")
      ).rejects.toThrow(/Unknown agent type/)
    })

    it("returns empty array on extractor failure", async () => {
      const badExtractor = new FailingExtractor("cursor", "P0")
      registry.register(badExtractor)

      const result = await discoverAgent("cursor", "/project")

      expect(result).toHaveLength(0)
    })
  })
})
