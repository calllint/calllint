import { describe, it, expect } from "vitest"
import { CodexExtractor } from "../../src/extractors/codex.js"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * CodexExtractor — the repo's first TOML harness.
 *
 * Two properties make this extractor's negative controls different from the JSON ones:
 *
 *  1. `discover()` always returns BOTH candidate paths (user-level `~/.codex/config.toml`
 *     and project-level `.codex/config.toml`). Absence is reported as `exists: false`, never
 *     as an empty array — so "returns empty when the file is missing" would be the wrong
 *     assertion, and a test written that way would pass for the wrong reason.
 *
 *  2. The TOML key is `mcp_servers` (snake_case), not the JSON harnesses' `mcpServers`.
 *     A config carrying only the camelCase spelling is a Codex config that registers
 *     nothing, and must read as `exists: false`. NC-C pins exactly that, because the
 *     camelCase spelling is the plausible mistake here.
 */
describe("CodexExtractor", () => {
  const extractor = new CodexExtractor()

  it("has correct metadata", () => {
    expect(extractor.agentType).toBe("codex")
    expect(extractor.priority).toBe("P2")
  })

  it("discovers project-level config.toml when it has an mcp_servers table", () => {
    const testDir = join(tmpdir(), `codex-test-${Date.now()}`)
    const configPath = join(testDir, ".codex", "config.toml")

    try {
      mkdirSync(join(testDir, ".codex"), { recursive: true })
      writeFileSync(
        configPath,
        '[mcp_servers.doc-trace-hub]\ncommand = "node"\nargs = ["server.mjs"]\n',
      )

      const result = extractor.discover(testDir)
      const projectConfig = result.find((c) => c.configPath === configPath)

      expect(projectConfig).toBeDefined()
      expect(projectConfig?.exists).toBe(true)
      expect(projectConfig?.kind).toBe("codex-mcp")
    } finally {
      if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
    }
  })

  it("marks project config as non-existent when the file is missing (NC-A)", () => {
    const testDir = join(tmpdir(), `codex-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })

    try {
      const result = extractor.discover(testDir)
      const projectConfig = result.find((c) => c.configPath.includes(testDir))

      expect(projectConfig).toBeDefined()
      expect(projectConfig?.exists).toBe(false)
    } finally {
      if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
    }
  })

  it("marks config as non-existent when mcp_servers section is absent (NC-B)", () => {
    const testDir = join(tmpdir(), `codex-test-${Date.now()}`)
    const configPath = join(testDir, ".codex", "config.toml")

    try {
      mkdirSync(join(testDir, ".codex"), { recursive: true })
      // Valid TOML, but a Codex config that has never registered a server.
      writeFileSync(configPath, '[history]\npersistence = "save-all"\n')

      const result = extractor.discover(testDir)
      const projectConfig = result.find((c) => c.configPath === configPath)

      expect(projectConfig).toBeDefined()
      expect(projectConfig?.exists).toBe(false)
    } finally {
      if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
    }
  })

  it("does NOT accept the JSON harnesses' camelCase mcpServers spelling (NC-C)", () => {
    const testDir = join(tmpdir(), `codex-test-${Date.now()}`)
    const configPath = join(testDir, ".codex", "config.toml")

    try {
      mkdirSync(join(testDir, ".codex"), { recursive: true })
      // Parses as TOML, but Codex reads `mcp_servers`. camelCase registers nothing,
      // so treating this as a target would claim a server that Codex never loads.
      writeFileSync(configPath, '[mcpServers.calllint]\ncommand = "npx"\n')

      const result = extractor.discover(testDir)
      const projectConfig = result.find((c) => c.configPath === configPath)

      expect(projectConfig).toBeDefined()
      expect(projectConfig?.exists).toBe(false)
    } finally {
      if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
    }
  })

  it("returns both the user-level and project-level candidate paths (NC-D)", () => {
    // The shape assertion the other NCs depend on: if discover() ever returned only
    // one path, `result.find(...)` above could pass while silently testing nothing.
    const testDir = join(tmpdir(), `codex-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })

    try {
      const result = extractor.discover(testDir)
      expect(result).toHaveLength(2)
      expect(result.some((c) => c.configPath.includes(testDir))).toBe(true)
      expect(result.every((c) => c.configPath.endsWith("config.toml"))).toBe(true)
    } finally {
      if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
    }
  })
})
