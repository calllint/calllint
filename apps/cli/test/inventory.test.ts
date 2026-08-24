import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { inventoryCommand } from "../src/commands/inventory.js"
import { scanCommand } from "../src/commands/scan.js"
import { parseArgs } from "../src/args.js"

/**
 * Point every path an extractor can resolve a user config from at `dir`, and return
 * the undo.
 *
 * WHY APPDATA IS HERE. This helper previously overrode only HOME/USERPROFILE, so
 * `BaseAgentExtractor.getAppDataDir()` — which reads `%APPDATA%` on Windows,
 * `$XDG_CONFIG_HOME` on Linux — still resolved to the DEVELOPER'S OWN machine. The
 * three tests asserting "no configs discovered" passed only because no host happened
 * to have an appData-rooted config file on the machines that ran them. Adding the
 * Cline extractor (whose VS Code extension config lives under globalStorage) walked
 * straight through that hole and turned those tests red — correctly. The escape was
 * real for the VS Code and Claude Desktop extractors too, and this closes it for all
 * of them, not just Cline.
 *
 * DO NOT narrow this back to HOME. A test that reads the developer's real config is
 * both non-deterministic and a privacy leak in CI logs.
 */
function isolateAgentHome(dir: string): () => void {
  const keys = ["HOME", "USERPROFILE", "APPDATA", "XDG_CONFIG_HOME", "CLINE_DATA_DIR"] as const
  const saved = new Map(keys.map(k => [k, process.env[k]]))

  process.env.HOME = dir
  process.env.USERPROFILE = dir
  process.env.APPDATA = dir
  process.env.XDG_CONFIG_HOME = dir
  delete process.env.CLINE_DATA_DIR

  return () => {
    for (const [k, v] of saved) {
      if (v !== undefined) process.env[k] = v
      else delete process.env[k]
    }
  }
}

describe("inventory command", () => {
  let testDir: string
  let restoreEnv: () => void

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "calllint-test-"))
    restoreEnv = isolateAgentHome(testDir)
  })

  afterEach(() => {
    restoreEnv()
    rmSync(testDir, { recursive: true, force: true })
  })

  it("should return exit 0 when no configs found", () => {
    const result = inventoryCommand(parseArgs(["inventory"]), { cwd: testDir })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("No agent configs discovered")
    expect(result.stdout).toContain("Searched agents")
  })

  it("should support --json flag", () => {
    const result = inventoryCommand(parseArgs(["inventory", "--json"]), { cwd: testDir })

    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(json).toHaveProperty("discovered")
    expect(Array.isArray(json.discovered)).toBe(true)
  })

  it("should handle discovery errors gracefully", () => {
    // Pass invalid cwd to trigger error
    const result = inventoryCommand(parseArgs(["inventory"]), { cwd: "/nonexistent-path-12345" })

    // Should still exit 0 with no configs (discovery handles missing dirs gracefully)
    expect(result.exitCode).toBe(0)
  })
})

describe("scan --auto", () => {
  let testDir: string
  let restoreEnv: () => void

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "calllint-test-"))
    restoreEnv = isolateAgentHome(testDir)
  })

  afterEach(() => {
    restoreEnv()
    rmSync(testDir, { recursive: true, force: true })
  })

  it("should error when no configs discovered", () => {
    const result = scanCommand(
      parseArgs(["scan", "--auto"]),
      {
        cwd: testDir,
        readStdin: () => "",
        now: Date.now(),
        generatedAt: new Date().toISOString(),
      }
    )

    expect(result.exitCode).toBe(3) // EXIT.ERROR
    expect(result.stderr).toContain("No agent configs discovered")
  })

  it("should scan discovered configs", () => {
    // Create a mock Cursor config in the isolated test dir
    const cursorDir = join(testDir, ".cursor")
    mkdirSync(cursorDir, { recursive: true })
    const configPath = join(cursorDir, "mcp.json")
    writeFileSync(configPath, JSON.stringify({ mcpServers: {} }))

    const result = scanCommand(
      parseArgs(["scan", "--auto"]),
      {
        cwd: testDir,
        readStdin: () => "",
        now: Date.now(),
        generatedAt: new Date().toISOString(),
      }
    )

    // Should scan successfully (empty config = SAFE)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("SAFE")
  })

  it("should support --json flag", () => {
    const cursorDir = join(testDir, ".cursor")
    mkdirSync(cursorDir, { recursive: true })
    writeFileSync(join(cursorDir, "mcp.json"), JSON.stringify({ mcpServers: {} }))

    const result = scanCommand(
      parseArgs(["scan", "--auto", "--json"]),
      {
        cwd: testDir,
        readStdin: () => "",
        now: Date.now(),
        generatedAt: new Date().toISOString(),
      }
    )

    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(Array.isArray(json)).toBe(true)
  })
})

describe("scan --agent", () => {
  let testDir: string
  let restoreEnv: () => void

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "calllint-test-"))
    restoreEnv = isolateAgentHome(testDir)
  })

  afterEach(() => {
    restoreEnv()
    rmSync(testDir, { recursive: true, force: true })
  })

  it("should error when agent type not found", () => {
    const result = scanCommand(
      parseArgs(["scan", "--agent", "cursor"]),
      {
        cwd: testDir,
        readStdin: () => "",
        now: Date.now(),
        generatedAt: new Date().toISOString(),
      }
    )

    expect(result.exitCode).toBe(3) // EXIT.ERROR
    expect(result.stderr).toContain("No config found for agent")
  })

  it("should scan specific agent config", () => {
    const cursorDir = join(testDir, ".cursor")
    mkdirSync(cursorDir, { recursive: true })
    writeFileSync(join(cursorDir, "mcp.json"), JSON.stringify({ mcpServers: {} }))

    const result = scanCommand(
      parseArgs(["scan", "--agent", "cursor"]),
      {
        cwd: testDir,
        readStdin: () => "",
        now: Date.now(),
        generatedAt: new Date().toISOString(),
      }
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("SAFE")
  })

  it("should only scan specified agent type", () => {
    // Create both Cursor and Claude Code configs
    const cursorDir = join(testDir, ".cursor")
    mkdirSync(cursorDir, { recursive: true })
    writeFileSync(join(cursorDir, "mcp.json"), JSON.stringify({ mcpServers: {} }))

    const claudeDir = join(testDir, ".claude")
    mkdirSync(claudeDir, { recursive: true })
    writeFileSync(join(claudeDir, "settings.json"), JSON.stringify({ mcpServers: {} }))

    const result = scanCommand(
      parseArgs(["scan", "--agent", "cursor"]),
      {
        cwd: testDir,
        readStdin: () => "",
        now: Date.now(),
        generatedAt: new Date().toISOString(),
      }
    )

    // Should only scan Cursor (one config) - check it scanned the test dir one
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("calllint-test")
    expect(result.stdout).toContain(".cursor")
  })
})
