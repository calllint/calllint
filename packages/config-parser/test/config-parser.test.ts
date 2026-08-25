import { describe, it, expect } from "vitest"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
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

  /*
   * TOML dispatch must not depend on WHICH entry point the caller reached.
   *
   * `parseConfigFile` dispatched on `.toml` and `parseConfigText` did not, so the same
   * `~/.codex/config.toml` parsed as TOML through `scanConfigFile` and as JSON through
   * `scanConfigText` — which is the path `scan --agent codex` and `scan --auto` take, since
   * both read the file themselves. Measured 2026-08-25 against a real Codex install: both
   * commands died on `Invalid JSON: Unexpected token a at position 0`. `--auto` is the command
   * `activation.firstSuccessAction` recommends, so every user with Codex installed hit it on
   * CallLint's own suggested first step.
   *
   * The pair is asserted TOGETHER rather than in two independent tests: the defect was never
   * "TOML does not parse" (it did, via `parseConfigFile`), it was the two entry points
   * DISAGREEING. A test per function would have passed throughout — `parseConfigFile` was
   * always correct. Only a comparison could have failed.
   */
  it("parses a Codex TOML config identically through both entry points", () => {
    const toml = [
      "[mcp_servers.doc-trace-hub]",
      'command = "node"',
      "args = ['/srv/server.mjs']",
      "",
      "[mcp_servers.doc-trace-hub.env]",
      "PROJECT_ROOT = '/srv/project'",
    ].join("\n")
    const codexPath = join(tmpdir(), "calllint-codex-test", ".codex", "config.toml")
    mkdirSync(dirname(codexPath), { recursive: true })
    writeFileSync(codexPath, toml, "utf8")

    try {
      const viaText = parseConfigText(toml, codexPath)
      const viaFile = parseConfigFile(codexPath)

      // The claim that matters: same input, same servers, whichever door was used.
      expect(viaText.servers).toEqual(viaFile.servers)

      for (const cfg of [viaText, viaFile]) {
        expect(cfg.kind).toBe("codex-mcp")
        expect(cfg.servers).toHaveLength(1)
        expect(cfg.servers[0]!.name).toBe("doc-trace-hub")
        expect(cfg.servers[0]!.command).toBe("node")
        expect(cfg.servers[0]!.args).toEqual(["/srv/server.mjs"])
        expect(cfg.servers[0]!.envKeys).toContain("PROJECT_ROOT")
      }
    } finally {
      rmSync(dirname(dirname(codexPath)), { recursive: true, force: true })
    }
  })

  /*
   * The converse: `.toml` dispatch must not swallow JSON paths. A path-keyed rule that fired
   * too widely would break every other harness silently, and `parseConfigText`'s default
   * `<inline>` (plus `<stdin>`) carry no extension at all — those must stay JSON.
   */
  it("keeps non-.toml paths on the JSON parser", () => {
    const json = JSON.stringify({ mcpServers: { x: { command: "node" } } })
    expect(parseConfigText(json, "/w/.cursor/mcp.json").servers[0]!.name).toBe("x")
    expect(parseConfigText(json).kind).toBe("inline")
    expect(parseConfigText(json, "<stdin>").servers).toHaveLength(1)
    // TOML through a JSON path is still an error, not a silent reinterpretation.
    expect(() => parseConfigText("[mcp_servers.a]\ncommand = 'node'", "/w/mcp.json")).toThrow(
      ConfigParseError,
    )
  })

  /*
   * OpenCode's launch spec is ONE array, and its env key is spelled `environment`.
   * Verified 2026-08-25 against https://opencode.ai/docs/mcp-servers/ — for `type:
   * "local"`, `command` is typed `array` (required) and `environment` is the env object.
   *
   * WHY THIS IS ASSERTED AS EVIDENCE-SURVIVAL, NOT FIELD-SHAPE. Before the fix,
   * `asString(server.command)` returned undefined on an array and `args` was absent, so
   * an OpenCode server launching `node ./o.js` with an `OC_TOK` credential normalized to
   * `{transport: "unknown", command: undefined, args: [], envKeys: []}`. Measured through
   * the CLI: `calllint scan --agent opencode` → `◇ UNKNOWN / S0 Metadata only`. No
   * verdict was falsified (UNKNOWN is not SAFE), but every exec and credential detector
   * reads `command`/`args`/`envKeys`, so a real local-exec surface reached zero of them.
   * A test on `command === "node"` alone would pass while the risk stayed invisible;
   * these assert the three fields detectors actually consume.
   */
  it("extracts OpenCode's array command and `environment` env keys", () => {
    const cfg = parseConfigText(
      JSON.stringify({
        mcp: {
          "oc-server": {
            type: "local",
            command: ["node", "./o.js", "--port", "7000"],
            environment: { OC_TOK: "x" },
          },
        },
      }),
      "/w/opencode/opencode.json",
    )
    expect(cfg.kind).toBe("opencode-mcp")
    const s = cfg.servers[0]!
    expect(s.name).toBe("oc-server")
    // head is the executable, tail becomes args — the shape every detector reads.
    expect(s.command).toBe("node")
    expect(s.args).toEqual(["./o.js", "--port", "7000"])
    expect(s.transport).toBe("stdio") // was "unknown": an array command is still stdio
    expect(s.envKeys).toContain("OC_TOK")
  })

  /*
   * Negative controls for the same change. An array-reading relaxation must not (a) alter
   * the string-command shape every other harness uses, (b) half-salvage a malformed
   * array — a launch spec understood in part is worse evidence than one openly not
   * understood, since a detector cannot tell which part is missing — or (c) let a config
   * split one key across both env spellings and rely on merge order to slip it past
   * review.
   */
  it("leaves string commands, malformed arrays and both env spellings unchanged", () => {
    // (a) the near-universal string+args shape is untouched
    const str = parseConfigText(
      JSON.stringify({ mcpServers: { a: { command: "npx", args: ["-y", "p@1"] } } }),
    ).servers[0]!
    expect(str.command).toBe("npx")
    expect(str.args).toEqual(["-y", "p@1"])
    expect(str.transport).toBe("stdio")

    // (b) a non-string entry or an empty array yields NO command, not a partial one
    for (const bad of [["node", 42], [], [{ x: 1 }]]) {
      const s = parseConfigText(
        JSON.stringify({ mcp: { b: { type: "local", command: bad } } }),
        "/w/opencode/opencode.json",
      ).servers[0]!
      expect(s.command).toBeUndefined()
      expect(s.args).toEqual([])
      expect(s.transport).toBe("unknown") // honestly unreadable, never "stdio"
    }

    // (c) `env` wins over `environment`; the two are never merged
    const both = parseConfigText(
      JSON.stringify({
        mcp: { c: { type: "local", command: ["node"], env: { A: "1" }, environment: { B: "2" } } },
      }),
      "/w/opencode/opencode.json",
    ).servers[0]!
    expect(both.envKeys).toEqual(["A"])
  })

  /*
   * `{env:VAR}` interpolation must stay UNRESOLVED. OpenCode substitutes it at launch;
   * resolving it here would read the host's real environment during a Quick Scan, which
   * the safety rules forbid. The credential detector needs the KEY, and the key is
   * present either way — so the placeholder is both the safe and the sufficient record.
   */
  it("keeps {env:VAR} placeholders unresolved", () => {
    const s = parseConfigText(
      JSON.stringify({
        mcp: { d: { type: "local", command: ["node"], environment: { OC_TOK: "{env:REAL_SECRET}" } } },
      }),
      "/w/opencode/opencode.json",
    ).servers[0]!
    expect(s.envKeys).toEqual(["OC_TOK"])
    expect(s.env.OC_TOK).toBe("{env:REAL_SECRET}")
  })

  it("supports a bare server map", () => {    const cfg = parseConfigText(
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
