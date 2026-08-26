import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { KiroExtractor } from "../extractors/kiro.js"
import { join } from "node:path"
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"

/**
 * Kiro extractor tests.
 *
 * Kiro is the two-scope case: a workspace config under `<cwd>/.kiro/settings/mcp.json`
 * and a user config under `~/.kiro/settings/mcp.json`, merged upstream with the
 * workspace winning (https://kiro.dev/docs/mcp/configuration/). The extractor's job is
 * only to REPORT both, in that precedence order — it does not merge, and the scan
 * pipeline downstream is what consumes them.
 *
 * Two behaviours here are the ones that would degrade quietly if broken, so each gets a
 * test that fails rather than passing weakly:
 *
 *  1. **Order is the contract, not an accident.** Workspace must come first. If the two
 *     were emitted user-first, every assertion that indexes `configs[0]` would still
 *     pass on a single-file fixture — so order is asserted on a fixture where BOTH files
 *     exist and hold DIFFERENT content, which is the only arrangement that can tell them
 *     apart.
 *  2. **De-duplication when the two scopes collide.** `discover()` keeps a `seen` set, so
 *     running with `cwd === home` must yield ONE config, not the same path twice. Without
 *     a test, that branch is invisible: the common case never reaches it.
 *
 * NOT asserted, because the extractor deliberately does not do it: `.kiro/agents/*` is
 * documented as a third, higher-precedence location for MCP servers, and this extractor
 * does not read it. A test pins that omission as intentional rather than forgotten.
 */
describe("KiroExtractor", () => {
  let testDir: string
  let homeDir: string
  let workspaceDir: string
  let extractor: KiroExtractor

  /** `.kiro/settings/mcp.json`, the documented path under both scopes. */
  const rel = [".kiro", "settings", "mcp.json"]

  beforeEach(() => {
    // mkdtempSync, not `Date.now()`: two tests entering the same millisecond would
    // otherwise share a directory and clean up each other's fixtures.
    testDir = mkdtempSync(join(tmpdir(), "calllint-test-kiro-"))
    homeDir = join(testDir, "home")
    workspaceDir = join(testDir, "workspace")
    mkdirSync(join(homeDir, ...rel.slice(0, -1)), { recursive: true })
    mkdirSync(join(workspaceDir, ...rel.slice(0, -1)), { recursive: true })

    extractor = new KiroExtractor()
    // @ts-ignore - overriding a protected method for testing
    extractor.resolveHome = () => homeDir
  })

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
  })

  const workspacePath = () => join(workspaceDir, ...rel)
  const userPath = () => join(homeDir, ...rel)

  /** A minimal valid Kiro MCP config: root `mcpServers`, same shape as Claude Code. */
  const valid = JSON.stringify({ mcpServers: { demo: { command: "node", args: ["s.js"] } } })

  it("should have correct agent type", () => {
    expect(extractor.agentType).toBe("kiro")
  })

  it("should have P2 priority", () => {
    expect(extractor.priority).toBe("P2")
  })

  it("discovers both the workspace and the user config path", () => {
    const configs = extractor.discover(workspaceDir)

    expect(configs).toHaveLength(2)
    expect(configs.map(c => c.configPath)).toEqual([workspacePath(), userPath()])
    for (const c of configs) {
      expect(c.agentType).toBe("kiro")
      expect(c.kind).toBe("mcp-servers")
      expect(c.priority).toBe("P2")
    }
  })

  it("reports workspace BEFORE user, the documented precedence order", () => {
    // Both files exist and differ, so a user-first ordering cannot pass by coincidence.
    writeFileSync(workspacePath(), JSON.stringify({ mcpServers: { fromWorkspace: {} } }))
    writeFileSync(userPath(), JSON.stringify({ mcpServers: { fromUser: {} } }))

    const configs = extractor.discover(workspaceDir)

    expect(configs[0]!.configPath).toBe(workspacePath())
    expect(configs[1]!.configPath).toBe(userPath())
    expect(configs.map(c => c.exists)).toEqual([true, true])
  })

  it("NEGATIVE: reports both paths absent when no file is present", () => {
    expect(extractor.discover(workspaceDir).map(c => c.exists)).toEqual([false, false])
  })

  it("detects a valid workspace config independently of the user one", () => {
    writeFileSync(workspacePath(), valid)

    expect(extractor.discover(workspaceDir).map(c => c.exists)).toEqual([true, false])
  })

  it("detects a valid user config independently of the workspace one", () => {
    writeFileSync(userPath(), valid)

    expect(extractor.discover(workspaceDir).map(c => c.exists)).toEqual([false, true])
  })

  it("emits ONE config when cwd is the home dir, not the same path twice", () => {
    // The `seen` set exists for exactly this collision. The common case never reaches it,
    // so without this test the de-dup branch is unexercised.
    writeFileSync(userPath(), valid)

    const configs = extractor.discover(homeDir)

    expect(configs).toHaveLength(1)
    expect(configs[0]!.configPath).toBe(userPath())
    expect(configs[0]!.exists).toBe(true)
  })

  it("accepts an empty mcpServers object — the shape Kiro writes on first run", () => {
    writeFileSync(workspacePath(), JSON.stringify({ mcpServers: {} }))

    expect(extractor.discover(workspaceDir)[0]!.exists).toBe(true)
  })

  it("NEGATIVE: rejects a file with no mcpServers key", () => {
    writeFileSync(workspacePath(), JSON.stringify({ someOtherKey: "value" }))

    expect(extractor.discover(workspaceDir)[0]!.exists).toBe(false)
  })

  it("NEGATIVE: rejects a null mcpServers", () => {
    writeFileSync(workspacePath(), JSON.stringify({ mcpServers: null }))

    expect(extractor.discover(workspaceDir)[0]!.exists).toBe(false)
  })

  it("NEGATIVE: rejects a file that is not valid JSON", () => {
    writeFileSync(workspacePath(), "not valid json{")

    expect(extractor.discover(workspaceDir)[0]!.exists).toBe(false)
  })

  it("NEGATIVE: rejects a directory at the config path", () => {
    // `validateConfigPath` requires a REGULAR file. A directory named mcp.json would
    // otherwise reach `readFileSync` and be reported by whatever error it happened to throw.
    rmSync(workspacePath(), { force: true })
    mkdirSync(workspacePath(), { recursive: true })

    expect(extractor.discover(workspaceDir)[0]!.exists).toBe(false)
  })

  it("does NOT read .kiro/agents/* — the documented third location it opts out of", () => {
    // Kiro's docs name `.kiro/agents/*.json` as a higher-precedence place to declare MCP
    // servers. This extractor covers only the two settings files. Pinning that keeps the
    // gap a recorded decision: if agents/ is ever added, this test names what changed.
    mkdirSync(join(workspaceDir, ".kiro", "agents"), { recursive: true })
    writeFileSync(
      join(workspaceDir, ".kiro", "agents", "build.json"),
      JSON.stringify({ mcpServers: { fromAgent: { command: "node" } } }),
    )

    const paths = extractor.discover(workspaceDir).map(c => c.configPath)

    expect(paths).toHaveLength(2)
    expect(paths.some(p => p.includes(join(".kiro", "agents")))).toBe(false)
  })

  it("still returns the workspace path when home resolution fails", () => {
    // @ts-ignore - simulating an unresolvable HOME
    extractor.resolveHome = () => {
      throw new Error("no home")
    }
    writeFileSync(workspacePath(), valid)

    const configs = extractor.discover(workspaceDir)

    expect(configs).toHaveLength(1)
    expect(configs[0]!.configPath).toBe(workspacePath())
    expect(configs[0]!.exists).toBe(true)
  })
})
