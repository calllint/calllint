import { describe, it, expect } from "vitest"
import { ClaudeCodeExtractor } from "../../src/extractors/claude-code.js"
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

describe("ClaudeCodeExtractor", () => {
  const extractor = new ClaudeCodeExtractor()

  it("has correct agent type and priority", () => {
    expect(extractor.agentType).toBe("claude-code")
    expect(extractor.priority).toBe("P0")
  })

  it("discovers project-level config when it exists", async () => {
    const testDir = join(tmpdir(), `claude-code-test-${Date.now()}`)
    const claudeDir = join(testDir, ".claude")
    const configPath = join(claudeDir, "settings.json")

    try {
      mkdirSync(claudeDir, { recursive: true })
      writeFileSync(configPath, JSON.stringify({ mcpServers: {} }))

      const result = await extractor.discover(testDir)

      const projectConfig = result.find(c => c.configPath === configPath)
      expect(projectConfig).toBeDefined()
      expect(projectConfig?.exists).toBe(true)
      expect(projectConfig?.kind).toBe("claude-settings")
    } finally {
      if (existsSync(testDir)) rmSync(testDir, { recursive: true })
    }
  })

  it("marks project config as non-existent when missing", async () => {
    const testDir = join(tmpdir(), `claude-code-test-${Date.now()}`)
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
    const testDir = join(tmpdir(), `claude-code-test-${Date.now()}`)
    const claudeDir = join(testDir, ".claude")
    const configPath = join(claudeDir, "settings.json")

    try {
      mkdirSync(claudeDir, { recursive: true })
      writeFileSync(configPath, JSON.stringify({ otherSettings: {} }))

      const result = await extractor.discover(testDir)

      const projectConfig = result.find(c => c.configPath === configPath)
      expect(projectConfig?.exists).toBe(false)
    } finally {
      if (existsSync(testDir)) rmSync(testDir, { recursive: true })
    }
  })

  it("discovers user-level config structure", async () => {
    const testDir = join(tmpdir(), `claude-code-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })

    try {
      const result = await extractor.discover(testDir)

      // Should have at least project-level config
      expect(result.length).toBeGreaterThanOrEqual(1)

      // May have user-level config (platform-specific)
      const userConfig = result.find(c =>
        c.configPath.includes("Claude") &&
        c.configPath.includes("settings.json") &&
        !c.configPath.includes(testDir)
      )

      if (userConfig) {
        expect(userConfig.priority).toBe("P0")
        expect(userConfig.kind).toBe("claude-settings")
      }
    } finally {
      if (existsSync(testDir)) rmSync(testDir, { recursive: true })
    }
  })

  it("does not duplicate paths", async () => {
    const testDir = join(tmpdir(), `claude-code-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })

    try {
      const result = await extractor.discover(testDir)

      const paths = result.map(c => c.configPath)
      const uniquePaths = new Set(paths)

      expect(paths.length).toBe(uniquePaths.size)
    } finally {
      if (existsSync(testDir)) rmSync(testDir, { recursive: true })
    }
  })
})
