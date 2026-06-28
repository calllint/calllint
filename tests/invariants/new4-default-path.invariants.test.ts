import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run, EXIT } from "../../apps/cli/src/run.js"
import {
  buildFingerprint,
  fingerprintHash,
  classifySurface,
} from "@calllint/core"
import { resolveRuntimeBinding } from "@calllint/resolver"
import { analyzeServerConfig } from "@calllint/static-analyzer"
import type { NormalizedMcpServer } from "@calllint/types"
import { VERDICT_NEXT_ACTION } from "@calllint/types"

// child_process is mocked so any attempt to spawn/exec the scanned server is
// observable (ESM-safe: vi.mock replaces the module before import graph runs).
const spawnMock = vi.fn()
const execMock = vi.fn()
const execSyncMock = vi.fn()
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  return {
    ...actual,
    spawn: (...a: unknown[]) => spawnMock(...a),
    exec: (...a: unknown[]) => execMock(...a),
    execSync: (...a: unknown[]) => execSyncMock(...a),
  }
})

// ---------------------------------------------------------------------------
// new4 default-path invariants (architecture §3, §9.4 / ADR 0018). These encode
// the "极小资源占用" contract for the default `check` / `scan-all` path.
// ---------------------------------------------------------------------------

const CLOCK = {
  now: Date.parse("2026-06-01T00:00:00Z"),
  generatedAt: "2026-06-01T00:00:00.000Z",
  writeCacheFile: false as const,
}

const BLOCK_CFG = JSON.stringify({
  mcpServers: {
    filesystem: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem@1.0.0", "/"],
    },
  },
})

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "calllint-inv-"))
  mkdirSync(join(dir, ".cursor"), { recursive: true })
  writeFileSync(join(dir, ".cursor", "mcp.json"), BLOCK_CFG)
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  spawnMock.mockClear()
  execMock.mockClear()
  execSyncMock.mockClear()
  vi.restoreAllMocks()
})

const deps = (over: Record<string, unknown> = {}) => ({
  cwd: dir,
  readStdin: () => "",
  ...CLOCK,
  ...over,
})

function server(over: Partial<NormalizedMcpServer> & { sourceConfigPath: string }): NormalizedMcpServer {
  return {
    name: "demo",
    transport: "stdio",
    command: "npx",
    args: ["-y", "demo-mcp@1.2.3"],
    envKeys: [],
    env: {},
    providedTools: [],
    raw: {},
    ...over,
  }
}

describe("invariant: default path does not touch the network (P1.11)", () => {
  it("no fetch is invoked during check on the default path", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch" as never)
    run(["check", join(dir, ".cursor", "mcp.json")], deps())
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe("invariant: default path never executes the scanned server (ADR 0003)", () => {
  it("no child_process spawn/exec/execSync runs during check", () => {
    run(["check", join(dir, ".cursor", "mcp.json")], deps())
    expect(spawnMock).not.toHaveBeenCalled()
    expect(execMock).not.toHaveBeenCalled()
    expect(execSyncMock).not.toHaveBeenCalled()
  })

  it("no child_process spawn runs during scan-all", () => {
    run(["scan-all"], deps())
    expect(spawnMock).not.toHaveBeenCalled()
  })
})

describe("invariant: compact output stays within budget (P1.7)", () => {
  it("single-surface default terminal output is ≤ 30 lines", () => {
    const res = run(["check", join(dir, ".cursor", "mcp.json")], deps())
    expect(res.stdout.split("\n").length).toBeLessThanOrEqual(30)
  })
})

describe("invariant: single-surface JSON budget (P1.8)", () => {
  it("single-surface --json compact decision is < 1 KB", () => {
    const res = run(["check", join(dir, ".cursor", "mcp.json"), "--json"], deps())
    expect(Buffer.byteLength(res.stdout, "utf8")).toBeLessThan(1024)
  })
})

describe("invariant: scan-all ignores node_modules (P1.9)", () => {
  it("scan-all never reports a surface inside node_modules", () => {
    mkdirSync(join(dir, "node_modules", "pkg", ".cursor"), { recursive: true })
    writeFileSync(join(dir, "node_modules", "pkg", ".cursor", "mcp.json"), BLOCK_CFG)
    const res = run(["scan-all"], deps())
    expect(res.stdout).not.toContain("node_modules")
  })
})

describe("invariant: secrets are redacted (P1.1)", () => {
  it("no secret value appears in the fingerprint; authority is key names only", () => {
    const s = server({
      sourceConfigPath: ".cursor/mcp.json",
      envKeys: ["API_TOKEN"],
      env: { API_TOKEN: "sk-secretvalue-zzz" },
    })
    const binding = resolveRuntimeBinding(s)
    const findings = analyzeServerConfig(s)
    const fp = buildFingerprint({ server: s, binding, findings, origin: "workspace" })
    expect(JSON.stringify(fp)).not.toContain("sk-secretvalue-zzz")
    expect(fp.authority).toEqual(["env:API_TOKEN"])
  })
})

describe("invariant: cross-host fingerprint equality (P1.1 / ADR 0019)", () => {
  it("the same npx server in Cursor and VS Code yields the same hash", () => {
    const mk = (path: string) => {
      const s = server({ sourceConfigPath: path })
      return fingerprintHash(
        buildFingerprint({
          server: s,
          binding: resolveRuntimeBinding(s),
          findings: analyzeServerConfig(s),
          origin: "workspace",
        }),
      )
    }
    expect(mk(".cursor/mcp.json")).toBe(mk(".vscode/mcp.json"))
  })
})

describe("invariant: UNKNOWN never becomes SAFE / continue (ADR 0002)", () => {
  it("UNKNOWN maps to gather_more_evidence, never continue", () => {
    expect(VERDICT_NEXT_ACTION.UNKNOWN).toBe("gather_more_evidence")
    expect(VERDICT_NEXT_ACTION.UNKNOWN).not.toBe("continue")
  })

  it("an unrecognized snippet check exits UNKNOWN, not OK", () => {
    const res = run(["check", "--stdin"], deps({ readStdin: () => "install my tool please" }))
    expect(res.exitCode).toBe(EXIT.UNKNOWN)
    expect(res.exitCode).not.toBe(EXIT.OK)
  })
})

describe("invariant: trigger never flags node_modules or ordinary source (P1.5)", () => {
  it("classifySurface returns NOOP for node_modules and source files", () => {
    expect(classifySurface("node_modules/x/.cursor/mcp.json")).toBe("NOOP")
    expect(classifySurface("src/index.ts")).toBe("NOOP")
  })
})
