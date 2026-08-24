/**
 * APPDATA Test Isolation Invariant
 *
 * WHAT THIS TEST GUARDS: any extractor that calls getAppDataDir() must have a test file
 * that isolates APPDATA. Otherwise, tests read the developer's real config and pass/fail
 * unpredictably based on what software is installed on their machine. This is both a
 * privacy leak (the test stats real files in APPDATA without consent) and a source of
 * flakiness (same test, different developer, different result).
 *
 * THE CONCRETE DEFECTS THIS CAUGHT:
 * 1. claude-desktop.test.ts had a tautological assertion `typeof config.exists === "boolean"`
 *    that could never fail, with a comment "We can't control whether user has Claude Desktop
 *    installed". Test was stat'ing the developer's real APPDATA/Claude directory.
 * 2. claude-code.test.ts had a conditional `if (userConfig)` that acknowledged "May have
 *    user-level config (platform-specific)", meaning it couldn't control the test fixture.
 *
 * Both were fixed 2026-08-24 by adding isolateAgentHome() hooks in beforeEach/afterEach.
 *
 * WHY THIS INVARIANT IS FRAGILE: static analysis cannot verify isolation is CORRECT or
 * COMPLETE — only that it EXISTS somewhere in the file. A test could isolate in one
 * describe block but leak in another, and this guard would be green. Reverse mutation
 * control (removing isolation → tests turn red) is the actual verification, and is run
 * manually on a per-file basis. This invariant is a REMINDER, not a proof.
 *
 * WHAT WE CHECK: two patterns are accepted as evidence of isolation —
 * 1. Env var assignment: `process.env.APPDATA = testDir`
 * 2. Method override: `extractor.getAppDataDir = () => testDir`
 *
 * Pattern (1) is cleaner: it tests the real resolution logic end-to-end. Pattern (2) works
 * but mocks implementation details. Both are valid; the invariant accepts either.
 *
 * WHAT HAPPENS WHEN A NEW EXTRACTOR IS ADDED: if it calls getAppDataDir(), this test will
 * RED immediately on the missing isolation pattern. The fix is to add a beforeEach hook
 * with isolateAgentHome() (copy from claude-desktop.test.ts), write exists=true/false
 * behavior tests, and run reverse mutation control to verify the tests turn red when
 * isolation is removed.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

describe("APPDATA test isolation", () => {
  const discoveryRoot = join(process.cwd(), "packages", "discovery")
  const extractorsDir = join(discoveryRoot, "src", "extractors")

  /**
   * Find test file for an extractor (name-based, first match wins).
   * Returns null if no test file found (which is itself a problem, but not this guard's).
   */
  function findTestFile(extractorName: string): string | null {
    // Try test/extractors/ first (preferred), then src/__tests__/ (legacy)
    const candidates = [
      join(discoveryRoot, "test", "extractors", `${extractorName}.test.ts`),
      join(discoveryRoot, "src", "__tests__", `${extractorName}.test.ts`),
    ]

    for (const path of candidates) {
      try {
        readFileSync(path, "utf8")
        return path
      } catch {
        continue
      }
    }

    return null
  }

  /**
   * Check if a test file contains evidence of APPDATA isolation.
   * Two patterns accepted: env var assignment OR method override.
   */
  function hasIsolation(testFilePath: string): boolean {
    const content = readFileSync(testFilePath, "utf8")

    // Pattern 1: env var assignment (claude-desktop, claude-code)
    if (/process\.env\.APPDATA\s*=/.test(content)) {
      return true
    }

    // Pattern 2: method override (cline, vscode)
    if (/extractor\.getAppDataDir\s*=/.test(content)) {
      return true
    }

    return false
  }

  it("every getAppDataDir caller must have isolated tests", () => {
    const extractorFiles = readdirSync(extractorsDir).filter(f =>
      f.endsWith(".ts") && !f.endsWith(".d.ts") && f !== "base.ts" && f !== "index.ts"
    )

    const violations: string[] = []

    for (const file of extractorFiles) {
      const extractorName = file.replace(/\.ts$/, "")
      const src = readFileSync(join(extractorsDir, file), "utf8")

      // Only check extractors that call getAppDataDir()
      if (!src.includes("getAppDataDir()")) {
        continue
      }

      const testFile = findTestFile(extractorName)

      if (!testFile) {
        violations.push(`${extractorName}: calls getAppDataDir() but has NO TEST FILE`)
        continue
      }

      if (!hasIsolation(testFile)) {
        violations.push(
          `${extractorName}: calls getAppDataDir() but ${testFile} has NO ISOLATION PATTERN` +
            ` (needs "process.env.APPDATA = " or "extractor.getAppDataDir = ")`
        )
      }
    }

    expect(violations).toEqual([])
  })

  it("isolation patterns exist in the 4 known callers (negative control)", () => {
    // This test would red if someone accidentally removed isolation from a file that
    // previously had it, even if they didn't touch the extractor source.
    const knownCallers = ["claude-code", "claude-desktop", "cline", "vscode"]

    for (const name of knownCallers) {
      const testFile = findTestFile(name)
      expect(testFile, `${name} test file should exist`).not.toBeNull()
      expect(hasIsolation(testFile!), `${name} test should have isolation`).toBe(true)
    }
  })
})
