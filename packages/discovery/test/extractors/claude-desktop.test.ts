import { describe, it, expect } from "vitest"
import { ClaudeDesktopExtractor } from "../../src/extractors/claude-desktop.js"

describe("ClaudeDesktopExtractor", () => {
  const extractor = new ClaudeDesktopExtractor()

  it("has correct agent type and priority", () => {
    expect(extractor.agentType).toBe("claude-desktop")
    expect(extractor.priority).toBe("P0")
  })

  it("returns user-level config only (no project-level)", async () => {
    const result = await extractor.discover("/any/project/path")

    // Claude Desktop only has user-level config
    expect(result.length).toBe(1)

    const config = result[0]!
    expect(config.agentType).toBe("claude-desktop")
    expect(config.priority).toBe("P0")
    expect(config.kind).toBe("claude-settings")

    // Path should be platform-specific user config
    expect(config.configPath).toContain("Claude")
    expect(config.configPath).toContain("claude_desktop_config.json")
  })

  it("resolves platform-specific user config path", async () => {
    const result = await extractor.discover("/test")

    const config = result[0]!
    const platform = process.platform

    if (platform === "win32") {
      // Windows: %APPDATA%\Claude\claude_desktop_config.json
      expect(config.configPath).toContain("Claude")
      expect(config.configPath).toContain("claude_desktop_config.json")
    } else if (platform === "darwin") {
      // macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
      expect(config.configPath).toContain("Library")
      expect(config.configPath).toContain("Application Support")
      expect(config.configPath).toContain("Claude")
    } else {
      // Linux: ~/.config/Claude/claude_desktop_config.json
      expect(config.configPath).toContain(".config")
      expect(config.configPath).toContain("Claude")
    }
  })

  it("checks if user config actually exists", async () => {
    const result = await extractor.discover("/test")

    const config = result[0]!

    // exists should be boolean (either true or false)
    expect(typeof config.exists).toBe("boolean")

    // If it exists, it should be a valid config with mcpServers
    // If not, exists should be false
    // (We can't control whether user has Claude Desktop installed)
  })
})
