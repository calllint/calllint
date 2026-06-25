import { describe, it, expect } from "vitest"
import {
  parseConfigText,
  parseConfigFile,
  ConfigParseError,
  buildPositionIndex,
} from "../src/index.js"
import { goldenPath } from "@calllint/fixtures"

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

  it("extracts provided tool metadata from x-calllint", () => {
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

  it("attaches a position index to the parsed config", () => {
    const cfg = parseConfigText(
      JSON.stringify({ mcpServers: { fs: { command: "npx" } } }, null, 2),
    )
    expect(cfg.positions["mcpServers.fs.command"]).toBeDefined()
  })
})

describe("buildPositionIndex", () => {
  it("records 1-based line/column of nested keys", () => {
    const text = [
      "{",
      '  "mcpServers": {',
      '    "fs": {',
      '      "command": "npx",',
      '      "args": ["-y", "x", "/"]',
      "    }",
      "  }",
      "}",
    ].join("\n")
    const idx = buildPositionIndex(text)
    // "args" is on line 5; its key quote is at column 7 (1-based).
    expect(idx["mcpServers.fs.args"]).toEqual({ line: 5, column: 7 })
    expect(idx["mcpServers.fs.command"]).toEqual({ line: 4, column: 7 })
    expect(idx["mcpServers.fs"]!.line).toBe(3)
  })

  it("locates keys across multiple servers independently", () => {
    const text = JSON.stringify(
      {
        mcpServers: {
          a: { command: "node" },
          b: { command: "npx", args: ["x"] },
        },
      },
      null,
      2,
    )
    const idx = buildPositionIndex(text)
    expect(idx["mcpServers.a.command"]).toBeDefined()
    expect(idx["mcpServers.b.args"]).toBeDefined()
    // distinct servers get distinct positions
    expect(idx["mcpServers.a.command"]!.line).not.toBe(
      idx["mcpServers.b.args"]!.line,
    )
  })

  it("returns undefined for a key that is not present", () => {
    const idx = buildPositionIndex(JSON.stringify({ mcpServers: { x: {} } }))
    expect(idx["mcpServers.x.args"]).toBeUndefined()
  })

  it("is deterministic for the same input", () => {
    const text = JSON.stringify({ mcpServers: { x: { args: ["a"] } } }, null, 2)
    expect(buildPositionIndex(text)).toEqual(buildPositionIndex(text))
  })

  it("is tolerant: returns an object (never throws) on a non-object root", () => {
    expect(buildPositionIndex("[1,2,3]")).toBeTypeOf("object")
    expect(buildPositionIndex("not json")).toEqual({})
  })
})
