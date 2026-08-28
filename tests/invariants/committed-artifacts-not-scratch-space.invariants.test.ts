/**
 * Committed artifacts are not scratch space.
 *
 * WHAT THIS GUARDS: no test may write to a git-tracked file. A test that mutates a
 * committed artifact and restores it in `finally` is a flake generator — every concurrent
 * reader in the same vitest run can observe the corrupt window — and it is invisible to
 * every check that inspects the tree *after* the run, because the restore already happened.
 *
 * THE CONCRETE DEFECT THIS CAUGHT (2026-08-28): `tests/facts/deriveFacts.test.ts` proved
 * `derive-facts.mjs` fails closed by writing `+100` into the REAL `project-facts.json`,
 * while its own comment claimed it used "a temp copy … via a throwaway facts file". That
 * file has ~10 readers across the suite and vitest runs files in parallel workers, so the
 * same commit gave `pnpm ci:local` opposite verdicts on consecutive runs — one red with
 * `detectorCount: facts=113 code=13` (13 + the exact 100 the control injects), one green.
 *
 * WHERE THE ENFORCEMENT LIVES: `tests/e2e/globalSetup.ts`. It snapshots every git-tracked
 * file's mtime before any worker spawns and re-reads them in its teardown, throwing if any
 * moved. That placement is forced — see its own docblock for the two shapes that don't work
 * (a test spawning a vitest child re-runs the suite it observes, 900s timeout under
 * contention; a test reading a report the teardown writes reads the PREVIOUS run's file).
 * This suite therefore guards the ENFORCER, which is what is left once the enforcement
 * cannot be a test.
 *
 * WHY MTIME AND NOT CONTENT: measured below on a throwaway file — a write followed by a
 * byte-identical restore leaves `mtimeMs` CHANGED while the bytes and `git status
 * --porcelain` are identical. A content or `git status` check is green for exactly the
 * defect it would be written to catch.
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect } from "vitest"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const setupRel = "tests/e2e/globalSetup.ts"

/**
 * The enforcer's source with comments stripped.
 *
 * Stripping is mandatory, not tidiness: this file's own docblock and the enforcer's
 * explain the mechanism in the same words the assertions look for, so an un-stripped
 * assertion would pass on the strength of the prose justifying it — a defect already
 * recorded twice in this repo. The `commentBytes` floor below then guards the stripper
 * itself, since a stripper that removes everything makes every assertion vacuous.
 */
function enforcerCode(): { code: string; raw: string } {
  const raw = fs.readFileSync(path.join(repoRoot, setupRel), "utf8")
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n")
  return { code, raw }
}

describe("committed artifacts are not scratch space", () => {
  it("the enforcer still snapshots tracked files and throws on a move", () => {
    const { code, raw } = enforcerCode()

    // The stripper must have removed prose but not the code — otherwise every assertion
    // below is vacuously true against an empty string.
    expect(raw.length - code.length).toBeGreaterThan(400)
    expect(code.length).toBeGreaterThan(800)

    // The subject set: git-tracked files, not a directory walk. `-z` because paths with
    // spaces or quotes are silently mangled by git's default quoting.
    expect(code).toMatch(/git["'\s,]+.*ls-files/s)
    expect(code).toMatch(/"-z"/)
    // The observable that survives a byte-identical restore.
    expect(code).toMatch(/mtimeMs/)
    // Both ends of the run, and a fail direction.
    expect(code).toMatch(/return function teardown/)
    expect(code).toMatch(/throw new Error/)
  })

  it("the enforcer's throw is reachable only when something moved (fail direction)", () => {
    const { code } = enforcerCode()
    // A guard that throws unconditionally, or that reports without failing, are the two
    // ways this could rot into uselessness. Pin the condition rather than its message.
    expect(code).toMatch(/if\s*\(\s*touched\.length\s*>\s*0\s*\)/)
    // ...and that the comparison feeding `touched` is an inequality on the snapshots,
    // not a truthiness check that would ignore a legitimate zero mtime.
    expect(code).toMatch(/before\[rel\]\s*!==\s*after\[rel\]|before\[rel\]\s*!==\s*mtime/)
  })

  it("mtime detects a write that is restored byte-identically (control for the instrument)", () => {
    // Without this, the enforcer could be green because mtime is a blind observable rather
    // than because nothing was written. Proven on a throwaway file, never on the repo.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "calllint-scratch-guard-"))
    try {
      const f = path.join(dir, "artifact.json")
      fs.writeFileSync(f, '{"n":1}\n')
      const before = fs.statSync(f).mtimeMs
      const original = fs.readFileSync(f)
      fs.writeFileSync(f, '{"n":101}\n') // inject
      fs.writeFileSync(f, original) //     restore, as a `finally` would
      expect(fs.readFileSync(f, "utf8")).toBe('{"n":1}\n') // bytes identical...
      expect(fs.statSync(f).mtimeMs).not.toBe(before) // ...and yet observable.
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("a restored write is invisible to git status, so a tree check cannot be the guard", () => {
    // The reason the enforcer exists at all, proven in a throwaway git repo rather than by
    // cloning this one (a full clone cost 54s to observe one file; this is ~400ms). The
    // victim is committed, so it is in `git ls-files` — the same set the enforcer sweeps.
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
      expect(git("ls-files").split("\n").filter(Boolean)).toContain(victimRel)

      const mtimeBefore = fs.statSync(victim).mtimeMs
      const original = fs.readFileSync(victim)
      try {
        const broken = JSON.parse(original.toString())
        broken.capabilities.detectorCount += 100
        fs.writeFileSync(victim, JSON.stringify(broken, null, 2) + "\n")
      } finally {
        fs.writeFileSync(victim, original) // exactly what the old defect did
      }

      // Content restored, so a content check and `git status` are both GREEN here...
      expect(fs.readFileSync(victim).equals(original)).toBe(true)
      expect(git("status", "--porcelain", "--", victimRel).trim()).toBe("")
      // ...and mtime is not. This asymmetry is the whole basis of the enforcer.
      expect(fs.statSync(victim).mtimeMs, "mtime must reveal what a content check cannot").not.toBe(
        mtimeBefore,
      )
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }, 90_000)
})
