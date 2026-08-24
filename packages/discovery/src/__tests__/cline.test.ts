import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { ClineExtractor } from "../extractors/cline.js"
import { join } from "node:path"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"

/**
 * Cline extractor tests.
 *
 * Cline is the case that separates "documented" from "discoverable": it ships a CLI
 * and a VS Code extension with SEPARATE config files, and only the CLI one is
 * documented upstream. Both paths are asserted here, so a future edit that silently
 * drops the undocumented extension path fails rather than degrading quietly.
 */
describe("ClineExtractor", () => {
  let testDir: string
  let homeDir: string
  let appDataDir: string
  let extractor: ClineExtractor
  const savedDataDir = process.env.CLINE_DATA_DIR

  const cliRel = [".cline", "data", "settings", "cline_mcp_settings.json"]
  const extRel = [
    "Code",
    "User",
    "globalStorage",
    "saoudrizwan.claude-dev",
    "settings",
    "cline_mcp_settings.json",
  ]

  beforeEach(() => {
    testDir = join(tmpdir(), `calllint-test-cline-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    homeDir = join(testDir, "home")
    appDataDir = join(testDir, "appdata")
    mkdirSync(join(homeDir, ".cline", "data", "settings"), { recursive: true })
    mkdirSync(join(appDataDir, ...extRel.slice(0, -1)), { recursive: true })

    // CLINE_DATA_DIR must not leak in from the real environment.
    delete process.env.CLINE_DATA_DIR

    extractor = new ClineExtractor()
    // @ts-ignore - overriding protected methods for testing
    extractor.resolveHome = () => homeDir
    // @ts-ignore - overriding protected methods for testing
    extractor.getAppDataDir = () => appDataDir
  })

  afterEach(() => {
    if (savedDataDir === undefined) delete process.env.CLINE_DATA_DIR
    else process.env.CLINE_DATA_DIR = savedDataDir
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
  })

  const cliPath = () => join(homeDir, ...cliRel)
  const extPath = () => join(appDataDir, ...extRel)
  const valid = JSON.stringify({ mcpServers: { demo: { command: "node", args: ["s.js"] } } })

  it("should have correct agent type", () => {
    expect(extractor.agentType).toBe("cline")
  })

  it("should have P2 priority", () => {
    expect(extractor.priority).toBe("P2")
  })

  it("discovers both the CLI and the VS Code extension config path", () => {
    const configs = extractor.discover("/fake/cwd")

    expect(configs).toHaveLength(2)
    expect(configs.map(c => c.configPath)).toEqual([cliPath(), extPath()])
    for (const c of configs) {
      expect(c.agentType).toBe("cline")
      expect(c.kind).toBe("mcp-servers")
      expect(c.priority).toBe("P2")
    }
  })

  it("reports both paths absent when no file is present", () => {
    expect(extractor.discover("/fake/cwd").map(c => c.exists)).toEqual([false, false])
  })

  it("detects a valid CLI config independently of the extension one", () => {
    writeFileSync(cliPath(), valid)

    expect(extractor.discover("/fake/cwd").map(c => c.exists)).toEqual([true, false])
  })

  it("detects a valid extension config independently of the CLI one", () => {
    writeFileSync(extPath(), valid)

    expect(extractor.discover("/fake/cwd").map(c => c.exists)).toEqual([false, true])
  })

  it("honours CLINE_DATA_DIR for the CLI path", () => {
    const relocated = join(testDir, "relocated")
    mkdirSync(join(relocated, "settings"), { recursive: true })
    process.env.CLINE_DATA_DIR = relocated
    writeFileSync(join(relocated, "settings", "cline_mcp_settings.json"), valid)

    const configs = extractor.discover("/fake/cwd")

    expect(configs[0]!.configPath).toBe(join(relocated, "settings", "cline_mcp_settings.json"))
    expect(configs[0]!.exists).toBe(true)
  })

  it("ignores an empty CLINE_DATA_DIR and falls back to the home path", () => {
    process.env.CLINE_DATA_DIR = ""
    writeFileSync(cliPath(), valid)

    const configs = extractor.discover("/fake/cwd")

    expect(configs[0]!.configPath).toBe(cliPath())
    expect(configs[0]!.exists).toBe(true)
  })

  it("accepts an empty mcpServers object — the shape Cline writes on first run", () => {
    writeFileSync(cliPath(), JSON.stringify({ mcpServers: {} }))

    expect(extractor.discover("/fake/cwd")[0]!.exists).toBe(true)
  })

  it("rejects a file with no mcpServers key", () => {
    writeFileSync(cliPath(), JSON.stringify({ someOtherKey: "value" }))

    expect(extractor.discover("/fake/cwd")[0]!.exists).toBe(false)
  })

  it("rejects a null mcpServers", () => {
    writeFileSync(cliPath(), JSON.stringify({ mcpServers: null }))

    expect(extractor.discover("/fake/cwd")[0]!.exists).toBe(false)
  })

  it("rejects a file that is not valid JSON", () => {
    writeFileSync(cliPath(), "not valid json{")

    expect(extractor.discover("/fake/cwd")[0]!.exists).toBe(false)
  })

  it("does not read Cline's server SOURCE directory as a config", () => {
    // ~/Documents/Cline/MCP/ is where Cline installs server code. It is a source
    // tree, not a registration file, and must not appear as a discovered config.
    const paths = extractor.discover("/fake/cwd").map(c => c.configPath)

    expect(paths.some(p => p.includes(join("Documents", "Cline")))).toBe(false)
  })

  it("still returns the extension path when home resolution fails", () => {
    // @ts-ignore - simulating an unresolvable HOME
    extractor.resolveHome = () => {
      throw new Error("no home")
    }

    const configs = extractor.discover("/fake/cwd")

    expect(configs).toHaveLength(1)
    expect(configs[0]!.configPath).toBe(extPath())
  })

  it("still returns the CLI path when appData resolution fails", () => {
    // @ts-ignore - simulating an unresolvable APPDATA
    extractor.getAppDataDir = () => {
      throw new Error("no appdata")
    }

    const configs = extractor.discover("/fake/cwd")

    expect(configs).toHaveLength(1)
    expect(configs[0]!.configPath).toBe(cliPath())
  })
})
