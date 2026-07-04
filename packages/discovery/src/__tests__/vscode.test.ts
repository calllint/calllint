import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { VSCodeExtractor } from "../extractors/vscode.js"
import { registry } from "../registry.js"
import { join } from "node:path"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"

describe("VSCodeExtractor", () => {
  let testDir: string
  let appDataDir: string
  const extractor = new VSCodeExtractor()

  beforeEach(() => {
    // Create temp directory for tests
    testDir = join(tmpdir(), `calllint-test-vscode-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })

    // Mock APPDATA directory structure
    appDataDir = join(testDir, "AppData", "Roaming")
    mkdirSync(join(appDataDir, "Code", "User"), { recursive: true })

    // Override getAppDataDir for testing
    // @ts-ignore - accessing protected method for testing
    extractor.getAppDataDir = () => appDataDir
  })

  afterEach(() => {
    // Cleanup
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  it("should have correct agent type", () => {
    expect(extractor.agentType).toBe("vscode")
  })

  it("should have P1 priority", () => {
    expect(extractor.priority).toBe("P1")
  })

  it("should discover user-level config path", () => {
    const configs = extractor.discover("/fake/cwd")

    expect(configs).toHaveLength(1)
    expect(configs[0]!.agentType).toBe("vscode")
    expect(configs[0]!.configPath).toContain("Code")
    expect(configs[0]!.configPath).toContain("User")
    expect(configs[0]!.configPath).toContain("mcp.json")
    expect(configs[0]!.kind).toBe("vscode-mcp-config")
    expect(configs[0]!.priority).toBe("P1")
  })

  it("should mark config as not existing when file is missing", () => {
    const configs = extractor.discover("/fake/cwd")

    expect(configs).toHaveLength(1)
    expect(configs[0]!.exists).toBe(false)
  })

  it("should mark config as existing when valid file is present", () => {
    const configPath = join(appDataDir, "Code", "User", "mcp.json")
    const validConfig = {
      mcpServers: {
        "test-server": {
          command: "node",
          args: ["server.js"],
        },
      },
    }

    writeFileSync(configPath, JSON.stringify(validConfig, null, 2))

    const configs = extractor.discover("/fake/cwd")

    expect(configs).toHaveLength(1)
    expect(configs[0]!.exists).toBe(true)
  })

  it("should mark config as not existing when file has no mcpServers key", () => {
    const configPath = join(appDataDir, "Code", "User", "mcp.json")
    const invalidConfig = {
      someOtherKey: "value",
    }

    writeFileSync(configPath, JSON.stringify(invalidConfig, null, 2))

    const configs = extractor.discover("/fake/cwd")

    expect(configs).toHaveLength(1)
    expect(configs[0]!.exists).toBe(false)
  })

  it("should mark config as not existing when file is not valid JSON", () => {
    const configPath = join(appDataDir, "Code", "User", "mcp.json")
    writeFileSync(configPath, "not valid json{")

    const configs = extractor.discover("/fake/cwd")

    expect(configs).toHaveLength(1)
    expect(configs[0]!.exists).toBe(false)
  })

  it("should mark config as not existing when mcpServers is null", () => {
    const configPath = join(appDataDir, "Code", "User", "mcp.json")
    const invalidConfig = {
      mcpServers: null,
    }

    writeFileSync(configPath, JSON.stringify(invalidConfig, null, 2))

    const configs = extractor.discover("/fake/cwd")

    expect(configs).toHaveLength(1)
    expect(configs[0]!.exists).toBe(false)
  })

  it("should accept empty mcpServers object", () => {
    const configPath = join(appDataDir, "Code", "User", "mcp.json")
    const validConfig = {
      mcpServers: {},
    }

    writeFileSync(configPath, JSON.stringify(validConfig, null, 2))

    const configs = extractor.discover("/fake/cwd")

    expect(configs).toHaveLength(1)
    expect(configs[0]!.exists).toBe(true)
  })
})
