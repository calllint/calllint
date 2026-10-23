import { describe, expect, it } from "vitest"
import { execFileSync, spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const GATE = "scripts/verify-security-semantic-diff.mjs"
const DETECTOR = "packages/static-analyzer/src/detectors/probe.ts"
const TEST = "packages/static-analyzer/test/probe.test.ts"
const BLOCK = "packages/fixtures/golden/block-probe.json"
const SAFE = "packages/fixtures/golden/safe-probe.json"
const ADR = "adrs/0100-probe.md"
const ARTIFACT = "artifacts/authority-distribution-closure/security-semantic-diff.json"
const supports = { [TEST]: "// regression\n", [BLOCK]: "{}\n", [SAFE]: "{}\n", [ADR]: "# Decision\n" }

function runRange(opts: {
  omit?: string
  extra?: Record<string, string>
  dirty?: boolean
  untracked?: Record<string, string>
  missingBase?: boolean
  check?: boolean
  baseRisk?: string
  baseFiles?: Record<string, string>
  renameDistribution?: boolean
  deleteSupport?: string
} = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "detector-scope-"))
  const git = (...args: string[]) => execFileSync("git", args, {
    cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  })
  const write = (file: string, content: string) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    writeFileSync(path.join(dir, file), content)
  }
  try {
    git("init", "-q", "-b", "main")
    git("config", "user.name", "scope-test")
    git("config", "user.email", "scope@example.invalid")
    mkdirSync(path.join(dir, "scripts"))
    cpSync(path.join(ROOT, GATE), path.join(dir, GATE))
    write(DETECTOR, "export const block = false\n")
    write("packages/risk-engine/src/probe.ts", opts.baseRisk ?? "export const risk = 1\n")
    write(ARTIFACT, '{"changed":false}\n')
    for (const [file, bytes] of Object.entries(opts.baseFiles ?? {})) write(file, bytes)
    git("add", "-A")
    git("commit", "-qm", "base")
    const base = git("rev-parse", "HEAD").trim()
    write(DETECTOR, "export const block = true\n")
    for (const [file, bytes] of Object.entries({ ...supports, ...opts.extra })) {
      if (file !== opts.omit) write(file, bytes)
    }
    if (!opts.dirty) {
      git("add", "-A")
      git("commit", "-qm", "repair")
    }
    for (const [file, bytes] of Object.entries(opts.untracked ?? {})) write(file, bytes)
    if (opts.renameDistribution) {
      mkdirSync(path.join(dir, "tests"), { recursive: true })
      git("mv", "distribution-surfaces.json", "tests/moved.json")
    }
    if (opts.deleteSupport) rmSync(path.join(dir, opts.deleteSupport))
    const args = [path.join(dir, GATE), "--base", opts.missingBase ? "absent-ref" : base]
    if (opts.check) args.push("--check")
    const run = spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8" })
    return {
      status: run.status,
      out: run.stdout + run.stderr,
      artifact: readFileSync(path.join(dir, ARTIFACT), "utf8"),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe("ADR 0100 — detector maintenance preserves the distribution boundary", () => {
  it.each([false, true])("measures %s dirty maintenance without claiming unchanged semantics", (dirty) => {
    const run = runRange({ dirty, check: true })
    expect(run.status).toBe(0)
    expect(run.out).toContain("isolated-detector-maintenance")
    expect(run.out).toContain("SECURITY_SEMANTICS = CHANGED")
    expect(run.out).not.toContain("SECURITY_SEMANTICS = UNCHANGED")
    expect(run.artifact).toBe('{"changed":false}\n')
  })
  it("retains source changes and scope in the generated live report", () => {
    const run = runRange()
    expect(run.status).toBe(0)
    const report = JSON.parse(run.artifact)
    expect(report.changed).toBe(true)
    expect(report.invariantViolation).toBe(false)
    expect(report.measurements.diff.scope).toBe("isolated-detector-maintenance")
    expect(report.measurements.diff.committedChanges).toContain(DETECTOR)
  })
  it.each([TEST, BLOCK, SAFE, ADR])("missing support %s fails closed", (omit) => {
    expect(runRange({ omit, check: true }).status).toBe(1)
  })
  it.each([
    "distribution-surfaces.json",
    "packages/resolver/src/probe.ts",
    "packages/policy/src/probe.ts",
    "packages/risk-engine/src/probe.ts",
    ".github/workflows/ci.yml",
  ])("mixed production/distribution path %s restores strict zero-diff", (file) => {
    expect(runRange({ extra: { [file]: "// changed\n" }, check: true }).status).toBe(1)
  })
  it("untracked distribution files cannot hide outside the scope measurement", () => {
    expect(runRange({ untracked: { "distribution-surfaces.json": "{}\n" }, check: true }).status).toBe(1)
  })
  it("an unstaged reversal cannot hide a committed distribution change", () => {
    const file = "distribution-surfaces.json"
    const run = runRange({
      baseFiles: { [file]: "{}\n" },
      extra: { [file]: '{"changed":true}\n' },
      untracked: { [file]: "{}\n" },
      check: true,
    })
    expect(run.status).toBe(1)
    expect(run.out).not.toContain("isolated-detector-maintenance")
  })
  it("renaming distribution source into tests cannot grant a maintenance exemption", () => {
    expect(runRange({
      baseFiles: { "distribution-surfaces.json": "{}\n" },
      renameDistribution: true, check: true,
    }).status).toBe(1)
  })
  it("a deleted support file cannot satisfy the maintenance requirements", () => {
    expect(runRange({ deleteSupport: SAFE, check: true }).status).toBe(1)
  })
  it("a missing base cannot grant a maintenance exemption", () => {
    expect(runRange({ missingBase: true, check: true }).status).toBe(1)
  })
  it("forbidden fields remain fatal inside an otherwise isolated detector repair", () => {
    const run = runRange({ extra: { [DETECTOR]: "export const ModelRisk = 1\n" }, check: true })
    expect(run.status).toBe(1)
    expect(run.out).toContain('forbidden field "ModelRisk"')
  })
  it("new untracked detector source cannot evade the live forbidden-field check", () => {
    const run = runRange({
      untracked: { "packages/static-analyzer/src/detectors/added.ts": "export const ModelRisk = 1\n" },
      check: true,
    })
    expect(run.status).toBe(1)
    expect(run.out).toContain('forbidden field "ModelRisk"')
  })
  it("identity coupling remains fatal even without any range change to the risk engine", () => {
    const run = runRange({ baseRisk: "export const popularity = 1\n", check: true })
    expect(run.status).toBe(1)
    expect(run.out).toContain("isolated-detector-maintenance")
    expect(run.out).toContain('identity token "popularity"')
  })
})
