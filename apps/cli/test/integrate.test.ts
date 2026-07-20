import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * child_process is mocked so ANY attempt to execute a server is observable.
 * `calllint integrate` installs CallLint's own preflight server and must NEVER
 * execute the servers it (or the host) judges — INV1 / ADR 0051.
 */
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

const { run } = await import("../src/run.js")

const BASE = {
  now: Date.parse("2026-07-13T00:00:00Z"),
  generatedAt: "2026-07-13T00:00:00.000Z",
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "calllint-integrate-"))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  spawnMock.mockClear()
  execMock.mockClear()
  execSyncMock.mockClear()
  execFileMock.mockClear()
  execFileSyncMock.mockClear()
})

function deps() {
  return { cwd: dir, readStdin: () => "", ...BASE }
}

function noExec() {
  expect(spawnMock).not.toHaveBeenCalled()
  expect(execMock).not.toHaveBeenCalled()
  expect(execSyncMock).not.toHaveBeenCalled()
  expect(execFileMock).not.toHaveBeenCalled()
  expect(execFileSyncMock).not.toHaveBeenCalled()
}

describe("integrate — plan (default, read-only)", () => {
  it("builds a plan for a detected host and writes nothing, executing nothing", () => {
    mkdirSync(join(dir, ".cursor"))
    writeFileSync(join(dir, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: {} }))
    const before = readFileSync(join(dir, ".cursor", "mcp.json"), "utf8")

    const r = run(["integrate", "--host", "cursor", "--json"], deps())
    expect(r.exitCode).toBe(0)
    const payload = JSON.parse(r.stdout)
    expect(payload.schema).toBe("calllint.integrate-plan.v0")
    const cursor = payload.hosts.find((h: { host: string }) => h.host === "cursor")
    expect(cursor.operations).toBe(1)
    expect(cursor.planDigest).toMatch(/^sha256:/)
    expect(cursor.note).toBeNull()

    // Plan is read-only: the config on disk is byte-identical.
    expect(readFileSync(join(dir, ".cursor", "mcp.json"), "utf8")).toBe(before)
    noExec()
  })

  it("is idempotent: a config already containing the calllint server yields no change", () => {
    mkdirSync(join(dir, ".cursor"))
    writeFileSync(
      join(dir, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { calllint: { command: "npx", args: ["-y", "calllint-mcp"] } } }),
    )
    const r = run(["integrate", "--host", "cursor", "--json"], deps())
    expect(r.exitCode).toBe(0)
    const cursor = JSON.parse(r.stdout).hosts.find((h: { host: string }) => h.host === "cursor")
    expect(cursor.planDigest).toBeNull()
    expect(cursor.operations).toBe(0)
    expect(cursor.note).toMatch(/already integrated/)
    noExec()
  })

  it("reports a host that is not detected on this machine (no plan)", () => {
    // No .cursor/mcp.json seeded → cursor is undetected.
    const r = run(["integrate", "--host", "cursor", "--json"], deps())
    expect(r.exitCode).toBe(0)
    const cursor = JSON.parse(r.stdout).hosts.find((h: { host: string }) => h.host === "cursor")
    expect(cursor.planDigest).toBeNull()
    expect(cursor.note).toMatch(/not detected/)
    noExec()
  })

  it("treats a malformed host config as not-detected (discovery validates JSON + mcpServers)", () => {
    // Discovery's `exists` means 'a valid config' (parses as JSON with an
    // mcpServers key), so a malformed file is classified not-detected — never
    // planned over. This is fail-closed: we do not build a plan against bytes
    // we could not parse.
    mkdirSync(join(dir, ".cursor"))
    writeFileSync(join(dir, ".cursor", "mcp.json"), "{ not json ")
    const r = run(["integrate", "--host", "cursor", "--json"], deps())
    expect(r.exitCode).toBe(0)
    const cursor = JSON.parse(r.stdout).hosts.find((h: { host: string }) => h.host === "cursor")
    expect(cursor.planDigest).toBeNull()
    expect(cursor.note).toMatch(/not detected/)
    noExec()
  })

  it("the default (non-JSON) render states the non-blocking boundary (ADR 0051)", () => {
    mkdirSync(join(dir, ".cursor"))
    writeFileSync(join(dir, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: {} }))
    const r = run(["integrate", "--host", "cursor"], deps())
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toMatch(/does not block your agent/)
    expect(r.stdout).toMatch(/never executes the servers it judges/)
    noExec()
  })
})

describe("integrate — help + usage", () => {
  it("integrate help explains plan-only + the only-writer path", () => {
    const r = run(["integrate", "help"], deps())
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toMatch(/Plan-only by default/)
    expect(r.stdout).toMatch(/--apply/)
  })

  it("rejects an unexpected positional (guards typos)", () => {
    const r = run(["integrate", "appy"], deps())
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toMatch(/Unexpected argument/)
    noExec()
  })
})

describe("integrate --apply — the only writer (atomic, verified, idempotent)", () => {
  it("round-trip: plan --write-plan → apply writes the server → re-apply is idempotent no-op", () => {
    mkdirSync(join(dir, ".cursor"))
    writeFileSync(join(dir, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: {} }))

    // 1. Plan and persist the sealed plan file.
    const planRes = run(["integrate", "--host", "cursor", "--write-plan", "--json"], deps())
    expect(planRes.exitCode).toBe(0)
    const cursor = JSON.parse(planRes.stdout).hosts.find((h: { host: string }) => h.host === "cursor")
    expect(cursor.planDigest).toMatch(/^sha256:/)
    expect(cursor.planFile).toBeTruthy()
    expect(existsSync(cursor.planFile)).toBe(true)

    // 2. Apply the approved plan → the calllint server is written into the config.
    const applyRes = run(["integrate", "--apply", "--plan", cursor.planFile, "--approve", cursor.planDigest, "--json"], deps())
    expect(applyRes.exitCode).toBe(0)
    const applied = JSON.parse(applyRes.stdout)
    expect(applied.outcome).toBe("applied")
    const config = JSON.parse(readFileSync(join(dir, ".cursor", "mcp.json"), "utf8"))
    expect(config.mcpServers.calllint).toBeDefined()

    // 3. Re-apply the SAME plan → idempotent no-op, config unchanged.
    const reapply = run(["integrate", "--apply", "--plan", cursor.planFile, "--approve", cursor.planDigest, "--json"], deps())
    expect(reapply.exitCode).toBe(0)
    expect(JSON.parse(reapply.stdout).outcome).toBe("already_applied")

    // The server is executed at no point (INV1).
    noExec()
  })

  it("a plan --write-plan run persists a sealed plan whose digest verifies", () => {
    mkdirSync(join(dir, ".cursor"))
    writeFileSync(join(dir, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: {} }))
    const planRes = run(["integrate", "--host", "cursor", "--write-plan", "--json"], deps())
    const cursor = JSON.parse(planRes.stdout).hosts.find((h: { host: string }) => h.host === "cursor")
    const saved = JSON.parse(readFileSync(cursor.planFile, "utf8"))
    expect(saved.schema).toBe("calllint.install-plan.v1")
    expect(saved.planDigest).toBe(cursor.planDigest)
    noExec()
  })

  it("refuses to apply without --plan", () => {
    const r = run(["integrate", "--apply"], deps())
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toMatch(/Missing --plan/)
    noExec()
  })

  it("refuses to apply without --approve", () => {
    writeFileSync(join(dir, "plan.json"), JSON.stringify({ schema: "calllint.install-plan.v1" }))
    const r = run(["integrate", "--apply", "--plan", "plan.json"], deps())
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toMatch(/Missing --approve/)
    noExec()
  })

  it("rejects a non-install-plan document", () => {
    writeFileSync(join(dir, "plan.json"), JSON.stringify({ schema: "something.else" }))
    const r = run(["integrate", "--apply", "--plan", "plan.json", "--approve", "sha256:x"], deps())
    expect(r.exitCode).toBe(3)
    expect(r.stderr).toMatch(/Not a calllint\.install-plan\.v1/)
    noExec()
  })

  it("fails closed on a tampered plan (digest mismatch)", () => {
    // A well-formed-looking plan whose planDigest does not match its contents.
    const tampered = {
      schema: "calllint.install-plan.v1",
      planId: "deadbeef",
      host: "cursor",
      tier: "A",
      operations: [{ op: "add", target: join(dir, ".cursor", "mcp.json") }],
      rollback: [],
      planDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    }
    writeFileSync(join(dir, "plan.json"), JSON.stringify(tampered))
    const r = run(["integrate", "--apply", "--plan", "plan.json", "--approve", tampered.planDigest], deps())
    expect(r.exitCode).toBe(3)
    expect(r.stderr).toMatch(/digest does not match/)
    noExec()
  })
})
