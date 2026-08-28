/**
 * Committed artifacts are not scratch space.
 *
 * WHAT THIS GUARDS: no test may write to a git-tracked file. A test that mutates a
 * committed artifact and restores it in `finally` is a flake generator — every concurrent
 * reader in the same vitest run can observe the corrupt window — and it is invisible to
 * every guard that inspects the tree *after* the run, because the restore already happened.
 *
 * THE CONCRETE DEFECT THIS CAUGHT (2026-08-28): `tests/facts/deriveFacts.test.ts` proved
 * `derive-facts.mjs` fails closed by writing `+100` into the REAL `project-facts.json`,
 * while its own comment claimed it used "a temp copy … via a throwaway facts file". That
 * file has ~10 readers across the suite and vitest runs files in parallel workers, so the
 * same commit gave `pnpm ci:local` opposite verdicts on consecutive runs — one red with
 * `detectorCount: facts=113 code=13` (13 + the exact 100 the control injects), one green.
 *
 * WHY THE OBVIOUS GUARD CANNOT SEE IT — and why this one keys on MTIME, not content:
 * a `git status` / content-hash check at the end of the run compares the tree to the index
 * AFTER the `finally` restored the bytes, so it is green for the defect it exists to catch.
 * Measured: writing a file and restoring byte-identical content leaves `mtimeMs` CHANGED
 * while the bytes are identical. mtime is the only observable that survives the restore.
 *
 * WHY THIS IS BEHAVIOURAL, NOT A SOURCE SCAN: a source scan for `writeFileSync(repoRoot…)`
 * returns 2 hits at HEAD, both of them the *source* argument of a `copyFileSync` reading
 * OUT of the repo — i.e. after the fix the pattern set is empty and the guard would pass
 * vacuously (this repo's dominant fault class). So this suite runs a real test subprocess
 * and observes what it touched. The negative controls below are the load-bearing half:
 * a guard that goes green on its first run has told you nothing until a control reds.
 *
 * SCOPE: git-tracked files only. Untracked and gitignored paths (`.var/`, `node_modules/`,
 * build output) are legitimately written by tests and are not this guard's subject.
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect } from "vitest"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

/** Absolute paths of every git-tracked file, and their mtimeMs. */
function snapshot(): Map<string, number> {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  const snap = new Map<string, number>()
  for (const rel of out.split("\0")) {
    if (!rel) continue
    const abs = path.join(repoRoot, rel)
    try {
      snap.set(rel, fs.statSync(abs).mtimeMs)
    } catch {
      // A tracked-but-absent file (mid-rebase, sparse checkout) is not this guard's subject.
    }
  }
  return snap
}

/** Tracked files whose mtime moved between two snapshots, plus any that appeared/vanished. */
function touched(before: Map<string, number>, after: Map<string, number>): string[] {
  const moved: string[] = []
  for (const [rel, mtime] of after) {
    const prev = before.get(rel)
    if (prev === undefined) {
      moved.push(`${rel} (appeared)`)
    } else if (prev !== mtime) {
      moved.push(rel)
    }
  }
  for (const rel of before.keys()) if (!after.has(rel)) moved.push(`${rel} (vanished)`)
  return moved.sort()
}

/**
 * Every test file that could possibly write a tracked file: it writes at all, AND it
 * anchors a path at the repo. A test with no write call cannot violate this rule, and one
 * that writes only under `os.tmpdir()` has no repo path to reach. Derived, never listed —
 * a hardcoded list stops covering its tail as suites are added (ADR 0089 D2 / 0090).
 */
function testsThatCouldWriteTrackedFiles(): string[] {
  const files = execFileSync("git", ["ls-files", "*.test.ts"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean)
  const writes =
    /\b(writeFileSync|appendFileSync|copyFileSync|renameSync|rmSync|unlinkSync|truncateSync|cpSync|writeFile|appendFile|mkdirSync)\s*\(/
  const repoAnchor = /repoRoot|process\.cwd\(\)|__dirname|fileURLToPath|import\.meta\.url/
  return files.filter((rel) => {
    const text = fs.readFileSync(path.join(repoRoot, rel), "utf8")
    return writes.test(text) && repoAnchor.test(text)
  })
}

/**
 * Run the given vitest files in ONE child process and report which tracked files they
 * touched. One subprocess for the whole cohort, so this costs a single snapshot pair
 * rather than one per file.
 *
 * The child's exit code is returned but deliberately NOT asserted by the sweep: a suite may
 * be red for reasons that have nothing to do with this rule, and conflating the two would
 * make an unrelated failure read as a scratch-space violation (the "report must not sit
 * behind another assertion" rule). Its only use is to prove the child really ran.
 */
function trackedFilesTouchedBy(testFiles: string[]): { touched: string[]; code: number; out: string } {
  const before = snapshot()
  let code = 0
  let out = ""
  try {
    out = execFileSync(
      "node",
      [
        path.join(repoRoot, "node_modules", "vitest", "vitest.mjs"),
        "run",
        ...testFiles,
        "--no-coverage",
      ],
      { cwd: repoRoot, encoding: "utf8", stdio: "pipe", timeout: 900_000 },
    )
  } catch (e: any) {
    code = e.status ?? 1
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`
  }
  const after = snapshot()
  return { touched: touched(before, after), code, out }
}

describe("committed artifacts are not scratch space", () => {
  it("no test with write capability touches a git-tracked file", () => {
    const cohort = testsThatCouldWriteTrackedFiles()
    // Anti-vacuity: if the derivation returns an empty or tiny cohort, the sweep proves
    // nothing. 36 files at the time of writing; a floor, not a pin, so adding suites is free.
    expect(cohort.length).toBeGreaterThanOrEqual(20)
    expect(cohort).toContain("tests/facts/deriveFacts.test.ts")

    const { touched: moved, out } = trackedFilesTouchedBy(cohort)
    // Prove the child actually ran a suite rather than dying on startup — a crashed child
    // touches nothing, which would make `moved` empty for the wrong reason (127-class fault).
    expect(out).toMatch(/Test Files|Tests\s/)
    expect(moved).toEqual([])
  }, 960_000)

  it("mtime detects a write that is restored byte-identically (control for the instrument)", () => {
    // Without this, the sweep above could be green because mtime is a blind observable
    // rather than because nothing was written. Proven on a throwaway file, not on the repo.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "calllint-scratch-guard-"))
    try {
      const f = path.join(dir, "artifact.json")
      fs.writeFileSync(f, '{"n":1}\n')
      const before = fs.statSync(f).mtimeMs
      const original = fs.readFileSync(f)
      fs.writeFileSync(f, '{"n":101}\n') // inject
      fs.writeFileSync(f, original) //     restore, as a `finally` would
      const after = fs.statSync(f).mtimeMs
      expect(fs.readFileSync(f, "utf8")).toBe('{"n":1}\n') // bytes identical...
      expect(after).not.toBe(before) // ...and yet observable.
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("the sweep reds when a test really does write a tracked file (negative control)", () => {
    // The plant must be a *tracked* file to be in scope, so this builds a throwaway git repo
    // rather than cloning this one: a full `git clone` of this repo took 54s and copies 2369
    // files to observe one. The real checkout is never a participant — the rule this guard
    // enforces applies to the guard itself.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "calllint-scratch-nc-"))
    try {
      const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 60_000 })
      git("init", "--quiet")
      git("config", "user.email", "guard@example.invalid")
      git("config", "user.name", "guard")
      const victimRel = "project-facts.json"
      const victim = path.join(root, victimRel)
      fs.writeFileSync(victim, JSON.stringify({ capabilities: { detectorCount: 13 } }, null, 2) + "\n")
      git("add", victimRel)
      git("commit", "--quiet", "-m", "committed artifact")

      const mtimeBefore = fs.statSync(victim).mtimeMs

      // Reproduce the old defect exactly: write, then restore in `finally`.
      const original = fs.readFileSync(victim)
      try {
        const broken = JSON.parse(original.toString())
        broken.capabilities.detectorCount += 100
        fs.writeFileSync(victim, JSON.stringify(broken, null, 2) + "\n")
      } finally {
        fs.writeFileSync(victim, original)
      }

      // Content is restored, so a git-status guard is GREEN here...
      expect(fs.readFileSync(victim).equals(original)).toBe(true)
      expect(git("status", "--porcelain", "--", victimRel).trim()).toBe("")
      // ...and the tracked-file mtime is not.
      expect(fs.statSync(victim).mtimeMs, "mtime must reveal what a content check cannot").not.toBe(
        mtimeBefore,
      )
      // And the file really is in scope: `git ls-files` is what the sweep enumerates.
      expect(git("ls-files").split("\n").filter(Boolean)).toContain(victimRel)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }, 90_000)
})
