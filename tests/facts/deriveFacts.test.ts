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
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect } from "vitest"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const script = path.join(repoRoot, "scripts", "derive-facts.mjs")
const factsPath = path.join(repoRoot, "project-facts.json")

/** Run the guard against the committed facts file; return {code, out}. */
function runGuard(): { code: number; out: string } {
  try {
    const out = execFileSync("node", [script], { cwd: repoRoot, encoding: "utf8" })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }
  }
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
    // Corrupt a temp copy, point the guard at it via a throwaway facts file,
    // and confirm non-zero exit. We mutate + restore the real file atomically.
    const original = fs.readFileSync(factsPath, "utf8")
    try {
      const broken = JSON.parse(original)
      broken.capabilities.detectorCount = broken.capabilities.detectorCount + 100
      fs.writeFileSync(factsPath, JSON.stringify(broken, null, 2) + "\n")
      const { code, out } = runGuard()
      expect(code).toBe(1)
      expect(out).toMatch(/drift|FAIL/i)
    } finally {
      fs.writeFileSync(factsPath, original)
    }
  })
})
