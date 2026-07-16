import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run, EXIT } from "../src/run.js"

const CLOCK = {
  now: Date.parse("2026-07-16T00:00:00Z"),
  generatedAt: "2026-07-16T00:00:00.000Z",
}

const CFG_A = JSON.stringify({
  mcpServers: {
    fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem@1.0.0", "/tmp"] },
  },
})
// Rug-pull: bump the pinned version after approval → a changed capability hash.
const CFG_B = JSON.stringify({
  mcpServers: {
    fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem@2.0.0", "/tmp"] },
  },
})

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "calllint-guard-"))
  mkdirSync(join(dir, ".cursor"), { recursive: true })
  writeFileSync(join(dir, ".cursor", "mcp.json"), CFG_A)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const deps = (over: Record<string, unknown> = {}) => ({
  cwd: dir,
  readStdin: () => "",
  ...CLOCK,
  ...over,
})

describe("guard (core verb) — silent when unchanged (ADR 0045 §2)", () => {
  it("errors when no approved baseline exists (never a silent pass)", () => {
    const res = run(["guard"], deps())
    expect(res.exitCode).toBe(EXIT.USAGE)
    expect(res.stderr).toContain("No approved baseline")
  })

  it("clean, unchanged surface → silent, exit 0, no stdout", () => {
    run(["approve"], deps())
    const res = run(["guard"], deps())
    expect(res.exitCode).toBe(EXIT.OK)
    expect(res.stdout).toBe("")
  })

  it("a mutated surface drifts → REVIEW, exit 10", () => {
    run(["approve"], deps())
    writeFileSync(join(dir, ".cursor", "mcp.json"), CFG_B)
    const res = run(["guard"], deps())
    expect(res.exitCode).toBe(EXIT.REVIEW)
    expect(res.stdout).toContain("REVIEW")
  })

  it("--json emits the guard assessment with a stable schema of fields", () => {
    run(["approve"], deps())
    const res = run(["guard", "--json"], deps())
    const parsed = JSON.parse(res.stdout)
    expect(parsed.action).toBe("silent")
    expect(parsed.verdict).toBe("SAFE")
    expect(parsed.drifted).toBe(false)
  })

  it("--json on a drifted surface reports drifted + a non-SAFE verdict", () => {
    run(["approve"], deps())
    writeFileSync(join(dir, ".cursor", "mcp.json"), CFG_B)
    const parsed = JSON.parse(run(["guard", "--json"], deps()).stdout)
    expect(parsed.drifted).toBe(true)
    expect(parsed.verdict).not.toBe("SAFE")
  })
})

describe("guard disable / enable / status (ADR 0045 §5)", () => {
  it("CALLLINT_GUARD=0 disables: exit 0 with a visible note, never silent-pass", () => {
    run(["approve"], deps())
    writeFileSync(join(dir, ".cursor", "mcp.json"), CFG_B) // would otherwise drift
    // Inject env through the guard deps path: run() reads process.env, so set it.
    const prev = process.env.CALLLINT_GUARD
    process.env.CALLLINT_GUARD = "0"
    try {
      const res = run(["guard"], deps())
      expect(res.exitCode).toBe(EXIT.OK)
      expect(res.stdout).toContain("disabled")
    } finally {
      if (prev === undefined) delete process.env.CALLLINT_GUARD
      else process.env.CALLLINT_GUARD = prev
    }
  })

  it("guard disable writes the flag; a drifted surface then exits 0 (disabled)", () => {
    run(["approve"], deps())
    const dres = run(["guard", "disable"], deps())
    expect(dres.exitCode).toBe(EXIT.OK)
    expect(existsSync(join(dir, ".calllint", "guard.json"))).toBe(true)
    writeFileSync(join(dir, ".cursor", "mcp.json"), CFG_B)
    const res = run(["guard"], deps())
    expect(res.exitCode).toBe(EXIT.OK)
    expect(res.stdout).toContain("disabled")
  })

  it("guard enable clears the disable flag; drift is loud again", () => {
    run(["approve"], deps())
    run(["guard", "disable"], deps())
    run(["guard", "enable"], deps())
    writeFileSync(join(dir, ".cursor", "mcp.json"), CFG_B)
    const res = run(["guard"], deps())
    expect(res.exitCode).toBe(EXIT.REVIEW)
  })

  it("guard status reports baseline + disable + installed-hook state (--json)", () => {
    run(["approve"], deps())
    const parsed = JSON.parse(run(["guard", "status", "--json"], deps()).stdout)
    expect(parsed.enabled).toBe(true)
    expect(parsed.approvedBaseline).toContain("approved.json")
    expect(parsed.installedHooks["git:pre-commit"]).toBe(false)
  })
})

describe("guard install (ADR 0045 §4 — declarative shims)", () => {
  it("with no --host, lists hosts", () => {
    const res = run(["guard", "install"], deps())
    expect(res.stdout).toContain("git")
    expect(res.stdout).toContain("github")
  })

  it("--host git writes a pre-commit hook that shells out to `calllint guard`", () => {
    mkdirSync(join(dir, ".git", "hooks"), { recursive: true })
    const res = run(["guard", "install", "--host", "git"], deps())
    expect(res.exitCode).toBe(EXIT.OK)
    const hook = readFileSync(join(dir, ".git", "hooks", "pre-commit"), "utf8")
    expect(hook).toContain("calllint guard")
    // The artifact carries no risk logic — just the shim.
    expect(hook).not.toContain("verdict")
  })

  it("--host github writes the shipped drift-gate workflow verbatim", () => {
    const res = run(["guard", "install", "--host", "github"], deps())
    expect(res.exitCode).toBe(EXIT.OK)
    const wf = readFileSync(join(dir, ".github", "workflows", "calllint.yml"), "utf8")
    expect(wf).toContain("name: calllint")
    expect(wf).toContain("verify --approved --ci")
  })

  it("an unknown host is a usage error", () => {
    const res = run(["guard", "install", "--host", "jenkins"], deps())
    expect(res.exitCode).toBe(EXIT.USAGE)
    expect(res.stderr).toContain("Unknown guard host")
  })

  it("an unknown subcommand is a usage error", () => {
    const res = run(["guard", "frobnicate"], deps())
    expect(res.exitCode).toBe(EXIT.USAGE)
  })
})
