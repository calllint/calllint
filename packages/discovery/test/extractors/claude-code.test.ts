import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { ClaudeCodeExtractor } from "../../src/extractors/claude-code.js"
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

/**
 * Isolate agent home paths to prevent reading the developer's real configs.
 *
 * WHY: ClaudeCodeExtractor calls getAppDataDir(), which reads APPDATA
 * (Windows), HOME/USERPROFILE (macOS/Linux), and XDG_CONFIG_HOME (Linux).
 * Without isolation, user-level config tests would stat the developer's real
 * Claude Code config and pass/fail unpredictably based on the developer's
 * machine state. This is a privacy leak and a source of flakiness.
 */
function isolateAgentHome(dir: string): () => void {
  const keys = ["HOME", "USERPROFILE", "APPDATA", "XDG_CONFIG_HOME"] as const
  const saved = new Map(keys.map(k => [k, process.env[k]]))

  // Remove all four vars to prevent cross-platform leakage
  for (const k of keys) {
    delete process.env[k]
  }

  // Set only platform-relevant vars to avoid triggering wrong branches
  const platform = process.platform
  if (platform === "win32") {
    process.env.APPDATA = dir
    process.env.USERPROFILE = dir
  } else if (platform === "darwin") {
    process.env.HOME = dir
  } else {
    // Linux
    process.env.HOME = dir
    process.env.XDG_CONFIG_HOME = `${dir}/.config`
  }

  return () => {
    for (const [k, v] of saved) {
      if (v !== undefined) process.env[k] = v
      else delete process.env[k]
    }
  }
}

describe("ClaudeCodeExtractor", () => {
  let testDir: string
  let restore: () => void

  beforeEach(() => {
    testDir = join(tmpdir(), `calllint-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    mkdirSync(testDir, { recursive: true })
    restore = isolateAgentHome(testDir)
  })

  afterEach(() => {
    restore()
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
  })

  const extractor = new ClaudeCodeExtractor()

  it("has correct agent type and priority", () => {
    expect(extractor.agentType).toBe("claude-code")
    expect(extractor.priority).toBe("P0")
  })

  it("discovers project-level config when it exists", async () => {
    const claudeDir = join(testDir, ".claude")
    const configPath = join(claudeDir, "settings.json")

    mkdirSync(claudeDir, { recursive: true })
    writeFileSync(configPath, JSON.stringify({ mcpServers: {} }))

    const result = await extractor.discover(testDir)

    const projectConfig = result.find(c => c.configPath === configPath)
    expect(projectConfig).toBeDefined()
    expect(projectConfig?.exists).toBe(true)
    expect(projectConfig?.kind).toBe("claude-settings")
  })

  it("marks project config as non-existent when missing", async () => {
    const result = await extractor.discover(testDir)

    // Find the project-level config (contains testDir path)
    const projectConfig = result.find(c => c.configPath.includes(testDir))
    expect(projectConfig).toBeDefined()
    expect(projectConfig?.exists).toBe(false)
  })

  it("rejects configs without mcpServers key", async () => {
    const claudeDir = join(testDir, ".claude")
    const configPath = join(claudeDir, "settings.json")

    mkdirSync(claudeDir, { recursive: true })
    writeFileSync(configPath, JSON.stringify({ otherSettings: {} }))

    const result = await extractor.discover(testDir)

    const projectConfig = result.find(c => c.configPath === configPath)
    expect(projectConfig?.exists).toBe(false)
  })

  it("does not duplicate paths", async () => {
    const result = await extractor.discover(testDir)

    const paths = result.map(c => c.configPath)
    const uniquePaths = new Set(paths)

    expect(paths.length).toBe(uniquePaths.size)
  })

  /**
   * User-level config path on this platform, given every home var = testDir.
   * Mirrors ClaudeCodeExtractor.getUserConfigPath() + getAppDataDir().
   */
  function userConfigPath(): string {
    const platform = process.platform
    let appData: string
    if (platform === "win32") {
      appData = testDir // APPDATA is set to testDir
    } else if (platform === "darwin") {
      appData = join(testDir, "Library", "Application Support")
    } else {
      // Linux: XDG_CONFIG_HOME is set to testDir/.config by isolateAgentHome
      appData = join(testDir, ".config")
    }
    return join(appData, "Claude", "settings.json")
  }

  function writeUserConfig(content: string): void {
    const path = userConfigPath()
    mkdirSync(join(path, ".."), { recursive: true })
    writeFileSync(path, content)
  }

  describe("user-level config discovery", () => {
    it("discovers both project-level and user-level config paths", async () => {
      const result = await extractor.discover(testDir)

      // Exactly 2: project + user
      expect(result).toHaveLength(2)

      const projectConfig = result.find(c => c.configPath.includes(".claude"))
      const userConfig = result.find(c => c.configPath === userConfigPath())

      expect(projectConfig).toBeDefined()
      expect(userConfig).toBeDefined()
      expect(userConfig?.priority).toBe("P0")
      expect(userConfig?.kind).toBe("claude-settings")
    })

    it("marks user-level config as absent when the file does not exist", async () => {
      const result = await extractor.discover(testDir)
      const userConfig = result.find(c => c.configPath === userConfigPath())

      expect(userConfig?.exists).toBe(false)
    })

    it("marks user-level config as present when it exists with mcpServers", async () => {
      writeUserConfig(JSON.stringify({ mcpServers: { demo: { command: "node" } } }))

      const result = await extractor.discover(testDir)
      const userConfig = result.find(c => c.configPath === userConfigPath())

      expect(userConfig?.exists).toBe(true)
    })

    it("accepts user-level config with empty mcpServers", async () => {
      writeUserConfig(JSON.stringify({ mcpServers: {} }))

      const result = await extractor.discover(testDir)

      expect(result.find(c => c.configPath === userConfigPath())?.exists).toBe(true)
    })

    it("rejects user-level config without mcpServers key", async () => {
      writeUserConfig(JSON.stringify({ theme: "dark" }))

      const result = await extractor.discover(testDir)

      expect(result.find(c => c.configPath === userConfigPath())?.exists).toBe(false)
    })

    it("rejects malformed JSON in user-level config", async () => {
      writeUserConfig("{ not json")

      const result = await extractor.discover(testDir)

      expect(result.find(c => c.configPath === userConfigPath())?.exists).toBe(false)
    })
  })
})
