import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * child_process is mocked so ANY attempt to execute the target is observable.
 * `trust prepare` must NEVER execute the artifact it evaluates (ADR 0035) —
 * it only reads bytes to digest them.
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
  dir = mkdtempSync(join(tmpdir(), "calllint-trust-"))
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

describe("trust prepare — read-only artifact identity (G1)", () => {
  it("resolves a single file to a digest, exit 0, executes nothing", () => {
    writeFileSync(join(dir, "SKILL.md"), "# skill\ndo a thing\n")
    const r = run(["trust", "prepare", "SKILL.md", "--json"], deps())
    expect(r.exitCode).toBe(0)
    const prep = JSON.parse(r.stdout)
    expect(prep.schema).toBe("calllint.trust-preparation.v0")
    expect(prep.artifact.sourceType).toBe("file")
    expect(prep.artifact.resolution).toBe("resolved")
    expect(prep.artifact.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(prep.state).toBe("PLAN_READY")
    noExec()
  })

  it("classifies an mcp config file as mcp-config", () => {
    writeFileSync(join(dir, "mcp.json"), JSON.stringify({ mcpServers: {} }))
    const r = run(["trust", "prepare", "mcp.json", "--json"], deps())
    expect(JSON.parse(r.stdout).artifact.sourceType).toBe("mcp-config")
    noExec()
  })

  it("digests a directory tree deterministically (byte-identical repeat)", () => {
    mkdirSync(join(dir, "skill"))
    writeFileSync(join(dir, "skill", "SKILL.md"), "one")
    writeFileSync(join(dir, "skill", "handler.py"), "two")
    const a = run(["trust", "prepare", "skill", "--json"], deps())
    const b = run(["trust", "prepare", "skill", "--json"], deps())
    expect(a.exitCode).toBe(0)
    expect(a.stdout).toBe(b.stdout) // byte-identical core output
    expect(JSON.parse(a.stdout).artifact.sourceType).toBe("dir")
    noExec()
  })

  it("does not descend into node_modules / .git", () => {
    mkdirSync(join(dir, "skill"))
    writeFileSync(join(dir, "skill", "SKILL.md"), "content")
    mkdirSync(join(dir, "skill", "node_modules"))
    writeFileSync(join(dir, "skill", "node_modules", "junk.js"), "SHOULD NOT BE HASHED")
    const withVendor = run(["trust", "prepare", "skill", "--json"], deps())

    // A second dir with only the real file must hash identically.
    mkdirSync(join(dir, "skill2"))
    writeFileSync(join(dir, "skill2", "SKILL.md"), "content")
    const clean = run(["trust", "prepare", "skill2", "--json"], deps())

    expect(JSON.parse(withVendor.stdout).artifact.digest).toBe(
      JSON.parse(clean.stdout).artifact.digest
    )
    noExec()
  })

  it("npm target offline → unresolved, exit 20, reasons surfaced, executes nothing", () => {
    const r = run(["trust", "prepare", "npm:left-pad@1.3.0", "--json"], deps())
    expect(r.exitCode).toBe(20)
    const prep = JSON.parse(r.stdout)
    expect(prep.artifact.sourceType).toBe("npm")
    expect(prep.artifact.resolution).toBe("unresolved")
    expect(prep.state).toBe("RESOLUTION_FAILED")
    expect(prep.notes.length).toBeGreaterThan(0)
    noExec()
  })

  it("github target offline → unresolved, exit 20, executes nothing", () => {
    const r = run(["trust", "prepare", "github:foo/bar@main", "--json"], deps())
    expect(r.exitCode).toBe(20)
    expect(JSON.parse(r.stdout).artifact.sourceType).toBe("git")
    noExec()
  })

  it("missing target → usage error (exit 2)", () => {
    const r = run(["trust", "prepare", "nope.md"], deps())
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("not found")
    noExec()
  })

  it("prepare with no target → usage error (exit 2)", () => {
    const r = run(["trust", "prepare"], deps())
    expect(r.exitCode).toBe(2)
  })
})

describe("trust prepare --evidence (G2, provenance-preserved, never re-scored)", () => {
  const cleanReport = JSON.stringify({
    scanner: "SkillSpector",
    commit: "a".repeat(40),
    status: "complete",
    categories: ["taint"],
    findings: [],
  })
  const partialReport = JSON.stringify({
    scanner: "SkillSpector",
    commit: "b".repeat(40),
    status: "partial",
    findings: [{ rule_id: "SS-X", severity: "low" }],
  })

  it("attaches complete evidence → PLAN_READY, exit 0, executes nothing", () => {
    writeFileSync(join(dir, "SKILL.md"), "x")
    writeFileSync(join(dir, "ss.json"), cleanReport)
    const r = run(["trust", "prepare", "SKILL.md", "--evidence", "ss.json", "--json"], deps())
    expect(r.exitCode).toBe(0)
    const prep = JSON.parse(r.stdout)
    expect(prep.state).toBe("PLAN_READY")
    expect(prep.evidence).toHaveLength(1)
    expect(prep.evidence[0].provider).toBe("skillspector")
    expect(prep.evidence[0].completeness).toBe("complete")
    noExec()
  })

  it("partial evidence → EVIDENCE_PARTIAL, exit 10", () => {
    writeFileSync(join(dir, "SKILL.md"), "x")
    writeFileSync(join(dir, "ss.json"), partialReport)
    const r = run(["trust", "prepare", "SKILL.md", "--evidence", "ss.json", "--json"], deps())
    expect(r.exitCode).toBe(10)
    expect(JSON.parse(r.stdout).state).toBe("EVIDENCE_PARTIAL")
    noExec()
  })

  it("malformed evidence → EVIDENCE_FAILED, exit 20 (fail-closed, never a pass)", () => {
    writeFileSync(join(dir, "SKILL.md"), "x")
    writeFileSync(join(dir, "broken.json"), "not json at all")
    const r = run(["trust", "prepare", "SKILL.md", "--evidence", "broken.json", "--json"], deps())
    expect(r.exitCode).toBe(20)
    const prep = JSON.parse(r.stdout)
    expect(prep.state).toBe("EVIDENCE_FAILED")
    expect(prep.evidence[0].completeness).toBe("failed")
    noExec()
  })

  it("missing evidence file → usage error (exit 2)", () => {
    writeFileSync(join(dir, "SKILL.md"), "x")
    const r = run(["trust", "prepare", "SKILL.md", "--evidence", "nope.json"], deps())
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("not found")
    noExec()
  })

  it("--with-skillspector is not wired: refuses, never runs anything", () => {
    writeFileSync(join(dir, "SKILL.md"), "x")
    const r = run(["trust", "prepare", "SKILL.md", "--with-skillspector"], deps())
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("--evidence")
    noExec()
  })

  it("--no-llm is accepted as a no-op (default posture)", () => {
    writeFileSync(join(dir, "SKILL.md"), "x")
    writeFileSync(join(dir, "ss.json"), cleanReport)
    const r = run(["trust", "prepare", "SKILL.md", "--evidence", "ss.json", "--no-llm", "--json"], deps())
    expect(r.exitCode).toBe(0)
    noExec()
  })
})

describe("trust show / explain", () => {
  it("round-trips a preparation JSON through show", () => {
    writeFileSync(join(dir, "SKILL.md"), "x")
    const prep = run(["trust", "prepare", "SKILL.md", "--json"], deps())
    writeFileSync(join(dir, "prep.json"), prep.stdout)
    const shown = run(["trust", "show", "prep.json"], deps())
    expect(shown.exitCode).toBe(0)
    expect(shown.stdout).toContain("read-only")
    expect(shown.stdout).toContain("prepared")
  })

  it("explain describes why PLAN_READY", () => {
    writeFileSync(join(dir, "SKILL.md"), "x")
    const prep = run(["trust", "prepare", "SKILL.md", "--json"], deps())
    writeFileSync(join(dir, "prep.json"), prep.stdout)
    const ex = run(["trust", "explain", "prep.json"], deps())
    expect(ex.exitCode).toBe(0)
    expect(ex.stdout).toContain("immutable")
  })

  it("rejects a non-preparation JSON document (exit 3)", () => {
    writeFileSync(join(dir, "other.json"), JSON.stringify({ hello: "world" }))
    const r = run(["trust", "show", "other.json"], deps())
    expect(r.exitCode).toBe(3)
    expect(r.stderr).toContain("trust-preparation")
  })

  it("show with missing file → usage error (exit 2)", () => {
    const r = run(["trust", "show", "nope.json"], deps())
    expect(r.exitCode).toBe(2)
  })
})

describe("trust help", () => {
  it("prints usage with no subcommand", () => {
    const r = run(["trust"], deps())
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("Automated Trust Gateway")
  })
})
