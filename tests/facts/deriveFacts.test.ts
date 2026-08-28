/**
 * new11 PR-02 — facts-derivation guard tests.
 *
 * Asserts the capability facts in project-facts.json are (a) present, (b)
 * consistent with the code, and (c) that the guard actually detects drift. This
 * is the self-verifying half of ADR 0049 §8: public claims derive from one
 * machine-readable source and cannot silently disagree with the code.
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect } from "vitest"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const scriptRel = "scripts/derive-facts.mjs"
const factsPath = path.join(repoRoot, "project-facts.json")

/** Run the guard rooted at `root` (defaults to the real repo); return {code, out}. */
function runGuard(root = repoRoot): { code: number; out: string } {
  try {
    const out = execFileSync("node", [path.join(root, scriptRel)], { cwd: root, encoding: "utf8" })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }
  }
}

/**
 * Assemble a throwaway repo skeleton holding only what the guard reads, and return its root.
 *
 * The guard resolves its own repo root as `path.resolve(__dirname, "..")` — the parent of
 * whichever directory the script sits in — so copying the script into `<tmp>/scripts/` is
 * enough to redirect every path it touches into the sandbox. That keeps the bytes under
 * test the *shipped* guard's, with no test-only override flag added to production code.
 */
function sandbox(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "calllint-facts-"))
  for (const rel of [scriptRel, "project-facts.json", "packages/static-analyzer/src/index.ts"]) {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true })
    fs.copyFileSync(path.join(repoRoot, rel), path.join(root, rel))
  }
  const adapters = "packages/install-planner/src/adapters"
  fs.cpSync(path.join(repoRoot, adapters), path.join(root, adapters), { recursive: true })
  return root
}

describe("facts derivation", () => {
  const facts = JSON.parse(fs.readFileSync(factsPath, "utf8"))

  it("exposes capability facts derived from code", () => {
    expect(facts.capabilities).toBeDefined()
    expect(typeof facts.capabilities.detectorCount).toBe("number")
    expect(Array.isArray(facts.capabilities.tierAHosts)).toBe(true)
  })

  it("detectorCount equals the number of exported detectors", () => {
    const idx = fs.readFileSync(
      path.join(repoRoot, "packages/static-analyzer/src/index.ts"),
      "utf8",
    )
    const names = new Set(
      [...idx.matchAll(/export\s*\{\s*(detect[A-Za-z0-9]+)\b/g)].map((m) => m[1]),
    )
    expect(facts.capabilities.detectorCount).toBe(names.size)
  })

  it("committed facts match the code (guard passes)", () => {
    const { code } = runGuard()
    expect(code).toBe(0)
  })

  it("guard fails closed when capabilities drift from code", () => {
    // Drift is injected into a THROWAWAY repo skeleton, never into the committed
    // project-facts.json. Mutating the real file — as this test used to — opened a window
    // in which every concurrent reader saw corrupt bytes: `project-facts.json` has ~10 other
    // readers across the suite (and this file's own guard subprocess), vitest runs files in
    // parallel workers, and the write/restore pair is not atomic. That produced a genuine
    // flake, observed 2026-08-28 as `detectorCount: facts=113 code=13` — 13 + the 100 this
    // test injects — failing the "guard passes" case three lines up. A negative control must
    // not be able to fail an unrelated test; the repo's own rule is that a test may not use a
    // committed artifact as scratch space.
    const root = sandbox()
    try {
      const target = path.join(root, "project-facts.json")
      const broken = JSON.parse(fs.readFileSync(target, "utf8"))
      broken.capabilities.detectorCount = broken.capabilities.detectorCount + 100
      fs.writeFileSync(target, JSON.stringify(broken, null, 2) + "\n")
      const { code, out } = runGuard(root)
      expect(code).toBe(1)
      expect(out).toMatch(/drift|FAIL/i)
      // The committed file was never a participant.
      expect(JSON.parse(fs.readFileSync(factsPath, "utf8")).capabilities.detectorCount).toBe(
        facts.capabilities.detectorCount,
      )
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
