import { execFileSync, spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { parse } from "yaml"

const ROOT = fileURLToPath(new URL("../../", import.meta.url))
const GATE = "scripts/verify-security-semantic-diff.mjs"
const ARTIFACT = "artifacts/authority-distribution-closure/security-semantic-diff.json"
const DETECTOR = "packages/static-analyzer/src/detectors/probe.ts"

// A real history reproduces the failure: local main predates an already accepted
// detector repair, while origin/main and the feature branch contain that repair.
function runGate(options: {
  base?: string
  refs?: "both" | "remote-only" | "local-only" | "none"
  changed?: "committed" | "dirty" | "untracked" | "forbidden"
  localAhead?: boolean
  unrelatedRemote?: boolean
} = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "calllint-base-"))
  const git = (...args: string[]) => execFileSync("git", args, {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim()
  const write = (file: string, bytes: string) => {
    mkdirSync(dirname(join(cwd, file)), { recursive: true })
    writeFileSync(join(cwd, file), bytes)
  }
  try {
    git("init", "-q", "-b", "main")
    git("config", "user.name", "base-test")
    git("config", "user.email", "base@example.invalid")
    mkdirSync(join(cwd, "scripts"))
    cpSync(join(ROOT, GATE), join(cwd, GATE))
    write(ARTIFACT, '{"changed":false}\n')
    write(DETECTOR, "export const revision = 1\n")
    git("add", "-A")
    git("commit", "-qm", "old local main")
    git("checkout", "-qb", "feature")
    write(DETECTOR, "export const revision = 2\n")
    git("add", "-A")
    git("commit", "-qm", "accepted upstream repair")
    const refs = options.refs ?? "both"
    if (refs === "both" || refs === "remote-only") {
      git("update-ref", "refs/remotes/origin/main", "HEAD")
    }
    if (refs === "local-only") git("branch", "-f", "main", "HEAD")
    if (refs === "remote-only" || refs === "none") git("branch", "-D", "main")
    if (options.unrelatedRemote) {
      const unrelated = git("commit-tree", git("rev-parse", "HEAD^{tree}"), "-m", "unrelated upstream")
      git("update-ref", "refs/remotes/origin/main", unrelated)
      git("branch", "-f", "main", "HEAD")
    }
    if (options.changed) {
      const file = options.changed === "untracked"
        ? "packages/risk-engine/src/added.ts" : DETECTOR
      write(file, options.changed === "forbidden"
        ? "export const ModelRisk = 1\n" : "export const revision = 3\n")
      if (options.changed === "committed") {
        git("add", "-A")
        git("commit", "-qm", "unapproved verdict change")
        if (options.localAhead) git("branch", "-f", "main", "HEAD")
      }
    }
    const args = [join(cwd, GATE), "--check"]
    if (options.base) args.push("--base", options.base)
    const result = spawnSync(process.execPath, args, { cwd, encoding: "utf8" })
    if (result.error) throw result.error
    return { status: result.status, out: result.stdout + result.stderr,
      artifact: readFileSync(join(cwd, ARTIFACT), "utf8") }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

describe("default semantic baseline is reproducible across local and CI clones", () => {
  it("uses origin/main despite an existing stale local main and reports that choice", () => {
    const result = runGate()
    expect(result.status, result.out).toBe(0)
    expect(result.out).toContain("origin/main")
    expect(result.artifact).toBe('{"changed":false}\n')
  })
  it.each(["remote-only", "local-only"] as const)("supports a %s checkout", (refs) => {
    const result = runGate({ refs })
    expect(result.status, result.out).toBe(0)
  })
  it("honors an explicitly requested local main even when origin/main is newer", () => {
    const result = runGate({ base: "main" })
    expect(result.status).toBe(1)
    expect(result.out).toContain(DETECTOR)
  })
  it("a local main ahead of origin/main cannot hide an unreviewed verdict change", () => {
    const result = runGate({ changed: "committed", localAhead: true })
    expect(result.status, result.out).toBe(1)
    expect(result.out).toContain(DETECTOR)
  })
  it("an existing remote without common history cannot fall back to a convenient local main", () => {
    const result = runGate({ unrelatedRemote: true })
    expect(result.status, result.out).toBe(1)
    expect(result.out).toContain("range measurement did not run")
  })
  it.each([undefined, "missing-ref"])("fails closed when the requested baseline is missing: %s", (base) => {
    const result = runGate({ refs: base ? "both" : "none", base })
    expect(result.status).toBe(1)
    expect(result.out).toContain("range measurement did not run")
  })
  it.each(["committed", "dirty", "untracked", "forbidden"] as const)(
    "still rejects a %s security change against the selected remote baseline", (changed) => {
      const result = runGate({ changed })
      expect(result.status, result.out).toBe(1)
      expect(result.out).toContain(changed === "forbidden" ? 'forbidden field "ModelRisk"' : "verdict-deciding file")
    },
  )
})

describe("local shell and CI diagnostics exercise their actual entry points", () => {
  it.skipIf(process.platform !== "win32")("runs the shell tests through Git Bash without a manual PATH override", () => {
    const result = spawnSync("bash", ["--noprofile", "--norc", "-c", "printf CALLLINT_SHELL_OK"], {
      encoding: "utf8", timeout: 10_000,
    })
    expect(result.status, `${result.error ?? ""}\n${result.stderr}`).toBe(0)
    expect(result.stdout).toBe("CALLLINT_SHELL_OK")
  })
  it.each(["failure", "cancelled", "skipped", "success"])("the CI aggregate diagnoses %s without inventing a ledger defect", (state) => {
    const ci = parse(readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8"))
    const step = ci.jobs["build-and-test"].steps.find((s: { name: string }) =>
      s.name === "Require the ledger authenticity job to have succeeded")
    const body = step.run.replaceAll("${{ needs.ledger-authenticity.result }}", state)
    const result = spawnSync("bash", ["-c", body], { encoding: "utf8", timeout: 10_000 })
    expect(result.status).toBe(state === "success" ? 0 : 1)
    if (state !== "success") {
      expect(result.stdout).toContain("Gate S0")
      expect(result.stdout).toContain("Security-semantic diff")
      expect(result.stdout).toContain("failed step")
    } else {
      expect(result.stdout).toContain("checks passed")
    }
    expect(result.stdout).not.toContain("A ledger entry names a commit this branch never had")
  })
})
