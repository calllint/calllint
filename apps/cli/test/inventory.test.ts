import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { inventoryCommand } from "../src/commands/inventory.js"
import { scanCommand } from "../src/commands/scan.js"
import { parseArgs } from "../src/args.js"

describe("inventory command", () => {
  let testDir: string
  let originalHome: string | undefined
  let originalUserProfile: string | undefined

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "calllint-test-"))
    // Mock HOME/USERPROFILE to isolate from user's real configs
    originalHome = process.env.HOME
    originalUserProfile = process.env.USERPROFILE
    process.env.HOME = testDir
    process.env.USERPROFILE = testDir
  })

  afterEach(() => {
    // Restore original env vars
    if (originalHome !== undefined) process.env.HOME = originalHome
    else delete process.env.HOME
    if (originalUserProfile !== undefined) process.env.USERPROFILE = originalUserProfile
    else delete process.env.USERPROFILE

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
  let originalHome: string | undefined
  let originalUserProfile: string | undefined

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "calllint-test-"))
    originalHome = process.env.HOME
    originalUserProfile = process.env.USERPROFILE
    process.env.HOME = testDir
    process.env.USERPROFILE = testDir
  })

  afterEach(() => {
    if (originalHome !== undefined) process.env.HOME = originalHome
    else delete process.env.HOME
    if (originalUserProfile !== undefined) process.env.USERPROFILE = originalUserProfile
    else delete process.env.USERPROFILE

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
  let originalHome: string | undefined
  let originalUserProfile: string | undefined

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "calllint-test-"))
    originalHome = process.env.HOME
    originalUserProfile = process.env.USERPROFILE
    process.env.HOME = testDir
    process.env.USERPROFILE = testDir
  })

  afterEach(() => {
    if (originalHome !== undefined) process.env.HOME = originalHome
    else delete process.env.HOME
    if (originalUserProfile !== undefined) process.env.USERPROFILE = originalUserProfile
    else delete process.env.USERPROFILE

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
