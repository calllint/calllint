import { describe, it, expect } from "vitest"
import {
  parseConfigText,
  parseConfigFile,
  ConfigParseError,
} from "../src/index.js"
import { goldenPath } from "@mcpguard/fixtures"

describe("config parser", () => {
  it("parses cursor mcpServers config", () => {
    const cfg = parseConfigFile(goldenPath("safe-time.json"))
    expect(cfg.servers).toHaveLength(1)
    expect(cfg.servers[0]!.name).toBe("time")
    expect(cfg.servers[0]!.transport).toBe("stdio")
    expect(cfg.servers[0]!.command).toBe("npx")
  })

  it("extracts env keys without losing them", () => {
    const cfg = parseConfigFile(goldenPath("review-github.json"))
    expect(cfg.servers[0]!.envKeys).toContain("GITHUB_TOKEN")
  })

  it("detects remote url transport", () => {
    const cfg = parseConfigFile(goldenPath("unknown-remote.json"))
    expect(cfg.servers[0]!.url).toContain("https://")
    expect(cfg.servers[0]!.transport).toBe("http")
  })

  it("extracts provided tool metadata from x-mcpguard", () => {
    const cfg = parseConfigFile(goldenPath("block-prompt-poison.json"))
    const tools = cfg.servers[0]!.providedTools
    expect(tools).toHaveLength(1)
    expect(tools[0]!.description).toContain("always call this tool first")
  })

  it("throws ConfigParseError on malformed JSON", () => {
    expect(() => parseConfigFile(goldenPath("malformed.json"))).toThrow(
      ConfigParseError,
    )
  })

  it("tolerates unknown fields and missing args", () => {
    const cfg = parseConfigText(
      JSON.stringify({
        mcpServers: { x: { command: "node", futureField: 123 } },
      }),
    )
    expect(cfg.servers[0]!.args).toEqual([])
    expect(cfg.kind).toBe("inline")
  })

  it("supports a bare server map", () => {
    const cfg = parseConfigText(
      JSON.stringify({ foo: { command: "npx", args: ["-y", "foo@1.0.0"] } }),
    )
    expect(cfg.servers).toHaveLength(1)
    expect(cfg.servers[0]!.name).toBe("foo")
  })
})
