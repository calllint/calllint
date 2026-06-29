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
})
