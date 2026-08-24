import { describe, it, expect } from "vitest"
import { CodexExtractor } from "../../extractors/codex.js"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("CodexExtractor", () => {
  const extractor = new CodexExtractor()

  it("has correct metadata", () => {
    expect(extractor.agentType).toBe("codex")
    expect(extractor.priority).toBe("P2")
  })

  it("discovers mcp_servers from OpenAI Codex config.toml", async () => {
    // Positive fixture: codex TOML with mcpServers section
    const fixture = join(tmpdir(), `codex-pos-${Date.now()}`)
    mkdirSync(fixture, { recursive: true })
    const configPath = join(fixture, ".codex", "config.toml")
    mkdirSync(join(fixture, ".codex"), { recursive: true })
    writeFileSync(
      configPath,
      `[mcpServers.calllint]
command = "npx"
args = ["-y", "@calllint/calllint-mcp"]
enabled = true
`,
    )

    try {
      const configs = await extractor.discover(fixture)
      expect(configs).toHaveLength(1)
      expect(configs[0]).toMatchObject({
        agentType: "codex",
        filePath: configPath,
        targetKind: "mcp_server",
        targetName: "calllint",
        command: "npx",
        args: ["-y", "@calllint/calllint-mcp"],
        autoApprove: true,
      })
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  it("discovers servers with no args array", async () => {
    const fixture = join(tmpdir(), `codex-args-${Date.now()}`)
    mkdirSync(fixture, { recursive: true })
    const configPath = join(fixture, ".codex", "config.toml")
    mkdirSync(join(fixture, ".codex"), { recursive: true })
    writeFileSync(
      configPath,
      `[mcpServers.standalone]
command = "/usr/bin/server"
`,
    )

    try {
      const configs = await extractor.discover(fixture)
      expect(configs).toHaveLength(1)
      expect(configs[0]!.args).toBeUndefined()
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  it("returns empty when config.toml is absent (NC-A)", async () => {
    const fixture = join(tmpdir(), `codex-nc-a-${Date.now()}`)
    mkdirSync(fixture, { recursive: true })

    try {
      const configs = await extractor.discover(fixture)
      expect(configs).toEqual([])
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  it("returns empty when mcpServers section is absent (NC-B)", async () => {
    const fixture = join(tmpdir(), `codex-nc-b-${Date.now()}`)
    mkdirSync(fixture, { recursive: true })
    const configPath = join(fixture, ".codex", "config.toml")
    mkdirSync(join(fixture, ".codex"), { recursive: true })
    writeFileSync(
      configPath,
      `[otherSection]
foo = "bar"
`,
    )

    try {
      const configs = await extractor.discover(fixture)
      expect(configs).toEqual([])
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  it("returns empty when command is absent (NC-C)", async () => {
    const fixture = join(tmpdir(), `codex-nc-c-${Date.now()}`)
    mkdirSync(fixture, { recursive: true })
    const configPath = join(fixture, ".codex", "config.toml")
    mkdirSync(join(fixture, ".codex"), { recursive: true })
    writeFileSync(
      configPath,
      `[mcpServers.broken]
args = ["--flag"]
`,
    )

    try {
      const configs = await extractor.discover(fixture)
      expect(configs).toEqual([])
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })
})
