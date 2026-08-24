import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { ClaudeDesktopExtractor } from "../../src/extractors/claude-desktop.js"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

/**
 * Isolate agent home paths to prevent reading the developer's real configs.
 *
 * WHY: ClaudeDesktopExtractor calls getAppDataDir(), which reads APPDATA
 * (Windows), HOME/USERPROFILE (macOS/Linux), and XDG_CONFIG_HOME (Linux).
 * Without isolation, tests stat the developer's real Claude Desktop config and
 * pass vacuously (if present) or fail unpredictably (if absent). This is a
 * privacy leak and a source of flakiness.
 */
function isolateAgentHome(dir: string): () => void {
  const keys = ["HOME", "USERPROFILE", "APPDATA", "XDG_CONFIG_HOME"] as const
  const saved = new Map(keys.map(k => [k, process.env[k]]))

  process.env.HOME = dir
  process.env.USERPROFILE = dir
  process.env.APPDATA = dir
  process.env.XDG_CONFIG_HOME = dir

  return () => {
    for (const [k, v] of saved) {
      if (v !== undefined) process.env[k] = v
      else delete process.env[k]
    }
  }
}

describe("ClaudeDesktopExtractor", () => {
  let testDir: string
  let restore: () => void

  beforeEach(() => {
    testDir = join(tmpdir(), `calllint-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    mkdirSync(testDir, { recursive: true })
    restore = isolateAgentHome(testDir)
  })

  afterEach(() => {
    restore()
    try {
      rmSync(testDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

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

  /**
   * Path getAppDataDir() resolves to, given every home var points at testDir.
   * Mirrors BaseAgentExtractor.getAppDataDir()'s platform branches.
   */
  function expectedConfigPath(): string {
    const appData =
      process.platform === "darwin" ? join(testDir, "Library", "Application Support") : testDir
    return join(appData, "Claude", "claude_desktop_config.json")
  }

  function writeConfig(content: string): void {
    const path = expectedConfigPath()
    mkdirSync(join(path, ".."), { recursive: true })
    writeFileSync(path, content)
  }

  describe("exists reflects the config on disk", () => {
    it("is false when no config file is present", async () => {
      const result = await extractor.discover("/test")

      expect(result[0]!.exists).toBe(false)
    })

    it("is true for a config containing mcpServers", async () => {
      writeConfig(JSON.stringify({ mcpServers: { demo: { command: "node" } } }))

      const result = await extractor.discover("/test")

      expect(result[0]!.configPath).toBe(expectedConfigPath())
      expect(result[0]!.exists).toBe(true)
    })

    it("is true for a config whose mcpServers is empty", async () => {
      // An installed-but-empty config is still a real config. Treating it as
      // absent would hide a host the user actually has.
      writeConfig(JSON.stringify({ mcpServers: {} }))

      expect((await extractor.discover("/test"))[0]!.exists).toBe(true)
    })

    it("is false for valid JSON without an mcpServers key", async () => {
      writeConfig(JSON.stringify({ theme: "dark" }))

      expect((await extractor.discover("/test"))[0]!.exists).toBe(false)
    })

    it("is false for malformed JSON", async () => {
      writeConfig("{ not json")

      expect((await extractor.discover("/test"))[0]!.exists).toBe(false)
    })

    it("is false when the path is a directory, not a file", async () => {
      mkdirSync(expectedConfigPath(), { recursive: true })

      expect((await extractor.discover("/test"))[0]!.exists).toBe(false)
    })
  })

  it("returns no configs when the app data dir cannot be resolved", async () => {
    // Windows-only: getAppDataDir() throws without APPDATA, and discover()
    // swallows it into an empty result rather than crashing the scan.
    if (process.platform !== "win32") return

    delete process.env.APPDATA

    expect(await extractor.discover("/test")).toEqual([])
  })
})
