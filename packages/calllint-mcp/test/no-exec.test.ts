import { describe, it, expect, vi, afterEach } from "vitest"
import type { ScanOptions } from "@calllint/core"

// child_process is mocked so any attempt to spawn/exec a scanned server is
// observable. The MCP wrapper must NEVER execute the server it judges (ADR 0003).
const spawnMock = vi.fn()
const execMock = vi.fn()
const execSyncMock = vi.fn()
const execFileMock = vi.fn()
const execFileSyncMock = vi.fn()
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  return {
    ...actual,
    spawn: (...a: unknown[]) => spawnMock(...a),
    exec: (...a: unknown[]) => execMock(...a),
    execSync: (...a: unknown[]) => execSyncMock(...a),
    execFile: (...a: unknown[]) => execFileMock(...a),
    execFileSync: (...a: unknown[]) => execFileSyncMock(...a),
  }
})

// Import AFTER the mock is registered.
const { TOOLS_BY_NAME } = await import("../src/tools.js")

const OPTS: ScanOptions = { now: 0, generatedAt: "2026-06-01T00:00:00.000Z" }
const BLOCK_JSON = JSON.stringify({
  mcpServers: {
    fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem@1.0.0", "/"] },
  },
})

function call(name: string, args: Record<string, unknown>) {
  return TOOLS_BY_NAME.get(name)!.handler(args, OPTS)
}

afterEach(() => {
  spawnMock.mockClear()
  execMock.mockClear()
  execSyncMock.mockClear()
  execFileMock.mockClear()
  execFileSyncMock.mockClear()
})

describe("invariant: MCP tools never execute a scanned server (ADR 0003)", () => {
  it("scan_mcp_config_json spawns nothing", () => {
    call("scan_mcp_config_json", { json: BLOCK_JSON })
    expect(spawnMock).not.toHaveBeenCalled()
    expect(execMock).not.toHaveBeenCalled()
    expect(execSyncMock).not.toHaveBeenCalled()
    expect(execFileMock).not.toHaveBeenCalled()
    expect(execFileSyncMock).not.toHaveBeenCalled()
  })

  it("explain_finding spawns nothing", () => {
    call("explain_finding", { json: BLOCK_JSON })
    expect(spawnMock).not.toHaveBeenCalled()
    expect(execMock).not.toHaveBeenCalled()
  })

  it("verify_baseline spawns nothing", () => {
    call("verify_baseline", { json: BLOCK_JSON })
    expect(spawnMock).not.toHaveBeenCalled()
    expect(execSyncMock).not.toHaveBeenCalled()
  })

  it("calllint_guard_external_tools (Sentinel) spawns nothing", () => {
    call("calllint_guard_external_tools", {})
    expect(spawnMock).not.toHaveBeenCalled()
    expect(execMock).not.toHaveBeenCalled()
    expect(execSyncMock).not.toHaveBeenCalled()
    expect(execFileMock).not.toHaveBeenCalled()
    expect(execFileSyncMock).not.toHaveBeenCalled()
  })

  it("calllint_search_agent_tools (Safe Search) spawns nothing", () => {
    call("calllint_search_agent_tools", { query: "mcp-registry" })
    expect(spawnMock).not.toHaveBeenCalled()
    expect(execMock).not.toHaveBeenCalled()
    expect(execSyncMock).not.toHaveBeenCalled()
    expect(execFileMock).not.toHaveBeenCalled()
    expect(execFileSyncMock).not.toHaveBeenCalled()
  })

  it("calllint_get_adoption_contract spawns nothing", () => {
    call("calllint_get_adoption_contract", { canonicalName: "mcp-registry/ai.adeu-adeu" })
    expect(spawnMock).not.toHaveBeenCalled()
    expect(execMock).not.toHaveBeenCalled()
    expect(execSyncMock).not.toHaveBeenCalled()
    expect(execFileMock).not.toHaveBeenCalled()
    expect(execFileSyncMock).not.toHaveBeenCalled()
  })

  it("calllint_apply_prepared_install aborts on a stale approvalDigest but NEVER spawns anything", () => {
    // Pass a well-formed but deliberately mismatched approvalDigest so the handler
    // short-circuits at the approval gate without reaching applyPlan — the critical
    // guarantee is that no child_process call is made at any point in the flow.
    const fakeDigest = "sha256:" + "a".repeat(64)
    call("calllint_apply_prepared_install", {
      canonicalName: "mcp-registry/ai.adeu-adeu",
      host: "claude-code",
      approvalDigest: fakeDigest,
    })
    expect(spawnMock).not.toHaveBeenCalled()
    expect(execMock).not.toHaveBeenCalled()
    expect(execSyncMock).not.toHaveBeenCalled()
    expect(execFileMock).not.toHaveBeenCalled()
    expect(execFileSyncMock).not.toHaveBeenCalled()
  })

  it("calllint_verify_tool_install reads but NEVER executes anything", () => {
    call("calllint_verify_tool_install", {
      canonicalName: "mcp-registry/ai.adeu-adeu",
      host: "claude-code",
    })
    expect(spawnMock).not.toHaveBeenCalled()
    expect(execMock).not.toHaveBeenCalled()
    expect(execSyncMock).not.toHaveBeenCalled()
    expect(execFileMock).not.toHaveBeenCalled()
    expect(execFileSyncMock).not.toHaveBeenCalled()
  })

  it("calllint_enable_continuous_guard discloses guard commands but NEVER runs one", () => {
    // It hands back `calllint guard install --host …` as TEXT for a person to run.
    // Returning a command string must never shade into executing it.
    call("calllint_enable_continuous_guard", {})
    call("calllint_enable_continuous_guard", { hosts: ["git", "claude-code"] })
    expect(spawnMock).not.toHaveBeenCalled()
    expect(execMock).not.toHaveBeenCalled()
    expect(execSyncMock).not.toHaveBeenCalled()
    expect(execFileMock).not.toHaveBeenCalled()
    expect(execFileSyncMock).not.toHaveBeenCalled()
  })
})
