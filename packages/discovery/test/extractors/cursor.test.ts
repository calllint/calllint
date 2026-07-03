import { describe, it, expect } from "vitest"
import { CursorExtractor } from "../../src/extractors/cursor.js"
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

describe("CursorExtractor", () => {
  const extractor = new CursorExtractor()

  it("has correct agent type and priority", () => {
    expect(extractor.agentType).toBe("cursor")
    expect(extractor.priority).toBe("P0")
  })

  it("discovers project-level config when it exists", async () => {
    const testDir = join(tmpdir(), `cursor-test-${Date.now()}`)
    const cursorDir = join(testDir, ".cursor")
    const configPath = join(cursorDir, "mcp.json")

    try {
      mkdirSync(cursorDir, { recursive: true })
      writeFileSync(configPath, JSON.stringify({ mcpServers: {} }))

      const result = await extractor.discover(testDir)

      const projectConfig = result.find(c => c.configPath === configPath)
      expect(projectConfig).toBeDefined()
      expect(projectConfig?.exists).toBe(true)
      expect(projectConfig?.kind).toBe("cursor-mcp-config")
    } finally {
      if (existsSync(testDir)) rmSync(testDir, { recursive: true })
    }
  })

  it("marks project config as non-existent when missing", async () => {
    const testDir = join(tmpdir(), `cursor-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })

    try {
      const result = await extractor.discover(testDir)

      // Find the project-level config (contains testDir path)
      const projectConfig = result.find(c => c.configPath.includes(testDir))
      expect(projectConfig).toBeDefined()
      expect(projectConfig?.exists).toBe(false)
    } finally {
      if (existsSync(testDir)) rmSync(testDir, { recursive: true })
    }
  })

  it("rejects configs without mcpServers key", async () => {
    const testDir = join(tmpdir(), `cursor-test-${Date.now()}`)
    const cursorDir = join(testDir, ".cursor")
    const configPath = join(cursorDir, "mcp.json")

    try {
      mkdirSync(cursorDir, { recursive: true })
      // Invalid: missing mcpServers key
      writeFileSync(configPath, JSON.stringify({ someOtherKey: {} }))

      const result = await extractor.discover(testDir)

      const projectConfig = result.find(c => c.configPath === configPath)
      expect(projectConfig?.exists).toBe(false)
    } finally {
      if (existsSync(testDir)) rmSync(testDir, { recursive: true })
    }
  })

  it("rejects invalid JSON", async () => {
    const testDir = join(tmpdir(), `cursor-test-${Date.now()}`)
    const cursorDir = join(testDir, ".cursor")
    const configPath = join(cursorDir, "mcp.json")

    try {
      mkdirSync(cursorDir, { recursive: true })
      writeFileSync(configPath, "{ invalid json")

      const result = await extractor.discover(testDir)

      const projectConfig = result.find(c => c.configPath === configPath)
      expect(projectConfig?.exists).toBe(false)
    } finally {
      if (existsSync(testDir)) rmSync(testDir, { recursive: true })
    }
  })

  it("discovers user-level config if it exists", async () => {
    // This test is environment-dependent (requires actual ~/.cursor/mcp.json)
    // Just verify structure is returned
    const testDir = join(tmpdir(), `cursor-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })

    try {
      const result = await extractor.discover(testDir)

      // Should have at least project-level config
      expect(result.length).toBeGreaterThanOrEqual(1)

      // May have user-level config (if home is resolvable)
      const userConfig = result.find(c => c.configPath.includes(".cursor") && !c.configPath.includes(testDir))
      if (userConfig) {
        expect(userConfig.priority).toBe("P0")
        expect(userConfig.kind).toBe("cursor-mcp-config")
      }
    } finally {
      if (existsSync(testDir)) rmSync(testDir, { recursive: true })
    }
  })

  it("does not duplicate project and user paths if they are the same", async () => {
    const testDir = join(tmpdir(), `cursor-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })

    try {
      const result = await extractor.discover(testDir)

      const paths = result.map(c => c.configPath)
      const uniquePaths = new Set(paths)

      // No duplicate paths
      expect(paths.length).toBe(uniquePaths.size)
    } finally {
      if (existsSync(testDir)) rmSync(testDir, { recursive: true })
    }
  })
})
