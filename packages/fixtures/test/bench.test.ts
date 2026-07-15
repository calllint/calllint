import { readFileSync, readdirSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { describe, it, expect } from "vitest"
import { importEvidence } from "@calllint/evidence"

/**
 * B4 / ADR 0034 — agent-trust-bench structural validation.
 *
 * The behavioural gate (does the joint scan hold?) is `scripts/run-bench.mjs`,
 * which drives the BUILT CLI. This Vitest test runs inside `pnpm test` with no
 * build and locks the fixture set's INTEGRITY: every case declared in index.json
 * exists, its SkillSpector report imports to a valid envelope with the declared
 * completeness, and its expected.json is internally consistent (never claims SAFE).
 * That keeps the benchmark self-consistent even before the CLI is built.
 */

const here = dirname(fileURLToPath(import.meta.url))
const BENCH = join(here, "..", "bench")

interface BenchIndex {
  cases: { caseId: string; path: string; contentResult: string; authorityVerdict: string }[]
}
interface Expected {
  caseId: string
  content: { provider: string; completeness: string; findingsAtLeast?: number; findingsAtMost?: number }
  authority: { verdict: string; requiredFindingIds?: string[] }
  mustNeverBeSafe: boolean
}

const index = JSON.parse(readFileSync(join(BENCH, "index.json"), "utf-8")) as BenchIndex

describe("agent-trust-bench — fixture-set integrity", () => {
  it("has at least the 4 seed complementarity cases", () => {
    expect(index.cases.length).toBeGreaterThanOrEqual(4)
  })

  it("index caseIds match on-disk directories", () => {
    const dirs = readdirSync(join(BENCH, "cases"))
    for (const c of index.cases) {
      expect(dirs).toContain(c.caseId)
      expect(c.path).toBe(`cases/${c.caseId}`)
    }
  })

  for (const c of index.cases) {
    describe(c.caseId, () => {
      const caseDir = join(BENCH, "cases", c.caseId)

      it("has the required case files", () => {
        expect(existsSync(join(caseDir, "input", "mcp.json"))).toBe(true)
        expect(existsSync(join(caseDir, "skillspector-report.json"))).toBe(true)
        expect(existsSync(join(caseDir, "expected.json"))).toBe(true)
        expect(existsSync(join(caseDir, "README.md"))).toBe(true)
      })

      it("SkillSpector report imports to an envelope with the declared completeness", () => {
        const raw = readFileSync(join(caseDir, "skillspector-report.json"), "utf-8")
        const env = importEvidence(raw)
        const expected = JSON.parse(readFileSync(join(caseDir, "expected.json"), "utf-8")) as Expected
        expect(env.provider).toBe(expected.content.provider)
        expect(env.completeness).toBe(expected.content.completeness)
        // The evidence never carries a CallLint verdict (no re-score).
        expect(env).not.toHaveProperty("verdict")
      })

      it("expected.json is internally consistent and never claims SAFE", () => {
        const expected = JSON.parse(readFileSync(join(caseDir, "expected.json"), "utf-8")) as Expected
        expect(expected.caseId).toBe(c.caseId)
        expect(expected.authority.verdict).toBe(c.authorityVerdict)
        // A bench case exists to show a non-SAFE authority outcome or a fail-closed
        // content scan — it must never assert SAFE.
        expect(expected.authority.verdict).not.toBe("SAFE")
        expect(expected.mustNeverBeSafe).toBe(true)
      })
    })
  }
})
